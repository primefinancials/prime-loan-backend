/**
 * Savings Application Service
 * Manages savings plans with interest calculations and penalties
 */
import { SavingsPlan } from './savings.plan.model';
import { LedgerService } from '../ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';
import User from '../users/user.model';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { saveIdempotentResponse } from '../../shared/idempotency/middleware';
import { TransferService } from '../transfers/transfer.service';
import { TransferRequest } from '../../shared/providers/vfd.provider';
import { sha512 } from 'js-sha512';
import { SettingsService } from '../admin/settings.service';

export interface CreatePlanParams {
  userId: string;
  planType: 'LOCKED' | 'FLEXIBLE';
  subType?: 'STANDARD' | 'INSTANT';
  planName: string;
  idempotencyKey: string;

  // Fixed (LOCKED) Plan Fields
  targetAmount?: number; // in naira - one-time deposit for Fixed
  durationMonths?: number; // Fixed: duration in months (e.g., 3, 6, 12)

  // Flexible Plan Fields
  maturityDate?: Date; // Flexible: user-specified end date
  contribution?: {
    frequency: 'weekly' | 'monthly';
    amount: number; // amount to deduct each period (naira)
    dayOfWeek?: number; // 0-6 for weekly
    dayOfMonth?: number; // 1-31 for monthly
  };

  // Deprecated (kept for backward compat)
  durationDays?: number;
  amount?: number; // in naira - initial deposit (only for Fixed now)
  interestRate?: number;
  renew?: boolean;
}

export interface WithdrawParams {
  planId: string;
  userId: string;
  amount: number; // in naira
  idempotencyKey: string;
  forceImmediate?: boolean;
  subType?: 'STANDARD' | 'INSTANT'; // For FLEXIBLE plans: choose at withdrawal time
}

