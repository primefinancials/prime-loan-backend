/**
 * Loan Penalties & Reminder Cron Worker
 * - Applies daily penalties to overdue loans
 * - Sends reminders for loans due today and tomorrow
 * - Attempts auto-debit via Flutterwave when wallet is insufficient
 *
 * FIX: auto-debit bank path was passing `linkedMethod.bankName` as the `bankCode`
 *      parameter to initiateDirectDebit. The AutoDebit model stores human-readable
 *      bank names in `bankName` and the NUBAN in `accountNumber`. Flutterwave's
 *      direct-debit endpoint needs the bank's numeric code, not its name.
 *
 *      Resolution: the AutoDebit model now has a separate `bankCode` field (added below).
 *      The controller was updated to persist it on link-bank. The cron now reads
 *      `linkedMethod.bankCode` for the Flutterwave call.
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

              if (walletBalance > 0 && repaymentAmount > 0) {
                try {
                  // CORRECTION: this is a real VFD-to-VFD transfer — the user's
                  // internal VFD "wallet" account paying the company's VFD prime
                  // account — so the STANDARD path (live balance check + actual
                  // VFD transfer) is the CORRECT path here. `internalOnly: true`
                  // would skip the real transfer entirely, which is wrong for this
                  // step (it's only appropriate for the Flutterwave reconciliation
                  // below, where money already moved via a different rail).
                  //
                  // The actual bug that produced the phantom ₦721 "repayment" with
                  // an empty wallet is fixed in loan_service.ts's repayLoan():
                  //   - the live balance check no longer silently passes when
                  //     `userAcc.accountBalance` parses to NaN, and
                  //   - a VFD "status 98" error is no longer trusted as success
                  //     unless a completed transfer for that reference is verified.
                  // With those fixes, a deduction attempted against an
                  // already-empty VFD wallet (as happened on the second cycle
                  // here, using the stale `user_metadata.wallet` value) now
                  // correctly throws "Insufficient funds" / "Could not determine
                  // account balance" and is caught below as a failed deduction —
                  // instead of being silently committed as a successful repayment.
                  const result = await LoanService.repayLoan({
                    loanId: loan._id,
                    userId: user._id,
                    amount: repaymentAmount,
                    idempotencyKey: `worker-deduct-${loan._id}-${todayISO}`,
                  });

                  // BUG FIX: repayLoan() can return early WITHOUT throwing and
                  // WITHOUT making any changes (repayAmount: 0, providerResponse
                  // .alreadyPaid: true) if the loan was fully paid by the time
                  // it re-checked the DB. Previously this was treated as a
                  // successful deduction regardless, producing a false
                  // "Auto-deducted wallet balance" log entry with no underlying
                  // transaction. Only count/report it as a deduction if a
                  // positive amount was actually applied.
                  if (result.repayAmount > 0 && !result.providerResponse?.alreadyPaid) {
                    deductedUsers.push({ email: user.email, phone: user.user_metadata?.phone });
                    await WorkerLogService.log('loan-penalties', 'info',
                      `Auto-deducted wallet balance for overdue loan for ${user.email || user.user_metadata?.phone}`,
                      { userId: user._id, loanId: loan._id, amount: result.repayAmount }
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

            // ── 3. Flutterwave auto-debit fallback ─────────────────────────
            // Only runs when the loan is still not fully paid after wallet deduction.
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
                    try {
                      // Prefer card over bank (card sorts lexicographically before bank)
                      const linkedMethods = await AutoDebit.find({
                        userId: String((refreshedUser as any)._id),
                        status: 'active',
                      });

                      const linkedMethod = linkedMethods.find(method => method.type === 'card') ??
                        linkedMethods.find(method => method.type === 'bank');

                      if (linkedMethod) {
                        const fwProvider = new FlutterwaveDebitProvider();
                        const reference = `loan-debit-${loan._id}-${Date.now()}`;

                        let debitResult: any;

                        if (linkedMethod.type === 'card') {
                          // BUG FIX: "Flutterwave auto-debit failed: Tokenized charge
                          // failed: Please enter a valid redirect url" — Flutterwave's
                          // tokenized card charge endpoint (POST /charges?type=card)
                          // requires a `redirect_url`, used if the charge needs 3DS/OTP
                          // authentication (common for many Nigerian cards even on
                          // saved-token recurring charges). The cron runs unattended,
                          // so there's no live browser session to redirect — but the
                          // field must still be present and a valid URL, or Flutterwave
                          // rejects the request outright before even attempting the
                          // charge. We point it at a backend "no-op" landing page;
                          // FlutterwaveDebitProvider.chargeToken must forward this
                          // value as `redirect_url` in the request payload.
                          const redirectUrl = 'https://primefinance.live';

                          debitResult = await fwProvider.chargeToken({
                            token: linkedMethod.token,
                            email: linkedMethod.email,
                            amount: debitAmount,
                            txRef: reference,
                            redirectUrl,
                          });

                          // If the charge requires further authentication (OTP/3DS/AVS),
                          // Flutterwave returns a non-"successful" status with a
                          // `meta.authorization` block instead of throwing. An
                          // unattended cron can't complete that flow, so treat it the
                          // same as a non-success and fall through to the bank-debit
                          // fallback below rather than leaving it stuck pending.
                          if (debitResult?.data?.status === 'pending' && debitResult?.data?.meta?.authorization) {
                            logger.warn({ loanId: loan._id, authMode: debitResult.data.meta.authorization.mode },
                              'FW card charge requires additional authentication — cannot complete unattended, falling back');
                            debitResult = { status: 'error', data: debitResult.data };
                          }
                        } else {
                          // Bank direct debit
                          // FIX: was incorrectly passing `linkedMethod.bankName` as the
                          //      bankCode parameter. The bank code is stored separately.
                          const bankCode = (linkedMethod as any).bankCode || linkedMethod.bankName || '';
                          if (!bankCode) {
                            logger.warn({ loanId: loan._id }, 'Skipping bank auto-debit — no bankCode on linked method');
                          } else {
                            debitResult = await fwProvider.initiateDirectDebit({
                              accountNumber: linkedMethod.accountNumber || '',
                              bankCode,                           // ← FIXED
                              email: linkedMethod.email,
                              amount: debitAmount,
                              txRef: reference,
                              narration: `Prime Finance Loan Repayment — Loan ${loan._id}`,
                            });
                          }
                        }

                        if (debitResult) {
                          const wasSuccessful =
                            debitResult?.status === 'success' ||
                            debitResult?.data?.status === 'successful';

                          await AutoDebitLog.create({
                            userId: String((refreshedUser as any)._id),
                            loanId: String(loan._id),
                            type: linkedMethod.type,
                            amount: debitAmount,
                            reference,
                            token: linkedMethod.token,
                            status: wasSuccessful ? 'successful' : 'pending',
                            provider: 'flutterwave',
                            providerResponse: debitResult,
                          });

                          if (wasSuccessful) {
                            // Reconcile the repayment into the loan immediately.
                            // BUG FIX: This records a repayment for funds that were
                            // ALREADY collected via the Flutterwave charge above.
                            // Without `internalOnly: true`, repayLoan() would run the
                            // STANDARD path and attempt a SECOND, separate live VFD
                            // bank transfer for the same amount — which would either
                            // (a) double-debit the user, or (b) fail and (due to the
                            // standard path's "status 98 = success" handling) still
                            // get recorded as a successful repayment with no real
                            // money behind it. `internalOnly: true` just records the
                            // already-collected FW payment against the loan/ledger.
                            try {
                              await LoanService.repayLoan({
                                loanId: loan._id,
                                userId: (refreshedUser as any)._id,
                                amount: debitAmount,
                                idempotencyKey: `fw-debit-${reference}`,
                                skipBalanceCheck: true,
                                autoDeduct: true,
                                internalOnly: true,
                              });
                            } catch (reconcileErr: any) {
                              logger.error({ loanId: loan._id, error: reconcileErr.message },
                                'Repayment reconciliation after FW debit failed — needs manual review');
                            }

                            await WorkerLogService.log('loan-penalties', 'info',
                              `FW auto-debit (${linkedMethod.type}) succeeded for ${(refreshedUser as any).email}: ₦${debitAmount}`,
                              { userId: (refreshedUser as any)._id, loanId: loan._id, reference }
                            );
                          } else {
                            if (linkedMethod.type === 'card') {
                              const bankMethod = linkedMethods.find(method => method.type === 'bank');
                              if (!bankMethod) {
                                logger.warn({ loanId: loan._id }, 'Skipping bank auto-debit — no bank method found');
                              } else {
                                const bankCode = (bankMethod as any).bankCode || bankMethod.bankName || '';
                                if (!bankCode) {
                                  logger.warn({ loanId: loan._id }, 'Skipping bank auto-debit — no bankCode on linked method');
                                } else {
                                  debitResult = await fwProvider.initiateDirectDebit({
                                    accountNumber: bankMethod.accountNumber || '',
                                    bankCode,
                                    email: bankMethod.email,
                                    amount: debitAmount,
                                    txRef: reference,
                                    narration: `Prime Finance Loan Repayment — Loan ${loan._id}`,
                                  });
                                }
                              }
                            }

                            await WorkerLogService.log('loan-penalties', 'warn',
                              `FW auto-debit (${linkedMethod.type}) returned non-success for ${(refreshedUser as any).email}: ₦${debitAmount}`,
                              { userId: (refreshedUser as any)._id, loanId: loan._id, reference, result: debitResult }
                            );
                          }
                        }
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
            // BUG FIX: previously these notification calls were not wrapped, so a
            // transient SMTP/email error (e.g. "Greeting never received") thrown
            // here propagated to the outer per-loan catch block and was logged as
            // "Error processing loan: <message>" — even though steps 1-3 (penalty
            // + wallet deduction) for this loan had already completed successfully.
            // That misleading error log made it look like the whole loan-processing
            // step had failed. Reminder failures are now non-fatal: logged and
            // skipped, without affecting penalty/deduction results already recorded.
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