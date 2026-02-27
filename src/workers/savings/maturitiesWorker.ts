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

      logger.info(`Processing ${maturedPlans.length} matured savings plans`);
      await WorkerControlService.reportActivity('savings-maturities', `Processing ${maturedPlans.length} plans`);
      if (maturedPlans.length > 0) {
        await WorkerLogService.log('savings-maturities', 'info', `Processing ${maturedPlans.length} matured savings plans`);
      }

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
        const daysActive = plan.durationDays || 30;
        const annualRate = plan.interestRate;
        const dailyRate = annualRate / 365;
        const interestAmount = Math.floor(plan.principal * dailyRate * daysActive);

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
            meta: {
              planId: plan._id,
              principal: plan.principal,
              interestRate: plan.interestRate,
              daysActive
            }
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
            meta: {
              planId: plan._id
            }
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