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
      const maturedPlans = await SavingsPlan.find({
        status: 'ACTIVE',
        maturityDate: { $lte: new Date() }
      });

      if (maturedPlans.length === 0) return;

      logger.info(`Processing ${maturedPlans.length} matured savings plans`);
      await WorkerControlService.reportActivity('savings-maturities', `Processing ${maturedPlans.length} plans`);
      await WorkerLogService.log('savings-maturities', 'info', `Processing ${maturedPlans.length} matured savings plans`);

      for (const plan of maturedPlans) {
        try {
          await this.processMaturedPlan(plan);
        } catch (error: any) {
          logger.error({
            planId: plan._id,
            error: error.message
          }, 'Error processing matured plan');
          await WorkerLogService.log('savings-maturities', 'error', `Error processing matured plan: ${error.message}`, { planId: plan._id });
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in savings maturities worker');
      await WorkerLogService.log('savings-maturities', 'error', `Fatal error in savings maturities worker: ${error.message}`);
    }
  }

  private static async processMaturedPlan(plan: any) {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {
        // Calculate interest
        let daysActive = plan.durationDays;
        if (!daysActive && plan.maturityDate && plan.createdAt) {
          daysActive = Math.ceil((new Date(plan.maturityDate).getTime() - new Date(plan.createdAt).getTime()) / (1000 * 3600 * 24));
        }
        daysActive = daysActive || 30;

        const annualRate = plan.interestRate;
        const dailyRate = annualRate / 365;
        const interestAmount = Math.floor(plan.principal * dailyRate * daysActive);
        const totalAmount = plan.principal + interestAmount;

        if (totalAmount <= 0) {
          plan.status = 'COMPLETED';
          plan.completedAt = new Date();
          plan.interestEarned = 0;
          await plan.save({ session });
          logger.info({ planId: plan._id }, 'Completed zero-amount savings plan');
          await WorkerLogService.log('savings-maturities', 'info', 'Completed zero-amount savings plan', { planId: plan._id });
          return;
        }

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

        if (providerRes.status == "00") {
          await TransferService.completeTransfer(trxn.reference, "savings-withdrawal");

          const traceId = UuidService.generateTraceId();

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
          await plan.save({ session });

          logger.info({
            planId: plan._id,
            userId: plan.userId,
            principal: plan.principal,
            interestEarned: interestAmount
          }, 'Savings plan matured and processed');
          await WorkerLogService.log('savings-maturities', 'info', 'Savings plan matured and processed', { planId: plan._id, interestEarned: interestAmount });
        } else {
          await TransferService.failTransfer(trxn.reference);
          throw new Error(`Transfer failed: ${providerRes.message}`);
        }
      });
    } finally {
      await session.endSession();
    }
  }
}

// Start the worker if this file is run directly
if (require.main === module) {
  SavingsMaturitiesWorker.start().catch(console.error);
}