export class SavingsService {
  /**
   * Create a new savings plan
   * - LOCKED (Fixed): One-time deposit, months-based duration, no contributions
   * - FLEXIBLE: No initial deposit, recurring contributions, date-based maturity
   */
  static async createPlan(params: CreatePlanParams) {
    const session = await DatabaseService.startSession();

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const vfdProvider = new VfdProvider();
        const setting = await SettingsService.getSettings();
        const userId = params.userId;

        // Determine plan-specific settings
        const isFixed = params.planType === 'LOCKED';

        // Calculate maturity date
        let maturityDate: Date | undefined;
        let durationMonths: number | undefined;

        if (isFixed) {
          // Fixed: Use months
          durationMonths = params.durationMonths;
          const minMonths = setting.savings.fixed.minDurationMonths || 3;

          if (!durationMonths || durationMonths < minMonths) {
            throw new Error(`Fixed savings must be at least ${minMonths} months -> durationMonths: ${durationMonths}, minMonths: ${minMonths}`);
          }

          maturityDate = new Date();
          maturityDate.setMonth(maturityDate.getMonth() + durationMonths);
        } else {
          // Flexible: Use provided maturity date
          if (params.maturityDate) {
            maturityDate = new Date(params.maturityDate);
          }

          // Validate contribution config
          if (!params.contribution || !params.contribution.frequency || !params.contribution.amount) {
            throw new Error('Flexible savings requires contribution configuration');
          }
        }

        let interestRate = 0;
        let penaltyRate = 0;

        if (isFixed) {
          interestRate = setting.savings.fixed.interestRate;
          penaltyRate = setting.savings.fixed.penaltyRate;
        } else {
          // Flexible — penalty rate will be determined at withdrawal time based on subType
          interestRate = setting.savings.flexible.interestRate;
          // Use instant penalty rate as default for storage (actual penalty applied at withdrawal)
          penaltyRate = setting.savings.flexible.instant.penaltyRate;
        }

        // Normalize interest rate (handle "10" as 0.10)
        if (interestRate >= 1) {
          interestRate = interestRate / 100;
        }

        // Normalize penalty rate
        if (penaltyRate >= 1) {
          penaltyRate = penaltyRate / 100;
        }

        // Fixed: Deduct targetAmount once
        // Flexible: No initial deposit
        const initialDeposit = isFixed ? (params.targetAmount || params.amount || 0) : 0;

        let trxnRes: any = null;

        // Only process transfer if there's an initial deposit (Fixed plans)
        if (initialDeposit > 0) {
          const user = await User.findById(userId);
          const from = (await vfdProvider.getAccountInfo(user ? user.user_metadata.accountNo : "trx-user")).data;
          const to = (await vfdProvider.getPrimeAccountInfo()).data;

          // Create transfer record
          const trxn = await TransferService.initiateTransfer({
            fromAccount: from.accountNo,
            userId,
            toAccount: to.accountNo,
            amount: initialDeposit,
            beneficiaryName: to.client,
            transferType: "intra",
            bankCode: "999999",
            remark: `Fixed savings deposit for ${params.planName}`,
            walletBalance: String(from.accountBalance),
            naration: `Fixed savings plan ${params.planName} - ${durationMonths} months`,
            idempotencyKey: params.idempotencyKey,
          }, "savings-deposit");

          // Execute transfer
          const transferReq: TransferRequest = {
            uniqueSenderAccountId: from.accountId,
            fromAccount: from.accountNo,
            fromClientId: from.clientId,
            fromClient: from.client,
            fromSavingsId: from.accountId,
            toAccount: to.accountNo,
            toClient: to.client,
            toSession: to.accountId,
            toClientId: to.clientId,
            toSavingsId: to.accountId,
            toBank: "999999",
            signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
            amount: initialDeposit,
            remark: `Fixed savings deposit for ${params.planName}`,
            transferType: "intra",
            reference: trxn.reference,
          };

          const providerRes = await vfdProvider.transfer(transferReq);

          if (providerRes.status !== "00") {
            await TransferService.failTransfer(trxn.reference);
            throw new Error(`Transfer failed: ${providerRes.message}`);
          }

          trxnRes = await TransferService.completeTransfer(trxn.reference, "savings-deposit");
        }

        // Create the plan
        const [plan] = await SavingsPlan.create([{
          userId: params.userId,
          planType: params.planType,
          subType: undefined, // subType is now chosen at withdrawal time
          planName: params.planName,
          targetAmount: isFixed ? initialDeposit : params.targetAmount,
          durationMonths: durationMonths,
          principal: initialDeposit,
          interestRate: interestRate,
          locked: true, // Both types are now locked
          maturityDate,
          status: 'ACTIVE',
          meta: {
            penaltyRate: penaltyRate,
            autoRenew: params.renew || false,
            compoundingFrequency: 'maturity'
          },
          // Flexible: Setup contribution schedule
          contribution: !isFixed && params.contribution ? {
            frequency: params.contribution.frequency,
            amount: params.contribution.amount,
            dayOfWeek: params.contribution.dayOfWeek,
            dayOfMonth: params.contribution.dayOfMonth,
            pendingDeduction: false,
            lastDeductionDate: undefined
          } : undefined,
          contributionHistory: initialDeposit > 0 ? [{
            amount: initialDeposit,
            initiated: new Date(),
            processed: true,
            transactionId: trxnRes?.transferId || ""
          }] : [],
          withdrawalHistory: []
        }], { session });

        // Ledger entry for initial deposit (Fixed only)
        if (initialDeposit > 0 && trxnRes) {
          await LedgerService.createDoubleEntry(
            trxnRes?.traceId || "",
            `user_wallet:${params.userId}`,
            'savings_pool',
            initialDeposit,
            'savings',
            {
              userId: params.userId,
              subtype: 'deposit',
              idempotencyKey: params.idempotencyKey,
              session,
              meta: {
                planId: plan._id,
                transactionId: trxnRes?.transferId || ""
              }
            }
          );
        }

        const result = {
          planId: plan._id,
          planType: plan.planType,
          interestRate: plan.interestRate,
          maturityDate: plan.maturityDate,
          contribution: plan.contribution,
          principal: plan.principal
        };

        await saveIdempotentResponse(
          params.idempotencyKey,
          params.userId,
          result
        );

        return result;
      });
    } finally {
      await session.endSession();
    }
  }

  static async topUpPlan(params: {
    userId: string;
    planId: string;
    amount: number;
    idempotencyKey: string;
  }) {
    const session = await DatabaseService.startSession();
    try {
      return await DatabaseService.withTransaction(session, async () => {
        const vfdProvider = new VfdProvider();
        const plan = await SavingsPlan.findById(params.planId).session(session);

        if (!plan) throw new Error('Savings plan not found');
        if (plan.userId.toString() !== params.userId.toString()) throw new Error('Unauthorized');
        if (plan.status !== 'ACTIVE') throw new Error('Cannot top-up inactive plan');

        // Fixed plans do not allow top-ups (one-time deposit only)
        if (plan.planType === 'LOCKED') {
          throw new Error('Top-ups are not allowed on Fixed savings plans');
        }

        const user = await User.findById(params.userId);
        const from = (await vfdProvider.getAccountInfo(user ? user.user_metadata.accountNo : "trx-user")).data;
        const to = (await vfdProvider.getPrimeAccountInfo()).data;

        // 1. Create transfer record from User to Pool
        const trxn = await TransferService.initiateTransfer({
          fromAccount: from.accountNo,
          userId: params.userId,
          toAccount: to.accountNo,
          amount: params.amount,
          beneficiaryName: to.client,
          transferType: "intra",
          bankCode: "999999",
          remark: `Top-up for ${plan.planName}`,
          walletBalance: String(from.accountBalance),
          naration: `Top-up savings plan ${plan.planName} with ${params.amount}`,
          idempotencyKey: params.idempotencyKey,
        }, "savings-deposit");

        // 2. Execute Transfer
        const transferReq: TransferRequest = {
          uniqueSenderAccountId: from.accountId,
          fromAccount: from.accountNo,
          fromClientId: from.clientId,
          fromClient: from.client,
          fromSavingsId: from.accountId,
          toAccount: to.accountNo,
          toClient: to.client,
          toSession: to.accountId,
          toClientId: to.clientId,
          toSavingsId: to.accountId,
          toBank: "999999",
          signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
          amount: params.amount,
          remark: `Top-up for ${plan.planName}`,
          transferType: "intra",
          reference: trxn.reference,
        };

        const providerRes = await vfdProvider.transfer(transferReq);

        if (providerRes.status == "00") {
          const trxnRes = await TransferService.completeTransfer(trxn.reference, "savings-deposit");

          // 3. Update Plan
          plan.principal += params.amount;
          if (plan.contributionHistory) {
            plan.contributionHistory = [
              ...plan.contributionHistory,
              {
                amount: params.amount,
                initiated: new Date(),
                processed: true,
                transactionId: trxnRes?.transferId || ""
              }
            ]
          }
          await plan.save({ session });

          // 4. Ledger Entry
          await LedgerService.createDoubleEntry(
            trxnRes?.traceId || "",
            `user_wallet:${params.userId}`,
            'savings_pool',
            params.amount,
            'savings',
            {
              userId: params.userId,
              subtype: 'topup',
              idempotencyKey: params.idempotencyKey,
              session,
              meta: {
                planId: plan._id,
                transactionId: trxnRes?.transferId || ""
              }
            }
          );

          return {
            planId: plan._id,
            newPrincipal: plan.principal,
            message: 'Top-up successful'
          };
        }

        await TransferService.failTransfer(trxn.reference);
        throw new Error(`Transfer failed: ${providerRes.message}`);
      });
    } finally {
      session.endSession();
    }
  }

  static async completePlan(params: WithdrawParams) {
    const traceId = UuidService.generateTraceId();
    let amount = params.amount;

    const session = await DatabaseService.startSession();

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const vfdProvider = new VfdProvider();

        const plan = await SavingsPlan.findById(params.planId).session(session);
        if (!plan) throw new Error('Savings plan not found');
        if (plan.userId.toString() !== params.userId.toString()) throw new Error('Unauthorized');

        const setting = await SettingsService.getSettings();

        // --- FLEXIBLE SAVINGS LOGIC ---
        if (plan.planType === 'FLEXIBLE') {
          if (plan.principal <= 0) {
            throw new Error("Insufficient funds. Balance is 0.");
          }
          if (amount > plan.principal) {
            throw new Error("Cannot withdraw more than saved balance.");
          }

          const subType = params.subType || 'INSTANT';
          const now = new Date();
          const isEarlyWithdrawal = plan.maturityDate && now < plan.maturityDate;

          // 1. STANDARD (Delayed)
          if (subType === 'STANDARD') {
            const delayHours = setting.savings.flexible.standard.withdrawalDelayHours || 24;
            const penaltyRate = isEarlyWithdrawal ? ((setting.savings.flexible.standard.penaltyRate || 0) / 100) : 0;

            // Calculate scheduled date
            const scheduledDate = new Date();
            scheduledDate.setHours(scheduledDate.getHours() + delayHours);

            // Calculate Net
            const penalty = Math.floor(amount * penaltyRate);
            const netAmount = amount - penalty;

            // Deduct from Principal based on logic: Reserve Funds immediately
            plan.principal -= amount;

            // Add to Withdrawal History as pending status
            if (!plan.withdrawalHistory) plan.withdrawalHistory = [];
            plan.withdrawalHistory.push({
              amount,
              penalty,
              netAmount,
              initiated: new Date(),
              scheduledDate,
              earlyWithdrawal: !!isEarlyWithdrawal,
              processed: false,
              traceId
            });

            plan.status = 'PROCESSING';
            await plan.save({ session });

            return {
              status: 'scheduled',
              message: `Withdrawal scheduled. Funds will be processed on ${scheduledDate.toDateString()} at ${scheduledDate.toTimeString()}`,
              scheduledDate,
              penalty,
              netAmount
            };
          }

          // 2. INSTANT
          // Proceed to immediate processing below...
          // Apply Instant Penalty
          const penaltyRate = isEarlyWithdrawal ? ((setting.savings.flexible.instant.penaltyRate || 0) / 100) : 0;
          const penalty = Math.floor(amount * penaltyRate);
          const netAmount = amount - penalty;

          // Execute Transfer immediately
          const user = await User.findById(plan.userId);
          const to = (await vfdProvider.getAccountInfo(user ? user.user_metadata.accountNo : "trx-user")).data;
          const from = (await vfdProvider.getPrimeAccountInfo()).data;

          const trxn = await TransferService.initiateTransfer({
            fromAccount: from.accountNo,
            userId: plan.userId,
            toAccount: to.accountNo,
            beneficiaryName: to.client,
            amount: netAmount,
            transferType: "intra",
            bankCode: "999999",
            remark: `Flexible Instant withdrawal for ${plan.planName}`,
            idempotencyKey: params.idempotencyKey,
            walletBalance: String(to.accountBalance),
            meta: {
              earlyWithdrawal: !!isEarlyWithdrawal,
              penalty,
              principal: amount,
              subType: 'INSTANT'
            }
          }, "savings-withdrawal");

          const transferReq: TransferRequest = {
            uniqueSenderAccountId: "",
            fromAccount: from.accountNo,
            fromClientId: from.clientId,
            fromClient: from.client,
            fromSavingsId: from.accountId,
            toAccount: to.accountNo,
            toClient: to.client,
            toSession: to.accountId,
            toClientId: to.clientId,
            toSavingsId: to.accountId,
            toBank: "999999",
            signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
            amount: netAmount,
            remark: `Flexible Instant withdrawal for ${plan.planName}`,
            transferType: "intra",
            reference: trxn.reference,
          };

          const providerRes = await vfdProvider.transfer(transferReq);

          if (providerRes.status == "00") {
            await TransferService.completeTransfer(trxn.reference, "savings-withdrawal");

            // Ledger
            await LedgerService.createDoubleEntry(
              trxn.reference, // Use ref as trace? Or existing traceId?
              'savings_pool',
              `user_wallet:${params.userId}`,
              netAmount,
              'savings',
              { userId: params.userId, subtype: 'withdrawal', idempotencyKey: params.idempotencyKey, session }
            );

            if (penalty > 0) {
              await LedgerService.createEntry({
                traceId,
                userId: params.userId,
                account: 'platform_revenue',
                entryType: 'CREDIT',
                category: 'savings',
                subtype: 'penalty',
                amount: penalty,
                status: 'COMPLETED',
                meta: { planId: plan._id, reason: 'Instant withdrawal penalty' }
              }, session);
            }

            if (plan.principal <= 0) {
              plan.status = 'COMPLETED';
            } else {
              plan.status = 'ACTIVE';
            }

            // Record to Withdrawal History
            if (!plan.withdrawalHistory) plan.withdrawalHistory = [];
            // Deduct from Principal based on logic: Reserve Funds immediately
            plan.principal -= amount;
            plan.withdrawalHistory.push({
              amount,
              penalty,
              netAmount,
              initiated: new Date(),
              completed: new Date(),
              earlyWithdrawal: !!isEarlyWithdrawal,
              processed: true,
              traceId,
              transactionId: trxn.reference
            });

            await plan.save({ session });

            return {
              status: 'processed',
              transactionId: trxn.reference,
              withdrawnAmount: amount,
              penalty,
              netAmount,
              newPrincipal: plan.principal
            };
          } else {
            await TransferService.failTransfer(trxn.reference);
            throw new Error(`Transfer failed: ${providerRes.message}`);
          }
        }

        // --- FIXED (LOCKED) LOGIC (Existing) ---
        // Only applies if planType === 'LOCKED'

        const now = new Date();
        const isEarlyWithdrawal = plan.maturityDate && now < plan.maturityDate;

        if (isEarlyWithdrawal && !params.forceImmediate) {
          // Fixed: Entire amount must be withdrawn
          amount = plan.principal;

          const earlyWithdrawalConfig = setting.savings.fixed.earlyWithdrawal;

          // Check delay
          if (earlyWithdrawalConfig.type === 'delayed') {
            if (plan.earlyWithdrawalDate) {
              throw new Error(`Early withdrawal already scheduled for ${plan.earlyWithdrawalDate}`);
            }
            const delayDays = earlyWithdrawalConfig.delayDays || 0;
            const scheduleDate = new Date();
            scheduleDate.setDate(scheduleDate.getDate() + delayDays);
            plan.earlyWithdrawalDate = scheduleDate;
            await plan.save({ session });
            return { status: 'scheduled', message: `Withdrawal scheduled for ${scheduleDate.toDateString()}`, earlyWithdrawalDate: scheduleDate };
          }
        }

        // Fixed Immediate Withdrawal
        let penalty = 0;
        let netAmount = amount;

        if (isEarlyWithdrawal) {
          let penaltyRate = plan.meta?.penaltyRate ?? 5;
          if (penaltyRate > 1) penaltyRate = penaltyRate / 100;
          penalty = Math.floor(amount * penaltyRate);
          netAmount = amount - penalty;
        }

        // Add Interest if Matured (Fixed)
        if (plan.maturityDate && now >= plan.maturityDate) {
          const interest = Math.floor(plan.principal * plan.interestRate * ((plan.durationDays || 0) / 365));
          netAmount = amount + interest;
        }

        const user = await User.findById(plan.userId);
        const to = (await vfdProvider.getAccountInfo(user ? user.user_metadata.accountNo : "trx-user")).data;
        const from = (await vfdProvider.getPrimeAccountInfo()).data;

        const trxn = await TransferService.initiateTransfer({
          fromAccount: from.accountNo,
          userId: plan.userId,
          toAccount: to.accountNo,
          beneficiaryName: to.client,
          amount: netAmount,
          transferType: "intra",
          bankCode: "999999",
          remark: `Fixed plan withdrawal for ${plan.planName}`,
          idempotencyKey: params.idempotencyKey,
          walletBalance: String(to.accountBalance),
          meta: { earlyWithdrawal: isEarlyWithdrawal, penalty, principal: amount }
        }, "savings-withdrawal");

        const transferReq: TransferRequest = {
          uniqueSenderAccountId: "",
          fromAccount: from.accountNo,
          fromClientId: from.clientId,
          fromClient: from.client,
          fromSavingsId: from.accountId,
          toAccount: to.accountNo,
          toClient: to.client,
          toSession: to.accountId,
          toClientId: to.clientId,
          toSavingsId: to.accountId,
          toBank: "999999",
          signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
          amount: netAmount,
          remark: `Fixed plan withdrawal for ${plan.planName}`,
          transferType: "intra",
          reference: trxn.reference,
        };

        const providerRes = await vfdProvider.transfer(transferReq);

        if (providerRes.status == "00") {
          await TransferService.completeTransfer(trxn.reference, "savings-withdrawal");

          await LedgerService.createDoubleEntry(
            trxn.reference,
            'savings_pool',
            `user_wallet:${params.userId}`,
            netAmount,
            'savings',
            { userId: params.userId, subtype: 'withdrawal', idempotencyKey: params.idempotencyKey, session }
          );

          if (penalty > 0) {
            await LedgerService.createEntry({
              traceId, userId: params.userId, account: 'platform_revenue', entryType: 'CREDIT', category: 'savings', subtype: 'penalty', amount: penalty, status: 'COMPLETED', meta: { planId: plan._id, reason: 'Early withdrawal penalty' }
            }, session);
          }

          plan.principal -= amount;
          if (isEarlyWithdrawal || plan.principal <= 0) {
            plan.status = 'COMPLETED';
            plan.completedAt = new Date();
            plan.principal = 0;
          } else {
            plan.status = 'ACTIVE';
          }

          // Record to Withdrawal History
          if (!plan.withdrawalHistory) plan.withdrawalHistory = [];
          plan.withdrawalHistory.push({
            amount,
            penalty,
            netAmount,
            initiated: new Date(),
            completed: new Date(),
            earlyWithdrawal: !!isEarlyWithdrawal,
            processed: true,
            traceId,
            transactionId: trxn.reference
          });

          await plan.save({ session });

          return { traceId, transactionId: trxn.reference, withdrawnAmount: amount, penalty, netAmount, newPrincipal: plan.principal };
        }

        await TransferService.failTransfer(trxn.reference);
        return null;
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Process all pending withdrawals for Standard Flexible plans
   * Should be called by a cron job (e.g., every hour)
   */
  static async processPendingWithdrawals() {
    const now = new Date();
    // Find plans with pending withdrawals that are due from the new withdrawalHistory array
    const plans = await SavingsPlan.find({
      'withdrawalHistory.processed': false,
      'withdrawalHistory.scheduledDate': { $lte: now }
    });

    console.log(`Processing ${plans.length} plans with due withdrawals at ${now.toISOString()}`);

    for (const plan of plans) {
      if (!plan.withdrawalHistory) continue;

      // Filter due items
      const dueItems = plan.withdrawalHistory.filter(w => !w.processed && w.scheduledDate && w.scheduledDate <= now);

      if (dueItems.length === 0) continue;

      for (const withdrawal of dueItems) {
        const session = await DatabaseService.startSession();
        try {
          await DatabaseService.withTransaction(session, async () => {
            const vfdProvider = new VfdProvider();
            const user = await User.findById(plan.userId);
            if (!user) throw new Error(`User ${plan.userId} not found`);

            const to = (await vfdProvider.getAccountInfo(user.user_metadata.accountNo)).data;
            const from = (await vfdProvider.getPrimeAccountInfo()).data;

            const idempotencyKey = `pending-${withdrawal.traceId || UuidService.generateTraceId()}`;

            const trxn = await TransferService.initiateTransfer({
              fromAccount: from.accountNo,
              userId: plan.userId,
              toAccount: to.accountNo,
              beneficiaryName: to.client,
              amount: withdrawal.netAmount,
              transferType: "intra",
              bankCode: "999999",
              remark: `Processed Standard withdrawal for ${plan.planName}`,
              idempotencyKey,
              walletBalance: String(to.accountBalance),
              meta: {
                subType: 'STANDARD',
                penalty: withdrawal.penalty,
                principal: withdrawal.amount
              }
            }, "savings-withdrawal");

            const transferReq: TransferRequest = {
              uniqueSenderAccountId: "",
              fromAccount: from.accountNo,
              fromClientId: from.clientId,
              fromClient: from.client,
              fromSavingsId: from.accountId,
              toAccount: to.accountNo,
              toClient: to.client,
              toSession: to.accountId,
              toClientId: to.clientId,
              toSavingsId: to.accountId,
              toBank: "999999",
              signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
              amount: withdrawal.netAmount,
              remark: `Processed Standard withdrawal for ${plan.planName}`,
              transferType: "intra",
              reference: trxn.reference,
            };

            const providerRes = await vfdProvider.transfer(transferReq);

            if (providerRes.status == "00") {
              await TransferService.completeTransfer(trxn.reference, "savings-withdrawal");

              // Ledger
              await LedgerService.createDoubleEntry(
                trxn.reference,
                'savings_pool',
                `user_wallet:${plan.userId}`,
                withdrawal.netAmount,
                'savings',
                { userId: plan.userId, subtype: 'withdrawal', idempotencyKey, session }
              );

              if (withdrawal.penalty > 0) {
                await LedgerService.createEntry({
                  traceId: withdrawal.traceId || trxn.reference,
                  userId: plan.userId,
                  account: 'platform_revenue',
                  entryType: 'CREDIT',
                  category: 'savings',
                  subtype: 'penalty',
                  amount: withdrawal.penalty,
                  status: 'COMPLETED',
                  meta: { planId: plan._id, reason: 'Standard withdrawal penalty' }
                }, session);
              }

              // Update status
              withdrawal.processed = true;
              withdrawal.completed = new Date();
              withdrawal.transactionId = trxn.reference;

              if (plan.principal <= 0) {
                plan.status = 'COMPLETED';
              } else {
                plan.status = 'ACTIVE';
              }

              await plan.save({ session });
              return plan;
            } else {
              await TransferService.failTransfer(trxn.reference);
              console.error(`Transfer failed for plan ${plan._id} pending withdrawal: ${providerRes.message}`);
              // Keep status PENDING to retry? Or SET FAILED?
              // For now, keep pending implies retry. But prevent infinite loop if error is permanent.
              // Maybe add retry count.
            }
          });
        } catch (error) {
          console.error(`Error processing pending withdrawal for plan ${plan._id}:`, error);
        } finally {
          await session.endSession();
        }
      }
    }
  }

  static async adminDisburseWithdrawal(planId: string, traceId: string, adminId: string) {
    const plan = await SavingsPlan.findById(planId);
    if (!plan) throw new Error("Plan not found");

    if (traceId === 'early-withdrawal') {
      if (plan.planType !== 'LOCKED' || !plan.earlyWithdrawalDate) {
        throw new Error("Not a valid locked early withdrawal");
      }
      return await SavingsService.completePlan({
        userId: plan.userId.toString(),
        planId: planId,
        amount: plan.principal,
        idempotencyKey: `admin-disb-${Date.now()}`,
        forceImmediate: true
      });
    }

    if (!plan.withdrawalHistory) {
      throw new Error("No withdrawal history found for this plan");
    }

    const withdrawalIndex = plan.withdrawalHistory.findIndex(
      (w, idx) => (w as any).traceId === traceId || (w as any)._id?.toString() === traceId || idx.toString() === traceId
    );

    if (withdrawalIndex === -1) {
      throw new Error("Specific withdrawal not found");
    }

    const withdrawal = plan.withdrawalHistory[withdrawalIndex];

    if (withdrawal.processed) {
      throw new Error(`Withdrawal is already processed`);
    }

    const session = await DatabaseService.startSession();
    try {
      await DatabaseService.withTransaction(session, async () => {
        const vfdProvider = new VfdProvider();
        const user = await User.findById(plan.userId);
        if (!user) throw new Error(`User ${plan.userId} not found`);

        const to = (await vfdProvider.getAccountInfo(user.user_metadata.accountNo)).data;
        const from = (await vfdProvider.getPrimeAccountInfo()).data;

        const idempotencyKey = `admin-disb-${(withdrawal as any).traceId || UuidService.generateTraceId()}`;

        const trxn = await TransferService.initiateTransfer({
          fromAccount: from.accountNo,
          userId: plan.userId,
          toAccount: to.accountNo,
          beneficiaryName: to.client,
          amount: withdrawal.netAmount,
          transferType: "intra",
          bankCode: "999999",
          remark: `Admin Processed withdrawal for ${plan.planName}`,
          idempotencyKey,
          walletBalance: String(to.accountBalance),
          meta: {
            subType: plan.subType || 'STANDARD',
            penalty: withdrawal.penalty,
            principal: withdrawal.amount,
            adminId
          }
        }, "savings-withdrawal");

        const transferReq: TransferRequest = {
          uniqueSenderAccountId: "",
          fromAccount: from.accountNo,
          fromClientId: from.clientId,
          fromClient: from.client,
          fromSavingsId: from.accountId,
          toAccount: to.accountNo,
          toClient: to.client,
          toSession: to.accountId,
          toClientId: to.clientId,
          toSavingsId: to.accountId,
          toBank: "999999",
          signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
          amount: withdrawal.netAmount,
          remark: `Admin Processed withdrawal for ${plan.planName}`,
          transferType: "intra",
          reference: trxn.reference,
        };

        const providerRes = await vfdProvider.transfer(transferReq);

        if (providerRes.status == "00") {
          await TransferService.completeTransfer(trxn.reference, "savings-withdrawal");

          // Ledger
          await LedgerService.createDoubleEntry(
            trxn.reference,
            'savings_pool',
            `user_wallet:${plan.userId}`,
            withdrawal.netAmount,
            'savings',
            { userId: plan.userId, subtype: 'withdrawal', idempotencyKey, session }
          );

          if (withdrawal.penalty > 0) {
            await LedgerService.createEntry({
              traceId: (withdrawal as any).traceId || trxn.reference,
              userId: plan.userId,
              account: 'platform_revenue',
              entryType: 'CREDIT',
              category: 'savings',
              subtype: 'penalty',
              amount: withdrawal.penalty,
              status: 'COMPLETED',
              meta: { planId: plan._id, reason: 'Standard withdrawal penalty' }
            }, session);
          }

          // Update status
          withdrawal.processed = true;
          withdrawal.completed = new Date();
          (withdrawal as any).transactionId = trxn.reference;

          if (plan.principal <= 0) {
            plan.status = 'COMPLETED';
          } else {
            plan.status = 'ACTIVE';
          }

          await plan.save({ session });
          return plan;
        } else {
          await TransferService.failTransfer(trxn.reference);
          throw new Error(`Transfer failed: ${providerRes.message}`);
        }
      });
    } finally {
      await session.endSession();
    }
  }

  static async getUserPlans(userId: string, page = 1, limit = 20,) {
    const skip = (page - 1) * limit;
    return SavingsPlan.find({ userId })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });
  }

  /**
   * Get all savings plans with optional filtering
   * Filters: all, active, awaiting_withdrawal, completed, cancelled, fixed, flexible
   */
  static async getAllPlans(
    page = 1,
    limit = 20,
    filter: 'all' | 'active' | 'awaiting_withdrawal' | 'completed' | 'cancelled' | 'fixed' | 'flexible' | 'early_withdrawal' | 'maturity_savings' = 'all',
    search?: string
  ) {
    const skip = (page - 1) * limit;

    let query: any = {};
    console.log(`getAllPlans params -> filter: ${filter}, search: ${search}`);

    switch (filter) {
      case 'active':
        query = { status: 'ACTIVE', earlyWithdrawalDate: { $eq: null }, 'withdrawalHistory.processed': { $ne: false } };
        break;
      case 'awaiting_withdrawal':
        query = {
          status: 'ACTIVE',
          $or: [
            { earlyWithdrawalDate: { $ne: null } },
            { 'withdrawalHistory.processed': false }
          ]
        };
        break;
      case 'completed':
        query = { status: 'COMPLETED' };
        break;
      case 'cancelled':
        query = { status: 'CANCELLED' };
        break;
      case 'fixed':
        query = { planType: 'LOCKED' };
        break;
      case 'flexible':
        query = { planType: 'FLEXIBLE' };
        break;
      case 'early_withdrawal':
        query = {
          status: { $in: ['ACTIVE', 'PROCESSING'] },
          $or: [
            { earlyWithdrawalDate: { $ne: null } },
            { 'withdrawalHistory.processed': false }
          ]
        };
        break;
      case 'maturity_savings':
        query = {
          status: 'ACTIVE',
          maturityDate: { $lte: new Date() }
        };
        break;
      case 'all':
      default:
        query = {};
        break;
    }

    if (search && search.trim() !== '') {
      const users = await User.find({ email: { $regex: search, $options: 'i' } }).select('_id');
      const userIds = users.map(u => u._id.toString());
      const searchCondition = {
        $or: [
          { userId: { $in: userIds } },
          { planName: { $regex: search, $options: 'i' } }
        ]
      };
      if (Object.keys(query).length > 0) {
        query = { $and: [query, searchCondition] };
      } else {
        query = searchCondition;
      }
      console.log(`getAllPlans query ->`, JSON.stringify(query));
    }

    const [plans, total] = await Promise.all([
      SavingsPlan.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      SavingsPlan.countDocuments(query)
    ]);

    const planUserIds = [...new Set(plans.map(p => p.userId?.toString() || String(p.userId)))];
    const usersData = await User.find({ _id: { $in: planUserIds } })
      .select('email user_metadata.first_name user_metadata.surname user_metadata.phone_number')
      .lean();

    const userMap = usersData.reduce((acc, u) => {
      acc[u._id.toString()] = u;
      return acc;
    }, {} as Record<string, any>);

    const populatedPlans = plans.map(p => ({
      ...p,
      userId: userMap[p.userId?.toString() || String(p.userId)] || p.userId
    }));

    return {
      plans: populatedPlans,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  static async getAdminSavingsStats() {
    const now = new Date();

    // Fetch all savings plans
    const plans = await SavingsPlan.find({}, {
      principal: 1,
      interestRate: 1,
      durationDays: 1,
      maturityDate: 1,
      status: 1,
      createdAt: 1,
      completedAt: 1,
      earlyWithdrawalDate: 1,
      withdrawalHistory: 1,
      contributionHistory: 1,
      planType: 1,
      targetAmount: 1,
      meta: 1
    });

    const settings = await SettingsService.getSettings();
    const defaultFixedPenaltyRate = (settings.savings?.fixed?.penaltyRate || 5) / 100;

    let totalPlans = 0;

    // Principal Buckets
    let totalPrincipal = 0; // All time
    let totalActivePrincipal = 0; // Only ACTIVE or PROCESSING

    // Type Breakdowns (Total and Active)
    let totalFixedCount = 0;
    let totalFixedAmount = 0;
    let totalFlexibleCount = 0;
    let totalFlexibleAmount = 0;

    let activeFixedCount = 0;
    let activeFixedAmount = 0;
    let activeFlexibleCount = 0;
    let activeFlexibleAmount = 0;

    // Profit Buckets
    let totalInterestExpected = 0; // Expected Profit
    let realizedProfit = 0;

    // Global counts
    let activePlans = 0;
    let maturedPlans = 0;
    let withdrawnPlans = 0;

    let earlyWithdrawalCount = 0;
    let earlyWithdrawalAmount = 0;
    let maturityCount = 0;
    let maturityAmount = 0;

    for (const plan of plans) {
      totalPlans++;
      const currentBalance = plan.principal || 0;

      // Calculate All-Time Deposits for Total Principal metrics
      const totalDeposited = (plan.contributionHistory || [])
        .filter((c: any) => c.processed)
        .reduce((sum: number, c: any) => sum + (c.amount || 0), 0);

      totalPrincipal += totalDeposited;

      // Group by type (All Statuses - Uses All-Time Deposits)
      if (plan.planType === 'LOCKED') {
        totalFixedCount++;
        totalFixedAmount += totalDeposited;
      } else if (plan.planType === 'FLEXIBLE') {
        totalFlexibleCount++;
        totalFlexibleAmount += totalDeposited;
      }

      // ACTIVE or PROCESSING Bucket (Uses current alive balance)
      if (plan.status === "ACTIVE" || plan.status === "PROCESSING") {
        totalActivePrincipal += currentBalance;

        if (plan.status === "ACTIVE") activePlans++;

        if (plan.planType === 'LOCKED') {
          activeFixedCount++;
          activeFixedAmount += currentBalance;
        } else if (plan.planType === 'FLEXIBLE') {
          activeFlexibleCount++;
          activeFlexibleAmount += currentBalance;
        }

        if (plan.maturityDate && plan.maturityDate <= now && plan.status === "ACTIVE") {
          maturedPlans++;
          maturityCount++;
          maturityAmount += currentBalance;
        }

        const hasPendingWithdrawals = plan.withdrawalHistory && plan.withdrawalHistory.some((w: any) => !w.processed);
        if (plan.earlyWithdrawalDate || hasPendingWithdrawals) {
          earlyWithdrawalCount++;
          if (hasPendingWithdrawals) {
            earlyWithdrawalAmount += (plan.withdrawalHistory || []).filter((w: any) => !w.processed).reduce((acc: number, w: any) => acc + (w.amount || 0), 0);
          } else {
            earlyWithdrawalAmount += currentBalance;
          }
        }
      }

      if (plan.status === "COMPLETED") {
        withdrawnPlans++;
      }

      // PREPARE PROFIT CALCULATIONS 
      // EXPECTED: Realized profit + Uncalculated theoretical penalty of ALL currently active principals (if they withdrew right now)
      // REALIZED: The sum of all processed penalty values explicitly recorded in withdrawalHistory where earlyWithdrawal = true

      let theoreticalPenalty = 0;

      if (plan.planType === 'LOCKED') {
        let penaltyRate = plan.meta?.penaltyRate;
        if (penaltyRate === undefined) penaltyRate = defaultFixedPenaltyRate;
        else if (penaltyRate > 1) penaltyRate = penaltyRate / 100;

        if (plan.status === 'ACTIVE' || plan.status === 'PROCESSING') {
          // Active plan theoretical penalty or early withdrawal 
          theoreticalPenalty = Math.floor(currentBalance * penaltyRate);
          totalInterestExpected += theoreticalPenalty;
        }
      } else if (plan.planType === 'FLEXIBLE') {
        // Calculate theoretical penalty for the REMAINING active principal balance
        if ((plan.status === 'ACTIVE' || plan.status === 'PROCESSING') && currentBalance > 0 && plan.maturityDate && plan.maturityDate > now) {
          let flexiblePenaltyRate = plan.meta?.penaltyRate;
          if (flexiblePenaltyRate === undefined) flexiblePenaltyRate = 0.025; // fallback
          else if (flexiblePenaltyRate > 1) flexiblePenaltyRate = flexiblePenaltyRate / 100;

          theoreticalPenalty = Math.floor(currentBalance * flexiblePenaltyRate);
        }

        totalInterestExpected += theoreticalPenalty;
      }

      // Calculate explicitly realized profits directly from withdrawal history
      if (plan.withdrawalHistory && plan.withdrawalHistory.length > 0) {
        const planRealizedProfit = plan.withdrawalHistory
          .filter((w: any) => w.earlyWithdrawal && w.processed)
          .reduce((sum: number, w: any) => sum + (w.penalty || 0), 0);

        realizedProfit += planRealizedProfit;
        totalInterestExpected += planRealizedProfit;
      }
    }

    return {
      totalPlans,
      totalPrincipal,
      totalActivePrincipal,
      totalFixedCount,
      totalFixedAmount,
      totalFlexibleCount,
      totalFlexibleAmount,
      activeFixedCount,
      activeFixedAmount,
      activeFlexibleCount,
      activeFlexibleAmount,
      totalInterestExpected,
      realizedProfit,
      unrealizedProfit: totalInterestExpected - realizedProfit,
      activePlans,
      maturedPlans,
      withdrawnPlans,
      earlyWithdrawalCount,
      earlyWithdrawalAmount,
      maturityCount,
      maturityAmount
    };
  }

  /**
   * Get savings by category for admin
   */
  static async getSavingsByCategory(category?: "active" | "matured" | "withdrawn", page = 1, limit = 20, search?: string) {
    const now = new Date();
    let filter: any = {};

    if (category === "active") {
      filter.status = "ACTIVE";
    } else if (category === "matured") {
      filter.status = "ACTIVE";
      filter.maturityDate = { $lte: now };
    } else if (category === "withdrawn") {
      filter.status = { $in: ["WITHDRAWN", "COMPLETED"] };
    }

    if (search) {
      const regex = new RegExp(search, "i"); // case-insensitive search
      filter.$or = [
        { "planName": regex },
        { "planType": regex }
      ];
    }

    const skip = (page - 1) * limit;

    const [plans, total] = await Promise.all([
      SavingsPlan.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      SavingsPlan.countDocuments(filter)
    ]);

    // Join with user details
    const userIds = plans.map(p => p.userId);
    const users = await User.find({ _id: { $in: userIds } }, { email: 1, user_metadata: 1 });

    return {
      plans,
      users,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit))
    };
  }

  static async deletePlan(userId: string, planId: string) {
    const plan = await SavingsPlan.findById(planId);
    if (!plan) throw new Error('Savings plan not found');
    if (plan.userId.toString() !== userId.toString()) throw new Error('Unauthorized');

    // Only allow deletion if principal is 0
    if (plan.principal > 0) {
      throw new Error(`Cannot delete active plan with balance ${plan.principal}. Please withdraw funds first.`);
    }

    // We can either soft-delete (CANCELLED) or physical delete.
    // 'CANCELLED' keeps history.
    plan.status = 'CANCELLED';
    await plan.save();

    return { message: "Plan deleted successfully" };
  }
}