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
import { FlutterwaveDebitProvider } from '../../shared/providers/flutterwave-debit.provider';
import { AutoDebit } from '../../modules/loans/auto-debit.model';
import { AutoDebitLog } from '../../modules/loans/auto-debit-log.model';

const logger = pino({ name: 'loan-penalties-cron' });

export class LoanPenaltiesCron {
  static register() {
    WorkerControlService.register('loan-penalties', async () => {
      const settings = await SettingsService.getSettings();
      let schedule = '*/5 * * * *'; // Default: Every 5 minutes

      const workersConfig = settings.workersConfig as any;
      if (workersConfig && typeof workersConfig.get === 'function' && workersConfig.has('loan-penalties')) {
        const config = workersConfig.get('loan-penalties');
        if (config && config.cronSchedule && config.cronSchedule.trim() !== '') {
          schedule = config.cronSchedule;
        }
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
    // Read penalty rate from admin settings (dailyRate is stored as 1 = 1%, convert to decimal)
    const settings = await SettingsService.getSettings();
    const penaltyRate = (settings.loan?.penalty?.dailyRate || 1) / 100; // 1 → 0.01 (1%)

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

      const penalizedUsers: { email?: string, phone?: string, amount?: number }[] = [];
      const deductedUsers: { email?: string, phone?: string }[] = [];

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

          // 1. Penalty (Only for overdue)
          let penaltyAmount = 0;
          if (repaymentDateISO < todayISO) {
            penaltyAmount = await this.applyPenaltyToLoan(loan, penaltyRate);
            if (penaltyAmount > 0) {
              penalizedUsers.push({ email: user.email, phone: user.user_metadata?.phone, amount: penaltyAmount });
            }
          }

          // 2. Deduction (Only for overdue)
          if (repaymentDateISO < todayISO) {
            const walletBalance = Number(user.user_metadata?.wallet || 0);
            const outstanding = Number(loan.outstanding || 0);
            const repaymentAmount = Math.min(walletBalance, outstanding);

            if (walletBalance > 0 && repaymentAmount > 0) {
              try {
                await LoanService.repayLoan({
                  loanId: loan._id,
                  userId: user._id,
                  amount: repaymentAmount
                });
                deductedUsers.push({ email: user.email, phone: user.user_metadata?.phone });
                await WorkerLogService.log('loan-penalties', 'info', `Auto-deducted wallet balance for overdue loan for ${user.email || user.user_metadata?.phone}`, { userId: user._id, loanId: loan._id });
              } catch (error: any) {
                logger.error({ loanId: loan._id, error: error.message }, 'Error repaying loan');
                await WorkerLogService.log('loan-penalties', 'error', `Error repaying loan: ${error.message}`, { loanId: loan._id });
              }
            }

            // 3. Flutterwave Auto-Debit Fallback
            // If wallet was insufficient and user has a linked payment method, try auto-debit
            const refreshedUser = await UserService.getUser(loan.userId);
            if (refreshedUser && !Array.isArray(refreshedUser)) {
              const updatedWallet = Number(refreshedUser.user_metadata?.wallet || 0);
              const remainingOutstanding = Number(loan.outstanding || 0);

              if (updatedWallet < remainingOutstanding && settings.autoDebit?.enabled !== false) {
                const debitAmount = remainingOutstanding - updatedWallet;
                const minDebit = settings.autoDebit?.minDebitAmount || 100;

                if (debitAmount >= minDebit) {
                  try {
                    // Attempt auto-debit every cron run (no daily limit)
                    // Find the user's active linked payment method (prefer card)
                    const linkedMethod = await AutoDebit.findOne({
                      userId: String(refreshedUser._id),
                      status: 'active'
                    }).sort({ type: 1 }); // card sorts before bank

                      if (linkedMethod) {
                        const fwProvider = new FlutterwaveDebitProvider();
                        const reference = `loan-debit-${loan._id}-${Date.now()}`;

                        let debitResult: any;

                        if (linkedMethod.type === 'card') {
                          debitResult = await fwProvider.chargeToken({
                            token: linkedMethod.token,
                            email: linkedMethod.email,
                            amount: debitAmount,
                            txRef: reference,
                          });
                        } else {
                          // Bank direct debit
                          debitResult = await fwProvider.initiateDirectDebit({
                            accountNumber: linkedMethod.accountNumber || '',
                            bankCode: linkedMethod.bankName || '',
                            email: linkedMethod.email,
                            amount: debitAmount,
                            txRef: reference,
                            narration: `Prime Finance Loan Repayment - Loan ${loan._id}`,
                          });
                        }

                        const wasSuccessful = debitResult?.status === 'success' || debitResult?.data?.status === 'successful';

                        await AutoDebitLog.create({
                          loanId: loan._id,
                          userId: String(refreshedUser._id),
                          type: linkedMethod.type,
                          amount: debitAmount,
                          reference,
                          token: linkedMethod.token,
                          status: wasSuccessful ? 'successful' : 'pending',
                          provider: 'flutterwave',
                          providerResponse: debitResult,
                        });

                        if (wasSuccessful) {
                          await LoanService.repayLoan({
                            loanId: loan._id,
                            userId: refreshedUser._id,
                            amount: debitAmount
                          });
                        }

                        await WorkerLogService.log('loan-penalties', 'info',
                          `Flutterwave auto-debit (${linkedMethod.type}) initiated for ${refreshedUser.email}: ₦${debitAmount}`,
                          { userId: refreshedUser._id, loanId: loan._id, reference, type: linkedMethod.type }
                        );
                      }
                  } catch (fwErr: any) {
                    logger.error({ loanId: loan._id, error: fwErr.message }, 'Flutterwave auto-debit failed');
                    await WorkerLogService.log('loan-penalties', 'error',
                      `Flutterwave auto-debit failed: ${fwErr.message}`,
                      { loanId: loan._id }
                    );
                  }
                }
              }
            }
          }

          // 3. Reminders (Overdue, Due Today, Due Tomorrow)
          const timeSinceLastReminder = loan.lastRemindedAt ? today.getTime() - new Date(loan.lastRemindedAt).getTime() : Infinity;
          const hoursSinceLastReminder = timeSinceLastReminder / (1000 * 60 * 60);

          let isNewDay = true;
          if (loan.lastRemindedAt) {
            const lastReminderDateISO = new Date(loan.lastRemindedAt).toISOString().split('T')[0];
            if (lastReminderDateISO === todayISO) {
              isNewDay = false;
            }
          }

          const currentRemindersToday = isNewDay ? 0 : (loan.remindersToday || 0);
          const maxCallsPerDay = (settings.defaulterCallConfig as any)?.maxCallsPerDay || 4;

          let shouldRemind = false;
          if (currentRemindersToday < maxCallsPerDay) {
            if (currentRemindersToday === 0 || hoursSinceLastReminder >= 4) {
              shouldRemind = true;
            }
          }

          if (shouldRemind) {
            let reminded = false;
            if (repaymentDateISO < todayISO) {
              await NotificationService.sendLoanOverdue(user, loan);
              reminded = true;
            } else if (repaymentDateISO === todayISO) {
              await NotificationService.sendLoanDueToday(user, loan);
              reminded = true;
            } else if (repaymentDateISO === tomorrowISO) {
              await NotificationService.sendLoanDueTomorrow(user, loan);
              reminded = true;
            }

            if (reminded) {
              await Loan.updateOne(
                { _id: loan._id },
                {
                  $set: {
                    lastRemindedAt: today.toISOString(),
                    remindersToday: currentRemindersToday + 1
                  }
                }
              );
            }
          }
        } catch (err: any) {
          logger.error({ loanId: loan._id, error: err.message }, 'Error processing loan');
          await WorkerLogService.log('loan-penalties', 'error', `Error processing loan: ${err.message}`, { loanId: loan._id });
        }
      }

      // Log the summary of the cycle
      await WorkerLogService.log('loan-penalties', 'info', `Finished cycle. Penalized ${penalizedUsers.length} users, deducted wallet for ${deductedUsers.length} users.`, {
        penalizedUsers,
        deductedUsers
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Error in loan penalties cron');
      await WorkerLogService.log('loan-penalties', 'error', `Fatal error in loan penalties cron: ${err.message}`);
    }
  }

  private static async applyPenaltyToLoan(loan: any, penaltyRate: number): Promise<number> {
    const session = await DatabaseService.startSession();
    let appliedPenalty = 0;

    try {
      await DatabaseService.withTransaction(session, async () => {
        const today = new Date();
        const lastPenaltyDate = loan.lastInterestAdded ? new Date(loan.lastInterestAdded) : null;

        let daysSinceLastPenalty = 0;
        if (lastPenaltyDate) {
          const diffTime = today.getTime() - lastPenaltyDate.getTime();
          daysSinceLastPenalty = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        }

        if (daysSinceLastPenalty === 0) return 0; // same day, skip penalty

        appliedPenalty = Math.floor(loan.amount * penaltyRate) * daysSinceLastPenalty;
        const traceId = UuidService.generateTraceId();

        // Ledger entry for penalty
        await LedgerService.createDoubleEntry(
          traceId,
          `user_wallet:${loan.userId}`,
          'platform_revenue',
          appliedPenalty,
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
        loan.outstanding = Number(loan.outstanding) + appliedPenalty;
        loan.lastInterestAdded = new Date().toISOString();
        loan.repayment_history = [
          ...(loan.repayment_history || []),
          {
            amount: appliedPenalty,
            outstanding: loan.outstanding,
            action: 'penalty',
            date: new Date().toISOString()
          }
        ];

        await loan.save({ session });

        logger.info({
          loanId: loan._id,
          userId: loan.userId,
          appliedPenalty,
          newOutstanding: loan.outstanding
        }, 'Penalty applied to overdue loan');
        await WorkerLogService.log('loan-penalties', 'warn', 'Penalty applied to overdue loan', { loanId: loan._id, appliedPenalty, newOutstanding: loan.outstanding });
      });
      return appliedPenalty;
    } finally {
      await session.endSession();
    }
  }
}

// Run if executed directly
if (require.main === module) {
  LoanPenaltiesCron.start().catch(console.error);
}
