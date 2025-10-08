/**
 * Savings Maturities Worker
 * Processes matured savings plans and applies interest
 */
import { QueueService } from '../../shared/queue';
import { SavingsPlan } from '../../modules/savings/savings.plan.model';
import { LedgerService } from '../../modules/ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';
import pino from 'pino';

const logger = pino({ name: 'savings-maturities' });

export class SavingsMaturitiesWorker {
  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();

    // Run hourly
    const worker = QueueService.createWorker(
      'savings-maturities',
      async () => {
        await this.processMaturedPlans();
      },
      {
        repeat: { pattern: '0 * * * *' }, // Every hour
        removeOnComplete: 5,
        removeOnFail: 10
      }
    );

    logger.info('Savings maturities worker started');

    process.on('SIGTERM', async () => {
      await worker.close();
      await QueueService.closeAll();
    });
  }

  private static async processMaturedPlans() {
    try {
      const maturedPlans = await SavingsPlan.find({
        status: 'ACTIVE',
        maturityDate: { $lte: new Date() }
      });

      logger.info(`Processing ${maturedPlans.length} matured savings plans`);

      for (const plan of maturedPlans) {
        try {
          await this.processMaturedPlan(plan);
        } catch (error: any) {
          logger.error({ 
            planId: plan._id, 
            error: error.message 
          }, 'Error processing matured plan');
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in savings maturities worker');
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