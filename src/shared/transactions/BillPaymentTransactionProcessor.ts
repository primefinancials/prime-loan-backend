// shared/transactions/transactionProcessor.ts
import { LedgerService } from "../../modules/ledger/LedgerService";
import { DatabaseService } from "../../shared/db";
import { UuidService } from "../../shared/utils/uuid";
import { Money } from "../../shared/utils/money";
import { BillPayment } from "../../modules/bill-payments/bill-payment.model";
import { APIError } from "../../exceptions";
import { TransferResponse } from "../providers/vfd.provider";
import { TransferService } from "../../modules/transfers/transfer.service";
import pino from 'pino';

const logger = pino({ name: 'bill-payment-processor' });

export async function processTransaction({
  userId,
  amount,
  serviceType,
  serviceId,
  customerReference,
  idempotencyKey,
  referralCode,
  providerFn,
  txnProvider,
  refundProvider
}: {
  userId: string;
  amount: number;
  serviceType: string;
  serviceId: string;
  customerReference: string;
  idempotencyKey: string;
  referralCode?: string;
  providerFn: () => Promise<any>;
  txnProvider: () => Promise<TransferResponse & { reference: string }>;
  refundProvider: () => Promise<TransferResponse & { reference: string }>;
}): Promise<{
  traceId: string;
  status: "FAILED" | "COMPLETED";
  billPayment: typeof BillPayment;
  message: string;
}> {
  const traceId = UuidService.generateTraceId();

  if (!Money.isValidAmount(amount)) {
    throw new Error("Invalid amount");
  }

  const session = await DatabaseService.startSession();

  try {
    return await DatabaseService.withTransaction(session, async () => {
      // 1️⃣ Create base bill payment record
      const [billPayment] = await BillPayment.create(
        [
          {
            userId,
            traceId,
            serviceType,
            serviceId,
            customerReference,
            amount,
            status: "PENDING",
            referralCode,
            meta: { originalAmount: amount },
          },
        ],
        { session }
      );

      let txnResponse: any;
      let providerResponse: any;
      let refundResponse: any;

      // 2️⃣ Call txnProvider first
      try {
        txnResponse = await txnProvider();
        console.log("TxnProvider Response:", txnResponse);
      } catch (err: any) {
        billPayment.status = "FAILED";
        billPayment.meta = { ...billPayment.meta, txnError: err.message };
        await billPayment.save({ session });
        logger.error(err?.response?.data?.message || err.message);
        if (txnResponse?.reference) {
          await TransferService.failTransfer(txnResponse.reference);
        }
        throw new Error(err?.response?.data?.message || err.message || "Transaction initialization failed");
      }

      console.log({ txnResponse })

      // ✅ Check if transaction succeeded
      if (txnResponse.status !== "00") {
        billPayment.status = "FAILED";
        billPayment.meta = { ...billPayment.meta, txnResponse };
        await billPayment.save({ session });
        console.log(`message: ${txnResponse.message} status: ${txnResponse.statusCode}`)
        await TransferService.failTransfer(txnResponse?.reference || "");
        throw new Error(txnResponse.message || "BillPayment failed during initialization");
      }

      // 3️⃣ Proceed to call providerFn
      try {
        providerResponse = await providerFn();
        console.log("Provider Response:", providerResponse);

        const providerStatusRaw = providerResponse?.status || "";
        const providerStatus = providerStatusRaw.toString().toLowerCase();

        const isSuccess = providerStatus === "success" || providerStatus === "successful" || providerStatus === "completed" || providerResponse?.success === true;
        const isPending = providerStatus === "pending" || providerStatus === "processing";

        if (isSuccess) {
          // ✅ 4A. Provider Success - Commit DB status immediately
          billPayment.status = "COMPLETED";
          billPayment.processedAt = new Date();
          billPayment.meta = { ...billPayment.meta, txnResponse, providerResponse };
          await billPayment.save({ session });

          // 4B. Run Post-Processing (Ledger, Sync, Notifications) in a separate try/catch
          // If these fail, we DON'T refund because the bill is already paid.
          try {
            await TransferService.completeTransfer(txnResponse.reference, "bill-payment");

            await LedgerService.createDoubleEntry(
              traceId,
              `user_wallet:${userId}`,
              `bill-payment:${serviceType}`,
              amount,
              "bill-payment",
              {
                userId,
                subtype: serviceType,
                idempotencyKey,
                session,
                meta: {
                  billPaymentId: billPayment._id,
                  transactionId: txnResponse.reference,
                },
              }
            );
          } catch (postErr: any) {
            logger.warn({ traceId, error: postErr.message }, "Post-payment processing failed (non-fatal)");
            // We can add a flag here for background retry if needed
            billPayment.meta = { ...billPayment.meta, postProcessingError: postErr.message };
            await billPayment.save({ session });
          }

          return {
            traceId,
            status: "COMPLETED",
            billPayment,
            message: "Bill payment completed successfully",
          };
        } else if (isPending) {
          // 5️⃣ Mark as pending
          billPayment.status = "PENDING";
          billPayment.meta = { ...billPayment.meta, txnResponse, providerResponse };
          await billPayment.save({ session });

          // Ledger update for pending
          await LedgerService.createDoubleEntry(
            traceId,
            `user_wallet:${userId}`,
            `bill-payment:${serviceType}`,
            amount,
            "bill-payment",
            {
              userId,
              subtype: serviceType,
              idempotencyKey,
              session,
              meta: {
                billPaymentId: billPayment._id,
                transactionId: txnResponse.reference,
              },
            }
          );

          return {
            traceId,
            status: "PENDING",
            billPayment,
            message: "Bill payment is pending",
          };
        } else {
          // ❌ Provider explicitly failed or returned unknown status
          throw new Error(providerResponse.message || providerResponse.error || "Provider transaction failed");
        }
      } catch (err: any) {
        console.log("Provider Interaction Error:", err.message);

        // Determine if it's a "maybe successful" error (Timeout, Network)
        const isMaybeSuccessful = 
          err.code === 'ECONNRESET' || 
          err.code === 'ETIMEDOUT' || 
          err.message?.toLowerCase().includes('timeout') ||
          err.message?.toLowerCase().includes('network');

        if (isMaybeSuccessful) {
          // Set to PENDING instead of FAILED/REFUND
          billPayment.status = "PENDING";
          billPayment.meta = {
            ...billPayment.meta,
            txnResponse,
            providerError: err.message,
            reason: "Network timeout - manual re-query required"
          };
          await billPayment.save({ session });

          return {
            traceId,
            status: "PENDING",
            billPayment,
            message: "Transaction is being processed (Pending confirmation)",
          };
        }

        // ❌ Definite failure → attempt refund
        const originalRef = txnResponse?.reference || "";

        if (originalRef) {
          try {
            await TransferService.failTransfer(originalRef);
          } catch (failErr) {
            logger.warn({ error: (failErr as Error).message, originalRef }, "failTransfer failed (pre-refund)");
          }
        }

        // 5️⃣ Attempt refund
        try {
          refundResponse = await refundProvider();

          if (refundResponse?.status === "00") {
            await TransferService.completeTransfer(refundResponse.reference, "bill-payment");
          } else {
            if (refundResponse?.reference) {
              await TransferService.failTransfer(refundResponse.reference);
            }
          }

          // Record the refund in the ledger
          await LedgerService.createDoubleEntry(
            UuidService.generate(),
            `bill-payment:${serviceType}`,
            `user_wallet:${userId}`,
            amount,
            "bill-payment",
            {
              userId,
              subtype: serviceType,
              idempotencyKey: `refund_ledger_${idempotencyKey}_${Date.now()}`,
              session,
              meta: {
                billPaymentId: billPayment._id,
                transactionId: originalRef,
                refundReference: refundResponse?.reference
              },
            }
          );
        } catch (refundErr: any) {
          logger.error({ userId, error: refundErr.message }, "Refund failed for bill payment");
        }

        // 6️⃣ Mark failed + save all responses
        billPayment.status = "FAILED";
        billPayment.meta = {
          ...billPayment.meta,
          txnResponse,
          providerResponse,
          refundResponse,
          providerError: err.message || "Unknown Provider Error",
        };
        await billPayment.save({ session });

        return {
          traceId,
          status: "FAILED",
          billPayment,
          message: err.message || "Transaction failed and refund attempted",
        };
      }
    }) as any;
  } finally {
    await session.endSession();
  }
}
