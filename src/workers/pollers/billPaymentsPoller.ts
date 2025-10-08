/**
 * Bill Payments Poller Worker
 * Polls pending bill payments and updates status based on provider responses
 */
import { QueueService } from '../../shared/queue';
import { BillPayment } from '../../modules/bill-payments/bill-payment.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import pino from 'pino';

const logger = pino({ name: 'bill-payments-poller' });

export class BillPaymentsPoller {
  static async start() {
    await DatabaseService.connect();

    const worker = QueueService.createWorker(
      'bill-payments-poller',
      async () => {
        await this.pollPendingBillPayments();
      },
      {
        repeat: { every: 30000 }, // 30 seconds
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
    const refundTimeoutMs = parseInt(process.env.REFUND_TIMEOUT_MS || '86400000'); // 24h

    try {
      const pendingPayments = await BillPayment.find({
        status: 'PENDING'
      })
      .sort({ createdAt: 1 })
      .limit(batchSize);

      logger.info(`Polling ${pendingPayments.length} pending bill payments`);

      for (const payment of pendingPayments) {
        try {
          // Check if payment is too old (24h) - auto-refund
          const ageMs = Date.now() - payment.createdAt.getTime();
          if (ageMs > refundTimeoutMs) {
            await this.refundBillPayment(payment);
            continue;
          }

          // Query provider status (placeholder)
          // const providerStatus = await this.queryProviderStatus(payment);
          // await this.updatePaymentStatus(payment, providerStatus);

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

    try {
      await DatabaseService.withTransaction(session, async () => {
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
      });
    } finally {
      await session.endSession();
    }
  }
}

// Start the poller if this file is run directly
if (require.main === module) {
  BillPaymentsPoller.start().catch(console.error);
}