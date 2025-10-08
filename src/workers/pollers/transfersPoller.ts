/**
 * Transfers Poller Worker
 * Polls pending transfers and handles reconciliation
 */
import { QueueService } from '../../shared/queue';
import { Transfer } from '../../modules/transfers/transfer.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import pino from 'pino';

const logger = pino({ name: 'transfers-poller' });

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
    const refundTimeoutMs = parseInt(process.env.REFUND_TIMEOUT_MS || '86400000');

    try {
      const pendingTransfers = await Transfer.find({
        status: 'PENDING'
      })
      .sort({ createdAt: 1 })
      .limit(batchSize);

      logger.info(`Polling ${pendingTransfers.length} pending transfers`);

      for (const transfer of pendingTransfers) {
        try {
          const ageMs = Date.now() - transfer.createdAt.getTime();
          
          if (ageMs > refundTimeoutMs) {
            await this.refundTransfer(transfer);
            continue;
          }

          // Query provider status
          if (transfer.reference) {
            const providerStatus = await this.vfdProvider.queryTransaction(transfer.reference);
            await this.updateTransferStatus(transfer, providerStatus);
          }

        } catch (error: any) {
          logger.error({ 
            transferId: transfer._id, 
            error: error.message 
          }, 'Error polling transfer');
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in transfers poller');
    }
  }

  private static async updateTransferStatus(transfer: any, providerStatus: any) {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {
        if (providerStatus.status === '00') {
          // Transfer successful
          transfer.status = 'COMPLETED';
          transfer.processedAt = new Date();
          await transfer.save({ session });

          // Complete ledger entries
          await LedgerService.updateStatus(transfer._id, 'COMPLETED', session);

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

  private static async refundTransfer(transfer: any, session?: any) {
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