/**
 * Bill Payments Poller Worker
 * Polls pending bill payments and updates status based on provider responses
 */
import { QueueService } from '../../shared/queue';
import { BillPayment } from '../../modules/bill-payments/bill-payment.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import pino from 'pino';
import axios from 'axios';
import { TransferService } from '../../modules/transfers/transfer.service';
import User from '../../modules/users/user.model';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { UuidService } from '../../shared/utils/uuid';
import { TransferRequest } from '../../shared/providers/vfd.provider';
import { sha512 } from 'js-sha512';

const logger = pino({ name: 'bill-payments-poller' });

type FlutterwaveResponse<T = any> = {
  status: string; // "success" | "error"
  message?: string;
  data?: T;
};

function fwHeaders() {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing FLUTTERWAVE_SECRET_KEY in environment");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function flutterwaveGet<T = any>(path: string, params?: Record<string, any>) {
  const url = `https://api.flutterwave.com${path}`;
  const res = await axios.get<FlutterwaveResponse<T>>(url, {
    headers: fwHeaders(),
    params,
  });
  return res.data;
}

export class BillPaymentsPoller {
  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();

    const worker = QueueService.createWorker(
      'bill-payments-poller',
      async () => {
        await this.pollPendingBillPayments();
      },
      {
        repeat: { every: 2 * 60 * 60 * 1000 }, // 2 hours
        removeOnComplete: 10,
        removeOnFail: 50
      }
    );

    logger.info('Bill payments poller started');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      await worker.close();
      await QueueService.closeAll();
    });
  }

  private static async pollPendingBillPayments() {
    const batchSize = parseInt(process.env.POLL_BATCH_SIZE || '100');

    try {
      const pendingPayments = await BillPayment.find({
        status: 'PENDING'
      })
      .sort({ createdAt: 1 })
      .limit(batchSize);

      logger.info(`Polling ${pendingPayments.length} pending bill payments`);

      for (const payment of pendingPayments) {
        try {
          const resp = await flutterwaveGet(`/v3/bills/${encodeURIComponent(payment?.providerRef || "")}`);
          const { data } = resp;

          if (data.status === 'success') {
            await this.refundBillPayment(payment);
            continue;
          }
        } catch (error: any) {
          logger.error({ 
            billPaymentId: payment._id, 
            error: error.message 
          }, 'Error polling bill payment');
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in bill payments poller');
    }
  }

  private static async refundBillPayment(payment: any) {
    const session = await DatabaseService.startSession();
    const vfdProvider = new VfdProvider();

    const user = await User.findById(payment._id);
    if (!user) { 
      logger.info({ 
        billPaymentId: payment._id,
        userId: payment.userId,
        amount: payment.amount
      }, 'Bill payment refund error: User Not Found');
      return;
    }
    const from = (await vfdProvider.getAccountInfo(user ? user.user_metadata?.accountNo : "trx-user")).data;
    const to = (await vfdProvider.getPrimeAccountInfo()).data;

    const result = await TransferService.initiateTransfer({
      fromAccount: to.accountNo,
      userId: user._id,
      toAccount: from.accountNo,
      beneficiaryName: from.client,
      amount: payment.amount,
      transferType: "intra",
      bankCode: "999999",
      remark: `${payment.serviceType} purchase refund`,
      walletBalance: String(to.accountBalance),
      idempotencyKey: UuidService.generate()
    }, "bill-payment");

    try {
      await DatabaseService.withTransaction(session, async () => {
        // 2) Send transfer to VFD (the banking provider)
        const transferReq: TransferRequest = {
          uniqueSenderAccountId: "",
          fromAccount: to.accountNo,
          fromClientId: to.clientId,
          fromClient: to.client,
          fromSavingsId: to.accountId,
          toAccount: from.accountNo,
          toClient: from.client,
          toSession: from.accountId,
          toClientId: from.clientId,
          toSavingsId: from.accountId,
          toBank: "999999",
          signature: sha512.hex(`${to.accountNo}${from.accountNo}`),
          amount: payment.amount,
          remark: `${payment.serviceType} purchase refund`,
          transferType: "intra",
          reference: result.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);

        if (vfdResult.status == "00") {
          await TransferService.completeTransfer(result.reference);
          // Create refund ledger entry
          await LedgerService.createEntry({
            traceId: payment.traceId,
            userId: payment.userId,
            account: `user_wallet:${payment.userId}`,
            entryType: 'CREDIT',
            category: 'refund',
            subtype: 'bill-payment-timeout',
            amount: payment.amount,
            status: 'COMPLETED',
            meta: {
              originalBillPaymentId: payment._id,
              reason: 'Provider timeout - auto refund'
            }
          }, session);

          // Update bill payment status
          payment.status = 'FAILED';
          payment.processedAt = new Date();
          payment.meta = { 
            ...payment.meta, 
            refundReason: 'Provider timeout',
            autoRefunded: true 
          };
          
          payment.save({ session });

          logger.info({ 
            billPaymentId: payment._id,
            userId: payment.userId,
            amount: payment.amount
          }, 'Bill payment auto-refunded due to timeout');
        } else {
          await TransferService.failTransfer(result.reference);
          logger.info({ 
            billPaymentId: payment._id,
            userId: payment.userId,
            amount: payment.amount
          }, 'Bill payment refund failed');
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in bill payments poller');
      await TransferService.failTransfer(result.reference);
    } finally {
      await session.endSession();
    }
  }
}

// Start the poller if this file is run directly
if (require.main === module) {
  BillPaymentsPoller.start().catch(console.error);
}