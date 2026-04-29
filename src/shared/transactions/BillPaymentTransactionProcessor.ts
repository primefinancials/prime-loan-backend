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
          // 4️⃣ Complete transaction (mark completed)
          await TransferService.completeTransfer(
            txnResponse.reference,
            "bill-payment"
          );

          billPayment.status = "COMPLETED";
          billPayment.processedAt = new Date();
          billPayment.meta = {
            ...billPayment.meta,
            txnResponse,
            providerResponse,
          };
          await billPayment.save({ session });

          // Ledger update
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
            status: "COMPLETED",
            billPayment,
            message: "Bill payment completed successfully",
          };
        } else if (isPending) {
          // 5️⃣ Mark as pending
          billPayment.status = "PENDING";
          billPayment.meta = {
            ...billPayment.meta,
            txnResponse,
            providerResponse,
          };
          await billPayment.save({ session });

          // Ledger update for pending (some systems hold funds)
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
          await TransferService.failTransfer(txnResponse?.reference || "");
          throw new Error(providerResponse.message || providerResponse.error || "Provider transaction failed");
        }
      } catch (err: any) {
        console.log("Provider Error:", err.message);

        // ❌ Provider failed → trigger refund
        // Ensure we have a reference to attempt refund/failure
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
          console.log("Refund Response:", refundResponse);
        } catch (refundErr: any) {
          console.error("Refund Failed:", refundErr?.response?.data?.message || refundErr.message || refundErr);
        }

        // 6️⃣ Mark failed + save all responses
        // We DO NOT throw here because we want the transaction to COMMIT the FAILED status and the Refund ledger entry.
        billPayment.status = "FAILED";
        billPayment.meta = {
          ...billPayment.meta,
          txnResponse,
          providerResponse,
          refundResponse,
          providerError: err.message || "Unknown Provider Error",
        };
        await billPayment.save({ session });

        // Return a failure object instead of throwing to allow the transaction to commit
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
