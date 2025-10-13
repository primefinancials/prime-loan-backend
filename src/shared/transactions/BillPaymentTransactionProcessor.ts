// shared/transactions/transactionProcessor.ts
import { LedgerService } from "../../modules/ledger/LedgerService";
import { DatabaseService } from "../../shared/db";
import { UuidService } from "../../shared/utils/uuid";
import { Money } from "../../shared/utils/money";
import { BillPayment } from "../../modules/bill-payments/bill-payment.model";
import { saveIdempotentResponse } from "../../shared/idempotency/middleware";
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
  accountBalance,
  providerFn,
  txnProvider
}: {
  userId: string;
  amount: number;
  serviceType: string;
  serviceId: string;
  customerReference: string;
  idempotencyKey: string;
  accountBalance: string;
  providerFn: () => Promise<any>;
  txnProvider: () => Promise<TransferResponse & { reference: string }>
}): Promise<{ traceId: string, status: "FAILED" | "COMPLETED", billPayment: typeof BillPayment, message: string }> {
  const traceId = UuidService.generateTraceId();

  if (!Money.isValidAmount(amount)) {
    throw new Error("Invalid amount");
  }

  const session = await DatabaseService.startSession();

  try {
    return await DatabaseService.withTransaction(session, async () => {
      // 1. Create bill payment record
      const [billPayment] = await BillPayment.create([{
        userId,
        traceId,
        serviceType,
        serviceId,
        customerReference,
        amount: amount,
        status: "PENDING",
        meta: { originalAmount: amount }
      }], { session }); 

      // 3. Initiate Transaction
      const providerResp = await providerFn();

      console.log({ providerResp })

      if(providerResp.status === "success") {

          // 5. Call Bill Payment provider
        let providerResponse, initTrxn;

        try {
          providerResponse = await txnProvider();
          // 4. Complete Transaction (if Success)
          if(providerResp.status === "00") {
            initTrxn = await TransferService.completeTransfer(providerResp.reference, "bill-payment");

            // 6. Mark COMPLETED (if Success)
            billPayment.status = "COMPLETED";
            billPayment.processedAt = new Date();
            billPayment.meta = { ...billPayment.meta, providerResp };
            await billPayment.save({ session });

            // 7. Update ledger Debit (COMPLETED)
            await LedgerService.createDoubleEntry(
              traceId,
              `user_wallet:${userId}`,
              `bill-payment:${serviceType}`,
              amount,
              "bill-payment",
              {
                userId: userId,
                subtype: serviceType,
                idempotencyKey,
                session,
                meta: {
                  billPaymentId: billPayment._id,
                  transactionId: initTrxn?.transferId || ""
                }
              }
            );

            const result = { traceId, status: "COMPLETED" as "FAILED" | "COMPLETED", billPayment, message: "Bill payment completed successfully" };

            return result;
          }
        } catch (err: any) {
          // 4. Fail Transaction (if Error)
          await TransferService.failTransfer(providerResponse?.reference || "");
          // 6. Mark Failed (if Error)
          console.log({ err, traceId, status: "FAILED" as "FAILED" | "COMPLETED", billPayment, message: err?.response?.data?.message || err.message })
          billPayment.status = "FAILED";
          await billPayment.save({ session });
          throw new APIError(err?.response?.data?.message || err.message);
        }
      }

      // 5. Fail Bill Payment
      billPayment.status = "FAILED";
      await billPayment.save({ session });
      return { traceId, status: "FAILED" as "FAILED" | "COMPLETED", billPayment, message: providerResp.message };
    }) as any;
  } finally {
    await session.endSession();
  }
}
