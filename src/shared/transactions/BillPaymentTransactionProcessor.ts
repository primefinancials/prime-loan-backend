// shared/transactions/transactionProcessor.ts
import { LedgerService } from "../../modules/ledger/LedgerService";
import { DatabaseService } from "../../shared/db";
import { UuidService } from "../../shared/utils/uuid";
import { Money } from "../../shared/utils/money";
import { BillPayment } from "../../modules/bill-payments/bill-payment.model";
import { APIError } from "../../exceptions";
import { TransferResponse } from "../providers/vfd.provider";
import { TransferService } from "../../modules/transfers/transfer.service";

export async function processTransaction({
  userId,
  amount,
  serviceType,
  serviceId,
  customerReference,
  idempotencyKey,
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
        throw new APIError(400, err.message || "Transaction initialization failed");
      }

      // ✅ Check if transaction succeeded
      const txnStatus = txnResponse?.status || txnResponse?.statusCode;
      if (txnStatus !== "00") {
        billPayment.status = "FAILED";
        billPayment.meta = { ...billPayment.meta, txnResponse };
        await billPayment.save({ session });
        throw new APIError(400, txnResponse.message || "BillPayment failed during initialization");
      }

      // 3️⃣ Proceed to call providerFn
      try {
        providerResponse = await providerFn();
        console.log("Provider Response:", providerResponse);

        const providerStatus = providerResponse?.status?.toLowerCase?.() || "";

        if (providerStatus === "success" || providerStatus === "successful") {
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
        } else {
          // ❌ Provider failed → trigger refund
          throw new Error(providerResponse.message || "Provider transaction failed");
        }
      } catch (err: any) {
        console.log("Provider Error:", err.message);

        // 5️⃣ Attempt refund
        try {
          refundResponse = await refundProvider();
          console.log("Refund Response:", refundResponse);
        } catch (refundErr: any) {
          console.error("Refund Failed:", refundErr.message);
        }

        // 6️⃣ Mark failed + save all responses
        billPayment.status = "FAILED";
        billPayment.meta = {
          ...billPayment.meta,
          txnResponse,
          providerResponse,
          refundResponse,
          providerError: err.message,
        };
        await billPayment.save({ session });

        await TransferService.failTransfer(txnResponse?.reference || "");

        throw new APIError(400, err.message || "Transaction failed and refund attempted")
      }
    }) as any;
  } finally {
    await session.endSession();
  }
}
