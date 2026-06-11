/**
 * Savings Maturities Worker
 * Processes matured savings plans and applies interest
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { SavingsPlan } from '../../modules/savings/savings.plan.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { TransferService } from '../../modules/transfers/transfer.service';
import User from '../../modules/users/user.model';
import { TransferRequest } from '../../shared/providers/vfd.provider';
import { sha512 } from 'js-sha512';
import pino from 'pino';

const logger = pino({ name: 'savings-maturities' });

export class SavingsMaturitiesWorker {
  static register() {
    WorkerControlService.register('savings-maturities', async () => {
      const settings = await SettingsService.getSettings();
      let schedule = '*/5 * * * *'; // Every 5 minutes
      if (settings.workersConfig?.has('savings-maturities')) {
        const config = settings.workersConfig.get('savings-maturities');
        if (config?.cronSchedule) schedule = config.cronSchedule;
      }

      await QueueService.removeRepeatableJobs('savings-maturities');
      await QueueService.scheduleRepeatableJob('savings-maturities', schedule);

      return QueueService.createWorker(
        'savings-maturities',
        async () => {
          await this.processMaturedPlans();
        }
      );
    });
  }

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start('savings-maturities');
  }

  private static async processMaturedPlans() {
    try {
      const settings = await SettingsService.getSettings();
      // Find ACTIVE plans that have matured. Skip those already PROCESSING.
      const maturedPlans = await SavingsPlan.find({
        status: 'ACTIVE',
        maturityDate: { $lte: new Date() }
      });

      if (maturedPlans.length === 0) return;

      logger.info(`Processing ${maturedPlans.length} matured savings plans`);
      await WorkerControlService.reportActivity('savings-maturities', `Processing ${maturedPlans.length} plans`);

      for (const plan of maturedPlans) {
        try {
          // Atomically claim the plan for processing
          const claimedPlan = await SavingsPlan.findOneAndUpdate(
            { _id: plan._id, status: 'ACTIVE' },
            { $set: { status: 'PROCESSING' } },
            { new: true }
          );

          if (!claimedPlan) {
            logger.info({ planId: plan._id }, 'Plan already being processed by another worker instance');
            continue;
          }

          await this.processMaturedPlan(claimedPlan, settings);
        } catch (error: any) {
          logger.error({
            planId: plan._id,
            error: error.message
          }, 'Error processing matured plan');
          // Revert status to ACTIVE so it can be retried, unless it was a permanent failure
          await SavingsPlan.findByIdAndUpdate(plan._id, { status: 'ACTIVE' });
          await WorkerLogService.log('savings-maturities', 'error', `Error processing matured plan: ${error.message}`, { planId: plan._id });
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in savings maturities worker');
      await WorkerLogService.log('savings-maturities', 'error', `Fatal error in savings maturities worker: ${error.message}`);
    }
  }

  private static async processMaturedPlan(plan: any, settings: any) {
    // ─────────────────────────────────────────────────────────────────────────
    // TWO-PHASE ORCHESTRATION PATTERN (FIX #5.1)
    // 
    // Problem: VFD transfer inside DB transaction can cause status to get stuck
    // in PENDING if transfer times out or DB commit fails.
    //
    // Solution:
    //   Phase 1 — DB Prepare: Write PENDING record outside transaction
    //   Phase 2 — External Call: Call VFD transfer outside any DB context
    //   Phase 3 — DB Commit: Update status based on transfer result
    //
    // This guarantees status always transitions out of PENDING regardless of
    // external call outcome or DB timing issues.
    // ─────────────────────────────────────────────────────────────────────────

    try {
      // ─ Phase 1: Validation & Delay Period Check ─
      let delayMs = 0;
      if (plan.planType === 'LOCKED') {
        const config = settings.savings?.fixed?.earlyWithdrawal;
        if (config?.type === 'delayed') {
          delayMs = (config.delayDays || 0) * 24 * 60 * 60 * 1000;
        }
      } else if (plan.planType === 'FLEXIBLE' && plan.subType === 'STANDARD') {
        const delayHours = settings.savings?.flexible?.standard?.withdrawalDelayHours || 24;
        delayMs = delayHours * 60 * 60 * 1000;
      }

      const maturityWithDelay = new Date(plan.maturityDate).getTime() + delayMs;

      if (new Date().getTime() < maturityWithDelay) {
        // Still in delay period, revert to ACTIVE for later retry
        await SavingsPlan.findByIdAndUpdate(plan._id, { status: 'ACTIVE' });
        logger.info({ planId: plan._id }, 'Plan matured but in delay period, reverted to ACTIVE');
        return;
      }

      // Calculate interest (duration is strictly maturityDate - createdAt for every plan)
      let daysActive = 30; // fallback
      if (plan.maturityDate && plan.createdAt) {
        daysActive = Math.ceil((new Date(plan.maturityDate).getTime() - new Date(plan.createdAt).getTime()) / (1000 * 3600 * 24));
      }
      daysActive = Math.max(1, daysActive);

      const annualRate = plan.interestRate || 0;
      const dailyRate = annualRate / 365;
      const interestAmount = Math.floor(plan.principal * dailyRate * daysActive);
      const totalAmount = plan.principal + interestAmount;

      if (totalAmount <= 0) {
        // Zero-amount payout, complete immediately
        const session = await DatabaseService.startSession();
        try {
          await DatabaseService.withTransaction(session, async () => {
            plan.status = 'COMPLETED';
            plan.completedAt = new Date();
            plan.interestEarned = 0;
            await plan.save({ session });
          });
        } finally {
          await session.endSession();
        }
        logger.info({ planId: plan._id }, 'Completed zero-amount savings plan');
        await WorkerLogService.log('savings-maturities', 'info', 'Completed zero-amount savings plan', { planId: plan._id });
        return;
      }

      // ─ Phase 1: DB Prepare - Create PENDING transfer record outside session ─
      const vfdProvider = new VfdProvider();
      const user = await User.findById(plan.userId);
      if (!user) throw new Error(`User not found for plan ${plan._id}`);

      const to = (await vfdProvider.getAccountInfo(user.user_metadata.accountNo)).data;
      const from = (await vfdProvider.getPrimeAccountInfo()).data;

      const remark = `Savings maturity payout for ${plan.planName}`;

      const trxn = await TransferService.initiateTransfer({
        fromAccount: from.accountNo,
        toAccount: to.accountNo,
        amount: totalAmount,
        userId: plan.userId,
        beneficiaryName: to.client,
        transferType: "intra",
        bankCode: "999999",
        remark,
        walletBalance: String(to.accountBalance)
      }, "savings-withdrawal");

      const traceId = UuidService.generateTraceId();

      logger.info({
        planId: plan._id,
        transferRef: trxn.reference,
        totalAmount
      }, 'Phase 1 complete: PENDING transfer record created');

      // ─ Phase 2: External Call - VFD transfer OUTSIDE any DB context ─
      let transferSuccess = false;
      let providerErrorMsg = '';

      try {
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
          amount: totalAmount,
          signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
          remark,
          transferType: "intra",
          reference: trxn.reference,
        };

        const providerRes = await vfdProvider.transfer(transferReq);
        transferSuccess = providerRes.status === "00";
        if (!transferSuccess) {
          providerErrorMsg = providerRes.message || JSON.stringify(providerRes);
        }

        logger.info({
          planId: plan._id,
          transferRef: trxn.reference,
          providerStatus: providerRes.status
        }, `Phase 2 complete: VFD transfer ${transferSuccess ? 'succeeded' : 'failed'}`);
      } catch (err: any) {
        providerErrorMsg = err.message || String(err);
        logger.error({
          planId: plan._id,
          transferRef: trxn.reference,
          error: providerErrorMsg
        }, 'Phase 2 error: VFD transfer threw exception');
      }

      // ─ Phase 3: DB Commit - Update status based on transfer result ─
      const session = await DatabaseService.startSession();
      try {
        await DatabaseService.withTransaction(session, async () => {
          if (transferSuccess) {
            // Mark transfer as completed
            await TransferService.completeTransfer(trxn.reference, "savings-withdrawal");

            // Create interest ledger entries
            await LedgerService.createDoubleEntry(
              traceId,
              'interest_pool',
              `user_wallet:${plan.userId}`,
              interestAmount,
              'savings',
              {
                userId: plan.userId,
                subtype: 'interest',
                session,
                meta: { planId: plan._id, principal: plan.principal, interestRate: plan.interestRate, daysActive }
              }
            );

            // Return principal to user
            await LedgerService.createDoubleEntry(
              traceId,
              'savings_pool',
              `user_wallet:${plan.userId}`,
              plan.principal,
              'savings',
              {
                userId: plan.userId,
                subtype: 'principal_return',
                session,
                meta: { planId: plan._id }
              }
            );

            // Update plan status
            plan.status = 'COMPLETED';
            plan.completedAt = new Date();
            plan.interestEarned = interestAmount;

            if (!plan.withdrawalHistory) plan.withdrawalHistory = [];
            plan.withdrawalHistory.push({
              amount: plan.principal,
              penalty: 0,
              netAmount: totalAmount,
              initiated: new Date(),
              completed: new Date(),
              earlyWithdrawal: false,
              processed: true,
              traceId,
              transactionId: trxn.reference
            });

            await plan.save({ session });

            logger.info({
              planId: plan._id,
              userId: plan.userId,
              principal: plan.principal,
              interestEarned: interestAmount,
              traceId
            }, 'Phase 3 complete: Savings plan matured and fully processed');
            await WorkerLogService.log('savings-maturities', 'info', 'Savings plan matured and processed', { planId: plan._id, interestEarned: interestAmount });
          } else {
            // Transfer failed, mark as FAILED and log error
            await TransferService.failTransfer(trxn.reference);
            plan.status = 'ACTIVE'; // Revert to ACTIVE for retry
            await plan.save({ session });

            logger.error({
              planId: plan._id,
              transferRef: trxn.reference,
              providerError: providerErrorMsg
            }, 'Phase 3 complete: Transfer failed, plan reverted to ACTIVE for retry');
            await WorkerLogService.log('savings-maturities', 'error', `Transfer failed: ${providerErrorMsg}`, { planId: plan._id });
          }
        });
      } finally {
        await session.endSession();
      }
    } catch (error: any) {
      logger.error({
        planId: plan._id,
        error: error.message
      }, 'Error in processMaturedPlan (Phase 3 or earlier)');
      // Ensure plan is reverted to ACTIVE for retry if still in PROCESSING
      const updated = await SavingsPlan.findByIdAndUpdate(
        plan._id,
        { status: 'ACTIVE' },
        { new: true }
      );
      if (updated?.status === 'ACTIVE') {
        logger.info({ planId: plan._id }, 'Plan reverted to ACTIVE for retry after error');
      }
      await WorkerLogService.log('savings-maturities', 'error', `Error processing plan: ${error.message}`, { planId: plan._id });
      throw error; // Re-throw so parent catch block logs it
    }
  }
}

// Start the worker if this file is run directly
if (require.main === module) {
  SavingsMaturitiesWorker.start().catch(console.error);
}