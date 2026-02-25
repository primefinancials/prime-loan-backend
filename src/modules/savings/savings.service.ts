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
          } : undefined
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

          // 1. STANDARD (Delayed)
          if (subType === 'STANDARD') {
            const delayHours = setting.savings.flexible.standard.withdrawalDelayHours || 24;
            const penaltyRate = (setting.savings.flexible.standard.penaltyRate || 0) / 100;

            // Calculate scheduled date
            const scheduledDate = new Date();
            scheduledDate.setHours(scheduledDate.getHours() + delayHours);

            // Calculate Net
            const penalty = Math.floor(amount * penaltyRate);
            const netAmount = amount - penalty;

            // Deduct from Principal based on logic: Reserve Funds immediately
            plan.principal -= amount;

            // Add to Pending Withdrawals
            if (!plan.pendingWithdrawals) plan.pendingWithdrawals = [];
            plan.pendingWithdrawals.push({
              amount,
              penalty,
              netAmount,
              requestDate: new Date(),
              scheduledDate,
              status: 'PENDING',
              traceId
            });

            plan.principal -= amount;
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
          const penaltyRate = (setting.savings.flexible.instant.penaltyRate || 0) / 100;
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
              earlyWithdrawal: false,
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

            plan.principal -= amount;
            if (plan.principal <= 0) {
              plan.status = 'COMPLETED';
            }
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
          }
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
    // Find plans with pending withdrawals that are due
    const plans = await SavingsPlan.find({
      'pendingWithdrawals.status': 'PENDING',
      'pendingWithdrawals.scheduledDate': { $lte: now }
    });

    console.log(`Processing ${plans.length} plans with due withdrawals at ${now.toISOString()}`);

    for (const plan of plans) {
      if (!plan.pendingWithdrawals) continue;

      // Filter due items
      const dueItems = plan.pendingWithdrawals.filter(w => w.status === 'PENDING' && w.scheduledDate <= now);

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
              withdrawal.status = 'PROCESSED';
              withdrawal.transactionId = trxn.reference;

              if (plan.principal <= 0) {
                plan.status = 'COMPLETED';
              }
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
      // Save plan after processing items
      await plan.save();
    }
  }

  static async adminDisburseWithdrawal(planId: string, traceId: string, adminId: string) {
    const plan = await SavingsPlan.findById(planId);
    if (!plan) throw new Error("Plan not found");

    if (!plan.pendingWithdrawals) {
      throw new Error("No pending withdrawals found for this plan");
    }

    const withdrawalIndex = plan.pendingWithdrawals.findIndex(
      (w) => (w as any).traceId === traceId || (w as any)._id?.toString() === traceId
    );

    if (withdrawalIndex === -1) {
      throw new Error("Specific withdrawal not found");
    }

    const withdrawal = plan.pendingWithdrawals[withdrawalIndex];

    if (withdrawal.status !== 'PENDING') {
      throw new Error(`Withdrawal is already ${withdrawal.status}`);
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
          withdrawal.status = 'PROCESSED';
          (withdrawal as any).transactionId = trxn.reference;

          if (plan.principal <= 0) {
            plan.status = 'COMPLETED';
          }
        } else {
          await TransferService.failTransfer(trxn.reference);
          throw new Error(`Transfer failed: ${providerRes.message}`);
        }
      });
    } finally {
      await session.endSession();
    }

    await plan.save();
    return plan;
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
    filter: 'all' | 'active' | 'awaiting_withdrawal' | 'completed' | 'cancelled' | 'fixed' | 'flexible' = 'all',
    search?: string
  ) {
    const skip = (page - 1) * limit;

    let query: any = {};

    switch (filter) {
      case 'active':
        query = { status: 'ACTIVE', earlyWithdrawalDate: { $eq: null }, 'pendingWithdrawals.status': { $ne: 'PENDING' } };
        break;
      case 'awaiting_withdrawal':
        query = {
          status: 'ACTIVE',
          $or: [
            { earlyWithdrawalDate: { $ne: null } },
            { 'pendingWithdrawals.status': 'PENDING' }
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
      case 'all':
      default:
        query = {};
        break;
    }

    if (search && search.trim() !== '') {
      // Need to import User. User is already imported usually, check imports if it fails
      const users = await User.find({ email: { $regex: search, $options: 'i' } }).select('_id');
      const userIds = users.map(u => u._id);
      query.userId = { $in: userIds };
    }

    const [plans, total] = await Promise.all([
      SavingsPlan.find(query)
        .populate('userId', 'email user_metadata.first_name user_metadata.surname user_metadata.phone_number')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      SavingsPlan.countDocuments(query)
    ]);

    return {
      plans,
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
      createdAt: 1
    });

    let totalPlans = 0;
    let totalPrincipal = 0;
    let totalInterestExpected = 0;
    let realizedProfit = 0;
    let unrealizedProfit = 0;
    let activePlans = 0;
    let maturedPlans = 0;
    let withdrawnPlans = 0;

    for (const plan of plans) {
      totalPlans++;
      totalPrincipal += plan.principal || 0;

      // Calculate expected interest (simple: principal * rate * (duration/365))
      const duration = plan.durationDays || 0;
      const expectedInterest = Math.floor((plan.principal || 0) * (plan.interestRate) * (duration / 365));
      totalInterestExpected += expectedInterest;

      if (plan.status === "ACTIVE") {
        activePlans++;
        if (plan.maturityDate && plan.maturityDate <= now) {
          maturedPlans++;
        }
      }

      if (plan.status === "COMPLETED") {
        withdrawnPlans++;
        // Assume realized profit = expectedInterest
        realizedProfit += expectedInterest;
      } else {
        unrealizedProfit += expectedInterest;
      }
    }

    return {
      totalPlans,
      totalPrincipal,
      totalInterestExpected,
      realizedProfit,
      unrealizedProfit,
      activePlans,
      maturedPlans,
      withdrawnPlans
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