/**
 * Transfers Poller Worker
 * Polls pending transfers and handles reconciliation
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { Transfer } from '../../modules/transfers/transfer.model';
import { Transfer as ITransfer } from '../../modules/transfers/transfer.interface';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import pino from 'pino';

const logger = pino({ name: 'transfers-poller' });

interface VfdTransactionResponse {
  status: string;
  message?: string;
  data?: any;
}

export class TransfersPoller {
  private static vfdProvider = new VfdProvider();

  static register() {
    WorkerControlService.register('transfers-poller', async () => {
      const settings = await SettingsService.getSettings();
      let schedule: any = { every: 30000 }; // 30 seconds
      if (settings.workersConfig?.has('transfers-poller')) {
        const config = settings.workersConfig.get('transfers-poller');
        if (config?.cronSchedule) schedule = config.cronSchedule;
      }

      await QueueService.removeRepeatableJobs('transfers-poller');
      await QueueService.scheduleRepeatableJob('transfers-poller', schedule);

      return QueueService.createWorker(
        'transfers-poller',
        async () => {
          await this.pollPendingTransfers();
        }
      );
    });
  }

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start('transfers-poller');
  }

  private static async pollPendingTransfers() {
    const batchSize = parseInt(process.env.POLL_BATCH_SIZE || '100');
    // Import p-limit dynamically or use require if preferred in this environment
    // using require for simplicity in CommonJS/TS mix
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(5); // Concurrency limit of 5

    const refundTimeoutMs = parseInt(process.env.REFUND_TIMEOUT_MS || '86400000');

    try {
      await WorkerLogService.log('transfers-poller', 'info', 'Starting poll cycle');
      const pendingTransfers = await Transfer.find({
        status: 'PENDING'
      })
        .sort({ createdAt: 1 })
        .limit(batchSize);

      logger.info(`Polling ${pendingTransfers.length} pending transfers`);
      await WorkerControlService.reportActivity('transfers-poller', `Polling ${pendingTransfers.length} transfers`);

      if (pendingTransfers.length > 0) {
        await WorkerLogService.log('transfers-poller', 'info', `Polling ${pendingTransfers.length} pending transfers`);
      }

      // Process in parallel with limit
      await Promise.all(
        pendingTransfers.map((transfer) =>
          limit(async () => {
            try {
              const ageMs = Date.now() - transfer.createdAt.getTime();
              const STALE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

              if (ageMs > STALE_TIMEOUT) {
                // Optimization: Move to MANUAL_REVIEW instead of auto-refund to prevent fraud
                transfer.status = 'MANUAL_REVIEW';
                transfer.meta = { ...transfer.meta, reviewReason: 'Stale pending > 24h' };
                await transfer.save();
                await WorkerLogService.log('transfers-poller', 'warn', `Transfer ${transfer._id} moved to MANUAL_REVIEW (Stale > 24h)`);
                return;
              }

              // Query provider status
              // Optimization: Only query if we have a reference. 
              // If no reference and old enough (e.g. 5 mins), it likely failed initiation.
              if (transfer.reference) {
                const providerStatus = await this.vfdProvider.queryTransaction(transfer.reference);
                await this.updateTransferStatus(transfer, providerStatus);
              } else if (ageMs > 5 * 60 * 1000) {
                // No reference after 5 mins? Likely failed to send to provider.
                await this.refundTransfer(transfer);
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              logger.error({
                transferId: transfer._id,
                error: errorMessage
              }, 'Error polling transfer');
              await WorkerLogService.log('transfers-poller', 'error', `Error polling transfer: ${errorMessage}`, { transferId: transfer._id });
            }
          })
        )
      );

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error in transfers poller');
      await WorkerLogService.log('transfers-poller', 'error', `Fatal error in transfers poller: ${errorMessage}`);
    }
  }

  private static async updateTransferStatus(transfer: ITransfer, providerStatus: VfdTransactionResponse) {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {
        // Optimization: Handle "Success at Provider" -> Complete
        if (providerStatus.status === '00' || providerStatus.status === 'success' || providerStatus.status === 'successful') {
          // Transfer successful
          transfer.status = 'COMPLETED';
          transfer.processedAt = new Date();
          await transfer.save({ session });

          await WorkerLogService.log('transfers-poller', 'info', 'Transfer completed', { transferId: transfer._id });

          // Complete ledger entries
          await LedgerService.updateStatus(transfer.traceId, 'COMPLETED', session);

          // Create credit entry for beneficiary if intra-bank
          if (transfer.transferType === 'intra') {
            await LedgerService.createEntry({
              traceId: transfer.traceId,
              account: `user_wallet:${transfer.toAccount}`,
              entryType: 'CREDIT',
              category: 'transfer',
              amount: transfer.amount,
              status: 'COMPLETED'
            }, session);
          }

        } else if (providerStatus.status === 'FAILED' || providerStatus.status === 'failed') {
          // Transfer failed - refund user
          await this.refundTransfer(transfer, session);
        }
        // If still pending, continue polling
      });
    } finally {
      await session.endSession();
    }
  }

  private static async refundTransfer(transfer: ITransfer, session?: any) {
    const sessionToUse = session || await DatabaseService.startSession();
    const shouldEndSession = !session;

    try {
      await DatabaseService.withTransaction(sessionToUse, async () => {
        // Create refund ledger entry
        await LedgerService.createEntry({
          traceId: transfer.traceId,
          userId: transfer.userId,
          account: `user_wallet:${transfer.userId}`,
          entryType: 'CREDIT',
          category: 'refund',
          subtype: 'transfer-timeout',
          amount: transfer.amount,
          status: 'COMPLETED',
          meta: {
            originalTransferId: transfer._id,
            reason: 'Transfer timeout - auto refund'
          }
        }, sessionToUse);

        // Update transfer status
        transfer.status = 'FAILED';
        transfer.processedAt = new Date();
        transfer.meta = {
          ...transfer.meta,
          refundReason: 'Transfer timeout',
          autoRefunded: true
        };
        await transfer.save({ session: sessionToUse });

        logger.info({
          transferId: transfer._id,
          userId: transfer.userId,
          amount: transfer.amount
        }, 'Transfer auto-refunded due to timeout');
        await WorkerLogService.log('transfers-poller', 'warn', 'Transfer auto-refunded due to timeout', { transferId: transfer._id, amount: transfer.amount });
      });
    } finally {
      if (shouldEndSession) {
        await sessionToUse.endSession();
      }
    }
  }
}

// Start the poller if this file is run directly
if (require.main === module) {
  TransfersPoller.start().catch(console.error);
}