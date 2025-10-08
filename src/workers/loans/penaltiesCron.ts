/**
 * Loan Penalties & Reminder Cron Worker
 * - Applies daily penalties to overdue loans
 * - Sends reminders for loans due today and tomorrow
 */
import { QueueService } from '../../shared/queue';
import Loan from '../../modules/loans/loan.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';
import { NotificationService } from '../../modules/notifications/notification.service';
import { UserService } from '../../modules/users/user.service';
import pino from 'pino';

const logger = pino({ name: 'loan-penalties-cron' });

export class LoanPenaltiesCron {
  static async start() {
    await DatabaseService.connect();

    // Run daily at midnight
    const worker = QueueService.createWorker(
      'loan-penalties',
      async () => {
        await this.processLoans();
      },
      {
        repeat: { pattern: '0 0 * * *' }, // Every midnight
        removeOnComplete: 5,
        removeOnFail: 10
      }
    );

    logger.info('Loan penalties & reminder cron started');

    process.on('SIGTERM', async () => {
      await worker.close();
      await QueueService.closeAll();
    });
  }

  private static async processLoans() {
    const penaltyRate = parseFloat(process.env.LOAN_PENALTY_PCT_PER_DAY || '1');

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

      for (const loan of loans) {
        try {
          const repaymentDateISO = new Date(loan.repayment_date).toISOString().split('T')[0];
          const user = await UserService.getUser(loan.userId);

          if (!user || Array.isArray(user)) continue;

          if (repaymentDateISO < todayISO) {
            // OVERDUE
            await this.applyPenaltyToLoan(loan, penaltyRate);
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
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Error in loan penalties cron');
    }
  }

  private static async applyPenaltyToLoan(loan: any, penaltyRate: number) {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {
        const today = new Date().toISOString().split('T')[0];
        const lastPenaltyDate = loan.lastInterestAdded?.split('T')[0];

        // Avoid duplicate penalty within the same day
        if (lastPenaltyDate === today) return;

        const penaltyAmount = Math.floor(loan.amount * penaltyRate); // in kobo
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
