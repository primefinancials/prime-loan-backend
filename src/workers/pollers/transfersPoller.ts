/**
 * Transfers Poller Worker
 * Polls pending transfers and handles reconciliation
 */
import { QueueService } from '../../shared/queue';
import { Transfer } from '../../modules/transfers/transfer.model';
import { Transfer as ITransfer } from '../../modules/transfers/transfer.interface';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import pino from 'pino';

const logger = pino({ name: 'transfers-poller' });

interface VfdTransactionResponse {
  status: string;
  message?: string;
  data?: any;
}

export class TransfersPoller {
  private static vfdProvider = new VfdProvider();

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();

    const worker = QueueService.createWorker(
      'transfers-poller',
      async () => {
        await this.pollPendingTransfers();
      },
      {
        repeat: { every: 30000 }, // 30 seconds
        removeOnComplete: 10,
        removeOnFail: 50
      }
    );

    logger.info('Transfers poller started');

    process.on('SIGTERM', async () => {
      await worker.close();
      await QueueService.closeAll();
    });
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
      const pendingTransfers = await Transfer.find({
        status: 'PENDING'
      })
        .sort({ createdAt: 1 })
        .limit(batchSize);

      logger.info(`Polling ${pendingTransfers.length} pending transfers`);

      // Process in parallel with limit
      await Promise.all(
        pendingTransfers.map((transfer) =>
          limit(async () => {
            try {
              const ageMs = Date.now() - transfer.createdAt.getTime();

              if (ageMs > refundTimeoutMs) {
                await this.refundTransfer(transfer);
                return;
              }

              // Query provider status
              if (transfer.reference) {
                const providerStatus = await this.vfdProvider.queryTransaction(transfer.reference);
                await this.updateTransferStatus(transfer, providerStatus);
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              logger.error({
                transferId: transfer._id,
                error: errorMessage
              }, 'Error polling transfer');
            }
          })
        )
      );

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error in transfers poller');
    }
  }

  private static async updateTransferStatus(transfer: ITransfer, providerStatus: VfdTransactionResponse) {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {
        if (providerStatus.status === '00') {
          // Transfer successful
          transfer.status = 'COMPLETED';
          transfer.processedAt = new Date();
          await transfer.save({ session });

          // Complete ledger entries
          await LedgerService.updateStatus(transfer.traceId, 'COMPLETED', session);

          // Create credit entry for beneficiary if intra-bank
          if (transfer.transferType === 'intra') {
            // For intra-bank, we credit the beneficiary wallet
            // Note: The 'category' should arguably be derived from transfer metadata or type,
            // but 'transfer' is the default for generic transfers.
            // Improvements for BillPayments specific types handled in service layer.
            await LedgerService.createEntry({
              traceId: transfer.traceId,
              account: `user_wallet:${transfer.toAccount}`,
              entryType: 'CREDIT',
              category: 'transfer',
              amount: transfer.amount,
              status: 'COMPLETED'
            }, session);
          }

        } else if (providerStatus.status === 'FAILED') {
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