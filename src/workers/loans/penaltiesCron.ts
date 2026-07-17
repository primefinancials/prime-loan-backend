/**
 * Loan Penalties & Reminder Cron Worker
 * - Applies daily penalties to overdue loans
 * - Sends reminders for loans due today and tomorrow
 * - Attempts auto-debit via Flutterwave when wallet is insufficient
 *
 * FIX (original): auto-debit bank path was passing `linkedMethod.bankName` as the
 *      `bankCode` parameter to initiateDirectDebit. Resolved by adding a separate
 *      `bankCode` field to the AutoDebit model.
 *
 * FIX (this revision): Three bugs in the card→bank fallback path:
 *
 *   Bug 1 — When chargeToken() THROWS (e.g. "Restricted card", "Declined"), the
 *            outer try-catch at the bottom of the FW block caught the error and
 *            logged it as "Flutterwave auto-debit failed", then returned. The bank
 *            fallback code lived inside `if (debitResult) { ... } else { }` which
 *            was never reached because `debitResult` was never set. Card errors now
 *            have their own inner try-catch that catches the throw, logs it, and
 *            lets execution continue to the bank fallback block.
 *
 *   Bug 2 — When the bank fallback DID run (rare case: card returned non-success
 *            without throwing), the result was never processed. There was no
 *            AutoDebitLog.create() call and no repayLoan() reconciliation for the
 *            bank attempt. Fixed by moving result processing AFTER both attempts.
 *
 *   Bug 3 — The bank fallback reused the same txRef (`reference`) as the failed
 *            card attempt. Flutterwave rejects duplicate txRefs. Fixed: card uses
 *            `baseRef`, bank fallback uses `${baseRef}-bnk`.
 *
 *   Additionally: `wasSuccessful` was checking `debitResult?.status === 'success'`
 *   (the outer API envelope, always true when the HTTP call works) instead of
 *   `debitResult?.data?.status === 'successful'` (the actual transaction outcome).
 *   This meant a pending bank debit — where money had not yet moved — could be
 *   treated as "successful" and trigger early loan reconciliation.
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
        async () => { await this.processLoans(); }
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
    const settings = await SettingsService.getSettings();
    const penaltyRate = settings.loan?.penalty?.percentage ? (settings.loan?.penalty?.dailyRate || 1) / 100 : (settings.loan?.penalty?.dailyRate || 10);

    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    try {
      const loans = await Loan.find({
        status: { $in: ['accepted', 'processing'] },
        outstanding: { $gt: 0 },
        loan_payment_status: { $ne: 'complete' },
      });

      const penalizedUsers: { email?: string; phone?: string; amount?: number }[] = [];
      const deductedUsers: { email?: string; phone?: string }[] = [];

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

          // ── 1. Apply daily penalty (overdue only) ──────────────────────────
          let penaltyAmount = 0;
          if (repaymentDateISO < todayISO) {
            penaltyAmount = await this.applyPenaltyToLoan(loan, penaltyRate);
            if (penaltyAmount > 0) {
              penalizedUsers.push({ email: user.email, phone: user.user_metadata?.phone, amount: penaltyAmount });
            }
          }

          // ── 2. Wallet deduction (overdue only) ────────────────────────────
          if (repaymentDateISO < todayISO) {
            const freshLoan = await Loan.findById(loan._id);
            if (!freshLoan || freshLoan.loan_payment_status === 'complete' || Number(freshLoan.outstanding) <= 0) {
              logger.info({ loanId: loan._id }, 'Skipping wallet deduction — loan already fully paid');
            } else {
              const walletBalance = Number(user.user_metadata?.wallet || 0);
              const outstanding = Number(freshLoan.outstanding);
              const repaymentAmount = Math.min(walletBalance, outstanding);
              const minVfdDeduction = settings.autoDebit?.minDebitAmount || 100;

              if (walletBalance > 0 && repaymentAmount >= minVfdDeduction) {
                try {
                  const result = await LoanService.repayLoan({
                    loanId: loan._id,
                    userId: user._id,
                    amount: repaymentAmount,
                    idempotencyKey: `worker-deduct-${loan._id}-${todayISO}`,
                  });

                  if (result.repayAmount > 0 && !result.providerResponse?.alreadyPaid) {
                    deductedUsers.push({ email: user.email, phone: user.user_metadata?.phone });
                    await WorkerLogService.log('loan-penalties', 'info',
                      `Auto-deducted wallet balance for overdue loan for ${user.email || user.user_metadata?.phone}`,
                      { userId: user._id, loanId: loan._id, amount: result.repayAmount, result }
                    );
                  } else {
                    logger.info({ loanId: loan._id }, 'Wallet deduction skipped — loan already fully paid at commit time');
                  }
                } catch (err: any) {
                  logger.error({ loanId: loan._id, error: err.message }, 'Wallet deduction failed');
                  await WorkerLogService.log('loan-penalties', 'error',
                    `Wallet deduction failed: ${err.message}`, { loanId: loan._id }
                  );
                }
              }
            }

            // ── 3. External Auto-Debit (Card -> Bank -> Fintech Wallet) ─────
            // Runs when the loan is still not fully paid after wallet deduction.
            // Strategy: try card first, then bank, then fintech wallet.
            const refreshedLoan = await Loan.findById(loan._id);
            if (refreshedLoan && refreshedLoan.loan_payment_status === 'complete') {
              logger.info({ loanId: loan._id }, 'Skipping FW auto-debit — loan fully paid after wallet deduction');
            } else {
              const refreshedUser = await UserService.getUser(loan.userId);
              if (refreshedUser && !Array.isArray(refreshedUser)) {
                const updatedWallet = Number((refreshedUser as any).user_metadata?.wallet || 0);
                const remainingOutstanding = Number(refreshedLoan?.outstanding || 0);

                if (updatedWallet < remainingOutstanding && settings.autoDebit?.enabled !== false) {
                  const debitAmount = remainingOutstanding - updatedWallet;
                  const minDebit = settings.autoDebit?.minDebitAmount || 100;

                  if (debitAmount >= minDebit) {
                    // Enforce maxDebitAttempts bug fix
                    const maxAttempts = settings.autoDebit?.maxDebitAttempts || 4;
                    const startOfDay = new Date(todayISO);
                    const attemptCount = await AutoDebitLog.countDocuments({
                      loanId: String(loan._id),
                      createdAt: { $gte: startOfDay }
                    });

                    if (attemptCount >= maxAttempts) {
                      logger.warn({ loanId: loan._id, attemptCount, maxAttempts }, 'Max auto-debit attempts reached for today');
                      continue; // Skip external debits for this loan today
                    }

                    // Fetch all active payment methods for this user upfront
                    const linkedMethods = await AutoDebit.find({
                      userId: String((refreshedUser as any)._id),
                      status: 'active',
                    });

                    const cardMethod = linkedMethods.find(m => m.type === 'card');
                    const bankMethod = linkedMethods.find(m => m.type === 'bank');
                    const walletMethod = linkedMethods.find(m => m.type === 'wallet');

                    if (!cardMethod && !bankMethod && !walletMethod) {
                      logger.info({ loanId: loan._id }, 'No active payment method found — skipping external auto-debit');
                      continue;
                    }

                    // Dynamically import providers
                    const { FlutterwaveDebitProvider } = await import('../../shared/providers/flutterwave-debit.provider');
                    const { MonnifyProvider } = await import('../../shared/providers/monnify.provider');
                    const { MonoProvider } = await import('../../shared/providers/mono.provider');
                    const { OPayProvider } = await import('../../shared/providers/opay.provider');
                    
                    const fwProvider = new FlutterwaveDebitProvider();
                    const monnifyProvider = new MonnifyProvider();
                    const monoProvider = new MonoProvider();
                    const opayProvider = new OPayProvider();

                    const baseRef = `loan-debit-${loan._id}-${Date.now()}`;
                    let debitResult: any = null;
                    let activeMethod: any = null;
                    let activeRef = baseRef;
                    let wasSuccessful = false;

                    // Helper to log result and reconcile
                    const processResult = async (result: any, method: any, ref: string, isSuccess: boolean) => {
                      debitResult = result;
                      activeMethod = method;
                      activeRef = ref;
                      wasSuccessful = isSuccess;

                      await AutoDebitLog.create({
                        userId: String((refreshedUser as any)._id),
                        loanId: String(loan._id),
                        type: method.type,
                        amount: debitAmount,
                        reference: ref,
                        token: method.token,
                        status: isSuccess ? 'successful' : 'pending',
                        provider: method.provider || 'flutterwave',
                        providerResponse: result,
                      });

                      if (isSuccess) {
                        try {
                          await LoanService.repayLoan({
                            loanId: loan._id,
                            userId: (refreshedUser as any)._id,
                            amount: debitAmount,
                            idempotencyKey: `ext-debit-${ref}`,
                            skipBalanceCheck: true,
                            autoDeduct: true,
                            internalOnly: true,
                          });
                        } catch (reconcileErr: any) {
                          logger.error({ loanId: loan._id, error: reconcileErr.message }, 'Repayment reconciliation failed');
                        }
                        await WorkerLogService.log('loan-penalties', 'info',
                          `External auto-debit (${method.type}) succeeded: ₦${debitAmount}`,
                          { userId: (refreshedUser as any)._id, loanId: loan._id, reference: ref }
                        );
                      }
                    };

                    // ── 3a. Card attempt (Flutterwave)
                    if (!wasSuccessful && cardMethod) {
                      try {
                        const result = await fwProvider.chargeToken({
                          token: cardMethod.token,
                          email: cardMethod.email,
                          amount: debitAmount,
                          txRef: baseRef,
                          redirectUrl: 'https://primefinance.live',
                        });
                        
                        if (result?.data?.status === 'successful') {
                          await processResult(result, cardMethod, baseRef, true);
                        } else if (result?.data?.status === 'pending' && result?.data?.meta?.authorization) {
                          // Needs interactive auth, log pending and fallthrough
                          await processResult(result, cardMethod, baseRef, false);
                        }
                      } catch (err: any) {
                        logger.error({ error: err.message }, 'Card auto-debit failed');
                        await WorkerLogService.log('loan-penalties', 'error', `Card auto-debit failed: ${err.message}`);
                      }
                    }

                    // ── 3b. Bank attempt (Flutterwave / Monnify)
                    if (!wasSuccessful && bankMethod) {
                      const bankRef = `${baseRef}-bnk`;
                      try {
                        let result: any;
                        let isSuccess = false;

                        if (bankMethod.provider === 'monnify') {
                           result = await monnifyProvider.debitMandate({
                             mandateCode: bankMethod.token,
                             amount: debitAmount,
                             reference: bankRef,
                             narration: `Prime Loan Repayment ${loan._id}`
                           });
                           isSuccess = result?.status === 'SUCCESS' || result?.responseCode === '0';
                        } else if (bankMethod.provider === 'mono') {
                           result = await monoProvider.chargeAccount({
                             accountId: bankMethod.token,
                             amount: debitAmount,
                             reference: bankRef,
                             narration: `Prime Loan Repayment ${loan._id}`
                           });
                           isSuccess = result?.status === 'successful' || result?.data?.status === 'successful';
                        } else {
                           // Flutterwave E-mandate
                           result = await fwProvider.chargeToken({
                             token: bankMethod.token,
                             email: bankMethod.email,
                             amount: debitAmount,
                             txRef: bankRef,
                             redirectUrl: 'https://primefinance.live',
                           });
                           isSuccess = result?.data?.status === 'successful';
                        }

                        if (isSuccess) {
                          await processResult(result, bankMethod, bankRef, true);
                        } else {
                          // Log pending for bank
                          await processResult(result, bankMethod, bankRef, false);
                        }
                      } catch (err: any) {
                        logger.error({ error: err.message }, 'Bank auto-debit failed');
                        await WorkerLogService.log('loan-penalties', 'error', `Bank auto-debit failed: ${err.message}`);
                      }
                    }

                    // ── 3c. Fintech Wallet attempt (OPay / Monnify)
                    if (!wasSuccessful && walletMethod) {
                      const walletRef = `${baseRef}-wlt`;
                      try {
                        let result: any;
                        let isSuccess = false;

                        if (walletMethod.provider === 'opay') {
                          result = await opayProvider.chargeWallet({
                            token: walletMethod.token,
                            amount: debitAmount,
                            reference: walletRef,
                            phone: walletMethod.walletPhone
                          });
                          isSuccess = result?.status === 'successful' || result?.data?.status === 'successful';
                        } else if (walletMethod.provider === 'monnify') {
                          result = await monnifyProvider.debitMandate({
                             mandateCode: walletMethod.token,
                             amount: debitAmount,
                             reference: walletRef,
                             narration: `Prime Loan Repayment ${loan._id}`
                          });
                          isSuccess = result?.status === 'SUCCESS' || result?.responseCode === '0';
                        }

                        if (isSuccess) {
                          await processResult(result, walletMethod, walletRef, true);
                        } else {
                          await processResult(result, walletMethod, walletRef, false);
                        }
                      } catch (err: any) {
                        logger.error({ error: err.message }, 'Fintech wallet auto-debit failed');
                        await WorkerLogService.log('loan-penalties', 'error', `Fintech wallet auto-debit failed: ${err.message}`);
                      }
                    }
                  }
                }
              }
            }
          }

          // ── 4. Reminders (overdue / due today / due tomorrow) ─────────────
          const timeSinceLastReminder = loan.lastRemindedAt
            ? today.getTime() - new Date(loan.lastRemindedAt).getTime()
            : Infinity;
          const hoursSinceLastReminder = timeSinceLastReminder / (1000 * 60 * 60);

          let isNewDay = true;
          if (loan.lastRemindedAt) {
            const lastReminderDateISO = new Date(loan.lastRemindedAt).toISOString().split('T')[0];
            if (lastReminderDateISO === todayISO) isNewDay = false;
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
            try {
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
            } catch (notifyErr: any) {
              logger.warn({ loanId: loan._id, error: notifyErr.message }, 'Loan reminder notification failed (non-fatal)');
              await WorkerLogService.log('loan-penalties', 'warn',
                `Reminder notification failed: ${notifyErr.message}`, { loanId: loan._id }
              );
            }

            if (reminded) {
              await Loan.updateOne(
                { _id: loan._id },
                {
                  $set: {
                    lastRemindedAt: today.toISOString(),
                    remindersToday: currentRemindersToday + 1,
                  },
                }
              );
            }
          }
        } catch (err: any) {
          logger.error({ loanId: loan._id, error: err.message }, 'Error processing loan');
          await WorkerLogService.log('loan-penalties', 'error',
            `Error processing loan: ${err.message}`, { loanId: loan._id }
          );
        }
      }

      await WorkerLogService.log('loan-penalties', 'info',
        `Finished cycle. Penalised ${penalizedUsers.length} users, wallet-deducted ${deductedUsers.length} users.`,
        { penalizedUsers, deductedUsers }
      );
    } catch (err: any) {
      logger.error({ error: err.message }, 'Fatal error in loan penalties cron');
      await WorkerLogService.log('loan-penalties', 'error',
        `Fatal error in loan penalties cron: ${err.message}`
      );
    }
  }

  private static async applyPenaltyToLoan(loan: any, penaltyRate: number): Promise<number> {
    const session = await DatabaseService.startSession();
    let appliedPenalty = 0;

    try {
      await DatabaseService.withTransaction(session, async () => {
        const settings = await SettingsService.getSettings();
        const chargeConfig = settings.chargeConfiguration || {
          enabled: true,
          type: 'PERCENTAGE',
          percentageValue: 1,
          calculationBase: 'PRINCIPAL_PLUS_INTEREST_AND_FEES',
        };

        if (!chargeConfig.enabled) return 0;

        const today = new Date();
        const lastPenaltyDate = loan.lastInterestAdded
          ? new Date(loan.lastInterestAdded)
          : new Date(loan.repayment_date);

        const diffTime = today.getTime() - lastPenaltyDate.getTime();
        const daysSinceLastPenalty = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (daysSinceLastPenalty <= 0) return 0;

        let chargeBase = loan.amount;
        if (chargeConfig.calculationBase === 'PRINCIPAL_PLUS_INTEREST_AND_FEES') {
          const interest = loan.interest || 0;
          const fees = (loan.serviceFee || 0) + (loan.processingFee || 0) + (loan.otherFees || 0);
          chargeBase = loan.amount + interest + fees;
        }

        if (chargeConfig.type === 'FIXED_AMOUNT') {
          appliedPenalty = Math.floor((chargeConfig.fixedAmountValue || 0) * daysSinceLastPenalty);
        } else {
          const rate = chargeConfig.percentageValue || penaltyRate;
          appliedPenalty = Math.floor(chargeBase * (rate / 100)) * daysSinceLastPenalty;
        }

        const traceId = UuidService.generateTraceId();
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
            meta: { loanId: loan._id, penaltyRate, originalAmount: loan.amount },
          }
        );

        loan.outstanding = Number(loan.outstanding) + appliedPenalty;
        loan.lastInterestAdded = new Date().toISOString();
        loan.repayment_history = [
          ...(loan.repayment_history || []),
          {
            amount: appliedPenalty,
            outstanding: loan.outstanding,
            action: 'penalty',
            date: new Date().toISOString(),
          },
        ];

        await loan.save({ session });

        logger.info({ loanId: loan._id, userId: loan.userId, appliedPenalty, newOutstanding: loan.outstanding },
          'Penalty applied to overdue loan');
        await WorkerLogService.log('loan-penalties', 'warn', 'Penalty applied to overdue loan',
          { loanId: loan._id, appliedPenalty, newOutstanding: loan.outstanding });
      });
      return appliedPenalty;
    } finally {
      await session.endSession();
    }
  }
}

if (require.main === module) {
  LoanPenaltiesCron.start().catch(console.error);
}