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
  status: "FAILED" | "COMPLETED" | "PENDING";
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

      // 2️⃣ Call txnProvider first (debit the user's wallet)
      try {
        txnResponse = await txnProvider();
        logger.info({ traceId, reference: txnResponse?.reference }, "txnProvider response received");
      } catch (err: any) {
        billPayment.status = "FAILED";
        billPayment.meta = { ...billPayment.meta, txnError: err.message };
        await billPayment.save({ session });
        logger.error({ traceId, error: err?.response?.data?.message || err.message }, "txnProvider threw — wallet debit failed");
        if (txnResponse?.reference) {
          await TransferService.failTransfer(txnResponse.reference);
        }
        throw new Error(err?.response?.data?.message || err.message || "Transaction initialization failed");
      }

      // ✅ Check VFD transfer status — must be "00" to continue
      if (txnResponse.status !== "00") {
        billPayment.status = "FAILED";
        billPayment.meta = { ...billPayment.meta, txnResponse };
        await billPayment.save({ session });
        logger.warn({ traceId, txnStatus: txnResponse.status, message: txnResponse.message }, "txnProvider returned non-00 status");
        await TransferService.failTransfer(txnResponse?.reference || "");
        throw new Error(txnResponse.message || "BillPayment failed during initialization");
      }

      // 3️⃣ Call the bill provider (PayBeta / Flutterwave)
      // IMPORTANT: We do NOT throw inside this try block on provider failure.
      // Throwing here falls into the outer catch which triggers a refund —
      // but we may have already successfully delivered the bill. Instead we
      // return early with the correct status to avoid spurious refunds.
      try {
        providerResponse = await providerFn();
        logger.info({ traceId, providerStatus: providerResponse?.status }, "providerFn response received");

        const providerStatusRaw = providerResponse?.status ?? providerResponse?.data?.status ?? "";
        const providerStatus = providerStatusRaw.toString().toLowerCase().trim();

        // FIX: Broadened success detection to cover common Nigerian fintech
        // provider response shapes (PayBeta, Flutterwave, VFD, etc.)
        const isSuccess =
          providerStatus === "success" ||
          providerStatus === "successful" ||
          providerStatus === "completed" ||
          providerStatus === "01" ||           // PayBeta numeric success code
          providerStatus === "200" ||          // HTTP-style success code some providers return
          providerResponse?.success === true ||
          providerResponse?.data?.success === true ||
          providerResponse?.data?.status?.toString().toLowerCase() === "success";

        const isPending =
          providerStatus === "pending" ||
          providerStatus === "processing" ||
          providerStatus === "initiated";

        if (isSuccess) {
          // ✅ 4A. Provider confirmed success — persist COMPLETED status immediately
          billPayment.status = "COMPLETED";
          billPayment.processedAt = new Date();
          billPayment.meta = { ...billPayment.meta, txnResponse, providerResponse };
          await billPayment.save({ session });

          // 4B. Post-processing: completeTransfer
          // Split into its own try/catch — a failure here must NOT mark the payment
          // as FAILED, because the bill has already been delivered to the customer.
          try {
            await TransferService.completeTransfer(txnResponse.reference, "bill-payment");
          } catch (transferErr: any) {
            logger.warn({ traceId, error: transferErr.message }, "completeTransfer failed after successful bill payment (non-fatal)");
            billPayment.meta = { ...billPayment.meta, completeTransferError: transferErr.message };
            await billPayment.save({ session });
          }

          // 4C. Post-processing: Ledger double entry
          // Separate try/catch to prevent a ledger write failure from
          // corrupting the MongoDB session or masking the COMPLETED status.
          try {
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
          } catch (ledgerErr: any) {
            logger.warn({ traceId, error: ledgerErr.message }, "Ledger double entry failed after successful bill payment (non-fatal)");
            billPayment.meta = { ...billPayment.meta, postProcessingError: ledgerErr.message };
            await billPayment.save({ session });
          }

          return {
            traceId,
            status: "COMPLETED",
            billPayment,
            message: "Bill payment completed successfully",
          };

        } else if (isPending) {
          // 5️⃣ Provider acknowledged but processing — mark PENDING
          billPayment.status = "PENDING";
          billPayment.meta = { ...billPayment.meta, txnResponse, providerResponse };
          await billPayment.save({ session });

          try {
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
          } catch (ledgerErr: any) {
            logger.warn({ traceId, error: ledgerErr.message }, "Ledger double entry failed for PENDING bill payment (non-fatal)");
            billPayment.meta = { ...billPayment.meta, postProcessingError: ledgerErr.message };
            await billPayment.save({ session });
          }

          return {
            traceId,
            status: "PENDING",
            billPayment,
            message: "Bill payment is pending",
          };

        } else {
          // ❌ FIX: Provider returned an explicit failure or unrecognised status.
          // Previously this threw an error, which fell into the outer catch and
          // triggered a refund even when it wasn't appropriate. Now we:
          //   1. Log the unrecognised status for debugging
          //   2. Fail the VFD transfer cleanly
          //   3. Attempt a refund inline (controlled, not via catch path)
          //   4. Return FAILED without unwinding the session unexpectedly
          logger.warn(
            { traceId, providerStatus: providerStatusRaw, providerResponse },
            "Provider returned explicit failure or unrecognised status — initiating controlled refund"
          );

          const originalRef = txnResponse?.reference || "";

          // Mark the original transfer as failed
          if (originalRef) {
            try {
              await TransferService.failTransfer(originalRef);
            } catch (failErr: any) {
              logger.warn({ traceId, error: failErr.message, originalRef }, "failTransfer failed during explicit provider failure path");
            }
          }

          // Attempt refund
          try {
            refundResponse = await refundProvider();

            if (refundResponse?.status === "00") {
              await TransferService.completeTransfer(refundResponse.reference, "bill-payment");
            } else if (refundResponse?.reference) {
              await TransferService.failTransfer(refundResponse.reference);
            }

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
                  refundReference: refundResponse?.reference,
                },
              }
            );
          } catch (refundErr: any) {
            logger.error({ traceId, userId, error: refundErr.message }, "Refund failed during explicit provider failure path");
          }

          billPayment.status = "FAILED";
          billPayment.meta = {
            ...billPayment.meta,
            txnResponse,
            providerResponse,
            refundResponse,
            providerError: providerResponse?.message || providerResponse?.error || `Unrecognised provider status: ${providerStatusRaw}`,
          };
          await billPayment.save({ session });

          return {
            traceId,
            status: "FAILED",
            billPayment,
            message: providerResponse?.message || providerResponse?.error || "Provider transaction failed",
          };
        }

      } catch (err: any) {
        // This catch now ONLY handles genuine network/infrastructure exceptions
        // thrown by providerFn() itself (e.g. ECONNRESET, ETIMEDOUT).
        // It no longer handles provider logic failures — those are returned above.
        logger.error({ traceId, error: err.message, code: err.code }, "providerFn threw an exception (network/infra error)");

        // Distinguish "maybe already processed" errors (network timeouts) from
        // definite failures. If we can't confirm, set PENDING for manual review.
        const isMaybeSuccessful =
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ENOTFOUND' ||
          err.message?.toLowerCase().includes('timeout') ||
          err.message?.toLowerCase().includes('network') ||
          err.message?.toLowerCase().includes('socket');

        if (isMaybeSuccessful) {
          billPayment.status = "PENDING";
          billPayment.meta = {
            ...billPayment.meta,
            txnResponse,
            providerError: err.message,
            reason: "Network error — provider call outcome unknown, manual re-query required",
          };
          await billPayment.save({ session });

          logger.warn({ traceId, error: err.message }, "Provider network error — marked PENDING for manual review");

          return {
            traceId,
            status: "PENDING",
            billPayment,
            message: "Transaction is being processed (pending confirmation due to network error)",
          };
        }

        // ❌ Definite infrastructure failure → attempt refund
        const originalRef = txnResponse?.reference || "";

        if (originalRef) {
          try {
            await TransferService.failTransfer(originalRef);
          } catch (failErr: any) {
            logger.warn({ traceId, error: failErr.message, originalRef }, "failTransfer failed (pre-refund on infra error)");
          }
        }

        try {
          refundResponse = await refundProvider();

          if (refundResponse?.status === "00") {
            await TransferService.completeTransfer(refundResponse.reference, "bill-payment");
          } else if (refundResponse?.reference) {
            await TransferService.failTransfer(refundResponse.reference);
          }

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
                refundReference: refundResponse?.reference,
              },
            }
          );
        } catch (refundErr: any) {
          logger.error({ traceId, userId, error: refundErr.message }, "Refund failed after infra error");
        }

        billPayment.status = "FAILED";
        billPayment.meta = {
          ...billPayment.meta,
          txnResponse,
          providerResponse,
          refundResponse,
          providerError: err.message || "Unknown infrastructure error",
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