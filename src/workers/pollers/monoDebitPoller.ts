/**
 * Mono Debit Poller — Safety-net for pending Mono direct debit statuses
 * Runs every 2 hours (webhook handles most real-time updates).
 */
import { QueueService } from '../../shared/queue';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { MonoDebitLog } from '../../modules/loans/mono-debit-log.model';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { LoanService } from '../../modules/loans/loan.service';
import { DatabaseService } from '../../shared/db';
import pino from 'pino';

const logger = pino({ name: 'mono-debit-poller' });

export class MonoDebitPoller {
  static register() {
    WorkerControlService.register('mono-debit-poller', async () => {
      await QueueService.removeRepeatableJobs('mono-debit-poller');
      await QueueService.scheduleRepeatableJob('mono-debit-poller', '0 */2 * * *'); // Every 2 hours (webhook handles most cases)

      return QueueService.createWorker(
        'mono-debit-poller',
        async () => {
          await this.pollPendingDebits();
        }
      );
    });
  }

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start('mono-debit-poller');
  }

  private static async pollPendingDebits() {
    try {
      const pendingDebits = await MonoDebitLog.find({
        status: { $in: ['initiated', 'pending'] }
      }).sort({ createdAt: 1 }).limit(50); // Process in batches

      if (pendingDebits.length === 0) return;

      logger.info(`Polling ${pendingDebits.length} pending Mono debits`);
      await WorkerControlService.reportActivity('mono-debit-poller', `Polling ${pendingDebits.length} pending debits`);

      const mono = new MonoProvider();
      let successCount = 0;
      let failCount = 0;

      for (const debit of pendingDebits) {
        try {
          if (!debit.paymentId) {
            // No payment ID — mark as failed
            debit.status = 'failed';
            debit.failureReason = 'No payment ID returned from Mono';
            await debit.save();
            failCount++;
            continue;
          }

          const paymentStatus = await mono.verifyPayment(debit.paymentId);

          if (paymentStatus.status === 'successful') {
            debit.status = 'successful';
            await debit.save();

            // Trigger loan repayment
            try {
              await LoanService.repayLoan({
                loanId: debit.loanId,
                userId: debit.userId,
                amount: debit.amount
              });
              logger.info({ loanId: debit.loanId, amount: debit.amount }, 'Mono debit repayment applied');
            } catch (repayErr: any) {
              logger.error({ loanId: debit.loanId, error: repayErr.message }, 'Failed to apply Mono debit repayment');
            }

            successCount++;
          } else if (paymentStatus.status === 'failed') {
            debit.status = 'failed';
            debit.failureReason = paymentStatus.message || 'Payment failed';
            await debit.save();
            failCount++;
          }
          // If still 'pending', leave it for the next polling cycle
        } catch (err: any) {
          logger.error({ debitId: debit._id, error: err.message }, 'Error polling Mono debit status');
        }
      }

      if (successCount > 0 || failCount > 0) {
        await WorkerLogService.log('mono-debit-poller', 'info',
          `Polling complete: ${successCount} successful, ${failCount} failed, ${pendingDebits.length - successCount - failCount} still pending`
        );
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Error in Mono debit poller');
      await WorkerLogService.log('mono-debit-poller', 'error', `Fatal error: ${err.message}`);
    }
  }
}
