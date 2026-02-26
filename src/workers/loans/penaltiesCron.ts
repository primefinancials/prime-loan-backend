/**
 * Loan Penalties & Reminder Cron Worker
 * - Applies daily penalties to overdue loans
 * - Sends reminders for loans due today and tomorrow
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import Loan from '../../modules/loans/loan.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';
import { NotificationService } from '../../modules/notifications/notification.service';
import { UserService } from '../../modules/users/user.service';
import pino from 'pino';
import { LoanService } from '../../modules/loans/loan.service';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';

const logger = pino({ name: 'loan-penalties-cron' });

export class LoanPenaltiesCron {
  static register() {
    WorkerControlService.register('loan-penalties', async () => {
      const settings = await SettingsService.getSettings();
      let schedule = '0 */2 * * *'; // Every 2 hours
      if (settings.workersConfig?.has('loan-penalties')) {
        const config = settings.workersConfig.get('loan-penalties');
        if (config?.cronSchedule) schedule = config.cronSchedule;
      }

      await QueueService.removeRepeatableJobs('loan-penalties');
      await QueueService.scheduleRepeatableJob('loan-penalties', schedule);

      return QueueService.createWorker(
        'loan-penalties',
        async () => {
          await this.processLoans();
        }
      );
    });
  }

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start('loan-penalties');
  }

  private static async processLoans() {
    const penaltyRate = 0.1;

    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    try {
      // Pull all active loans with outstanding balances
      const loans = await Loan.find({
        status: 'accepted',
        outstanding: { $gt: 0 }
      });

      logger.info(`Processing ${loans.length} loans for penalties & reminders`);
      await WorkerControlService.reportActivity('loan-penalties', `Processing ${loans.length} loans`);

      if (loans.length > 0) {
        await WorkerLogService.log('loan-penalties', 'info', `Processing ${loans.length} loans for penalties & reminders`);
      }

      for (const loan of loans) {
        try {
          const repaymentDateISO = new Date(loan.repayment_date).toISOString().split('T')[0];
          const user = await UserService.getUser(loan.userId);

          if (!user || Array.isArray(user)) continue;

          if (repaymentDateISO < todayISO) {
            // OVERDUE
            await this.applyPenaltyToLoan(loan, penaltyRate);

            if (user && Number(user.user_metadata.wallet || 0) > 0)
              try {
                await LoanService.repayLoan({
                  loanId: loan._id,
                  userId: user._id,
                  amount: Number(user.user_metadata.wallet)
                })
              } catch (error: any) {
                logger.error({ loanId: loan._id, error: error.message }, 'Error repaying loan');
                await WorkerLogService.log('loan-penalties', 'error', `Error repaying loan: ${error.message}`, { loanId: loan._id });
              }

            await NotificationService.sendLoanOverdue(user, loan);
          } else if (repaymentDateISO === todayISO) {
            // DUE TODAY
            await NotificationService.sendLoanDueToday(user, loan);
          } else if (repaymentDateISO === tomorrowISO) {
            // DUE TOMORROW
            await NotificationService.sendLoanDueTomorrow(user, loan);
          }
        } catch (err: any) {
          logger.error({ loanId: loan._id, error: err.message }, 'Error processing loan');
          await WorkerLogService.log('loan-penalties', 'error', `Error processing loan: ${err.message}`, { loanId: loan._id });
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Error in loan penalties cron');
      await WorkerLogService.log('loan-penalties', 'error', `Fatal error in loan penalties cron: ${err.message}`);
    }
  }

  private static async applyPenaltyToLoan(loan: any, penaltyRate: number) {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {
        const today = new Date();
        const lastPenaltyDate = loan.lastInterestAdded ? new Date(loan.lastInterestAdded) : null;

        let daysSinceLastPenalty = 0;
        if (lastPenaltyDate) {
          const diffTime = today.getTime() - lastPenaltyDate.getTime();
          daysSinceLastPenalty = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        }

        if (daysSinceLastPenalty === 0) return; // same day, skip penalty

        const penaltyAmount = Math.floor(loan.amount * penaltyRate) * daysSinceLastPenalty;
        const traceId = UuidService.generateTraceId();

        // Ledger entry for penalty
        await LedgerService.createDoubleEntry(
          traceId,
          `user_wallet:${loan.userId}`,
          'platform_revenue',
          penaltyAmount,
          'loan',
          {
            userId: loan.userId,
            subtype: 'penalty',
            session,
            meta: {
              loanId: loan._id,
              penaltyRate,
              originalAmount: loan.amount
            }
          }
        );

        // Update loan
        loan.outstanding = Number(loan.outstanding) + penaltyAmount;
        loan.lastInterestAdded = new Date().toISOString();
        loan.repayment_history = [
          ...(loan.repayment_history || []),
          {
            amount: penaltyAmount,
            outstanding: loan.outstanding,
            action: 'penalty',
            date: new Date().toISOString()
          }
        ];

        await loan.save({ session });

        logger.info({
          loanId: loan._id,
          userId: loan.userId,
          penaltyAmount,
          newOutstanding: loan.outstanding
        }, 'Penalty applied to overdue loan');
        await WorkerLogService.log('loan-penalties', 'warn', 'Penalty applied to overdue loan', { loanId: loan._id, penaltyAmount, newOutstanding: loan.outstanding });
      });
    } finally {
      await session.endSession();
    }
  }
}

// Run if executed directly
if (require.main === module) {
  LoanPenaltiesCron.start().catch(console.error);
}
