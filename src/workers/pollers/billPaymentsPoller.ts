/**
 * Bill Payments Poller Worker
 * Polls pending bill payments and updates status based on provider responses
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { BillPayment } from '../../modules/bill-payments/bill-payment.model';
import { IBillPayment } from '../../modules/bill-payments/bill-payment.interface';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import pino from 'pino';
import axios from 'axios';
import { TransferService } from '../../modules/transfers/transfer.service';
import User from '../../modules/users/user.model';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { UuidService } from '../../shared/utils/uuid';
import { TransferRequest } from '../../shared/providers/vfd.provider';
import { sha512 } from 'js-sha512';
import { WorkerControlService } from '../../modules/workers/worker-control.service';

const logger = pino({ name: 'bill-payments-poller' });

interface FlutterwaveBillData {
  status: string;
  amount: number;
  currency: string;
  tx_ref: string;
}

type FlutterwaveResponse<T = FlutterwaveBillData> = {
  status: string; // "success" | "error"
  message?: string;
  data: T;
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
  static register() {
    WorkerControlService.register('bill-payments-poller', async () => {
      const settings = await SettingsService.getSettings();
      let schedule: any = { pattern: '*/5 * * * *' }; // Every 5 minutes
      if (settings.workersConfig?.has('bill-payments-poller')) {
        const config = settings.workersConfig.get('bill-payments-poller');
        if (config?.cronSchedule) schedule = config.cronSchedule;
      }

      await QueueService.removeRepeatableJobs('bill-payments-poller');
      await QueueService.scheduleRepeatableJob('bill-payments-poller', schedule);

      return QueueService.createWorker(
        'bill-payments-poller',
        async () => {
          await this.pollPendingBillPayments();
        }
      );
    });
  }

  static async start() {
    // Legacy support or direct start
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start('bill-payments-poller');
  }

  private static async pollPendingBillPayments() {
    const batchSize = parseInt(process.env.POLL_BATCH_SIZE || '100');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(5);

    try {
      const pendingPayments = await BillPayment.find({
        status: 'PENDING'
      })
        .sort({ createdAt: 1 })
        .limit(batchSize);

      logger.info(`Polling ${pendingPayments.length} pending bill payments`);
      await WorkerControlService.reportActivity('bill-payments-poller', `Polling ${pendingPayments.length} payments`);

      if (pendingPayments.length === 0) return;

      const { PayBetaProvider } = await import('../../shared/providers/paybeta.provider');
      const { InfluencerService } = await import('../../modules/influencer/influencer.service');
      const payBeta = new PayBetaProvider();

      await Promise.all(
        pendingPayments.map((payment) =>
          limit(async () => {
            try {
              const createdAt = new Date(payment.createdAt);
              const now = new Date();
              const diffHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

              if (diffHours > 24) {
                payment.status = 'MANUAL_REVIEW' as any;
                payment.meta = { ...payment.meta, reviewReason: 'Stale pending > 24h' };
                await payment.save();
                await WorkerLogService.log('bill-payments-poller', 'warn', `Payment ${payment._id} moved to MANUAL_REVIEW (Stale > 24h)`);
                return;
              }

              const provider = payment.meta?.provider || 'flutterwave';
              let isSuccess = false;
              let isFailed = false;

              if (provider === 'paybeta') {
                const pbResp = await payBeta.queryTransaction(payment.providerRef || "");
                isSuccess = pbResp.status === 'successful';
                isFailed = pbResp.status === 'failed';
              } else {
                const fwResp = await flutterwaveGet(`/v3/bills/${encodeURIComponent(payment?.providerRef || "")}`);
                isSuccess = fwResp.status === 'success' && (fwResp.data?.status === 'successful' || fwResp.data?.status === 'success');
                isFailed = fwResp.status === 'error' || fwResp.data?.status === 'failed' || fwResp.data?.status === 'error';
              }

              if (isSuccess) {
                const session = await DatabaseService.startSession();
                try {
                  await DatabaseService.withTransaction(session, async () => {
                    payment.status = 'COMPLETED';
                    payment.processedAt = new Date();
                    await payment.save({ session });

                    await LedgerService.updateStatus(payment.traceId, 'COMPLETED', session);

                    // Trigger Commission on SUCCESSFUL resolution
                    try {
                      await InfluencerService.recordCommissionForUser(
                        payment.userId,
                        'bill-payment',
                        payment.amount,
                        payment.traceId,
                        payment.referralCode
                      );
                    } catch (infErr) {
                      logger.warn({ billPaymentId: payment._id, error: (infErr as Error).message }, 'Commission recording failed during polling');
                    }

                    logger.info({ billPaymentId: payment._id }, 'Bill payment resolved as COMPLETED via poller');
                  });
                } finally {
                  await session.endSession();
                }

              } else if (isFailed) {
                await this.refundBillPayment(payment);
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              logger.error({
                billPaymentId: payment._id,
                error: errorMessage
              }, 'Error polling bill payment');
            }
          })
        )
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error in bill payments poller');
    }
  }

  private static async refundBillPayment(payment: IBillPayment) {
    const session = await DatabaseService.startSession();
    const vfdProvider = new VfdProvider();

    const user = await User.findById(payment.userId);

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
      userId: user._id as any,
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

          await payment.save({ session });

          logger.info({
            billPaymentId: payment._id,
            userId: payment.userId,
            amount: payment.amount
          }, 'Bill payment auto-refunded due to timeout');
          await WorkerLogService.log('bill-payments-poller', 'warn', `Bill payment auto-refunded due to timeout`, { billPaymentId: payment._id, amount: payment.amount });
        } else {
          await TransferService.failTransfer(result.reference);
          logger.info({
            billPaymentId: payment._id,
            userId: payment.userId,
            amount: payment.amount
          }, 'Bill payment refund failed');
        }
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error in bill payments poller');
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