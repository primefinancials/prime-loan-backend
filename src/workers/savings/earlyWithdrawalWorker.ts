/**
 * Savings Early Withdrawal Worker
 * Processes scheduled early withdrawals for savings plans
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { SavingsPlan } from '../../modules/savings/savings.plan.model';
import { SavingsService } from '../../modules/savings/savings.service';
import { DatabaseService } from '../../shared/db';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import pino from 'pino';

const logger = pino({ name: 'savings-early-withdrawal' });

export class SavingsEarlyWithdrawalWorker {
    static register() {
        WorkerControlService.register('savings-early-withdrawal', async () => {
            const settings = await SettingsService.getSettings();
            let schedule = '*/5 * * * *'; // Every 5 minutes
            if (settings.workersConfig?.has('savings-early-withdrawal')) {
                const config = settings.workersConfig.get('savings-early-withdrawal');
                if (config?.cronSchedule) schedule = config.cronSchedule;
            }

            await QueueService.removeRepeatableJobs('savings-early-withdrawal');
            await QueueService.scheduleRepeatableJob('savings-early-withdrawal', schedule);

            return QueueService.createWorker(
                'savings-early-withdrawal',
                async () => {
                    await this.processScheduledWithdrawals();
                }
            );
        });
    }

    static async start() {
        await DatabaseService.connect();
        await QueueService.connect();
        this.register();
        await WorkerControlService.start('savings-early-withdrawal');
    }

    private static async processScheduledWithdrawals() {
        try {
            const now = new Date();
            const scheduledPlans = await SavingsPlan.find({
                status: 'ACTIVE',
                earlyWithdrawalDate: { $lte: now, $ne: null }
            });

            logger.info(`Processing ${scheduledPlans.length} scheduled early withdrawals`);
            await WorkerControlService.reportActivity('savings-early-withdrawal', `Processing ${scheduledPlans.length} plans`);
            await WorkerLogService.log('savings-early-withdrawal', 'info', `Processing ${scheduledPlans.length} scheduled early withdrawals`);

            if (scheduledPlans.length === 0) return;

            for (const plan of scheduledPlans) {
                try {
                    await this.processWithdrawal(plan);
                } catch (error: any) {
                    logger.error({
                        planId: plan._id,
                        error: error.message
                    }, 'Error processing early withdrawal');
                    await WorkerLogService.log('savings-early-withdrawal', 'error', `Error processing withdrawal: ${error.message}`, { planId: plan._id });
                }
            }
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error in savings early withdrawal worker');
            await WorkerLogService.log('savings-early-withdrawal', 'error', `Fatal error: ${error.message}`);
        }
    }

    private static async processWithdrawal(plan: any) {
        logger.info(`Processing withdrawal for plan ${plan._id}`);

        // We reuse SavingsService.completePlan logic
        // But we need to be careful not to re-schedule it.
        // In completePlan, if date < maturity, it checks if rescheduled.
        // If we call completePlan here, it might trigger the scheduling logic again IF we don't clear the date or change status.
        // However, completePlan logic: 
        // "if (earlyWithdrawalConfig.type === 'delayed') { if (plan.earlyWithdrawalDate) throw Error... }"

        // Wait! If I call completePlan, it sees `earlyWithdrawalDate` is SET.
        // And it sees `now < maturity`.
        // so it throws "Early withdrawal already scheduled".
        // I need to bypass that check or modify completePlan to handle "execution phase".
        // OR, I can temporarily unset `earlyWithdrawalDate` or set a flag in params?
        // User requested "calculate the number of days to delay as specified in setting and create the earlywithdrawaldate. if immediate withdrawal disburse funds immediately."
        // He implies that the `earlyWithdrawalDate` is the trigger.

        // If I use `completePlan`, I need to tell it "This IS the scheduled run".
        // `completePlan` doesn't have a flag for that.
        // I should probably manually execute the withdrawal logic here akin to `processMaturedPlan` in `maturitiesWorker.ts`, 
        // OR create a dedicated method in `SavingsService` for executing scheduled withdrawals.
        // duplicating logic is bad.
        // existing `completePlan` is heavy with Ledger/VFD stuff.

        // Let's modify `SavingsService.completePlan` to accept an override or "force" flag?
        // Or simpler: The worker sets `plan.earlyWithdrawalDate = null` (or similar) BEFORE calling completePlan?
        // If I set it to null, `completePlan` will see `now < maturity` and think it's a NEW early withdrawal request. 
        // Then it checks settings. If settings say "delayed", it will SCHEDULE IT AGAIN. Loop!

        // So `completePlan` needs to know "Execute Immediate" regardless of settings.
        // I will add `forceImmediate: boolean` to `WithdrawParams`.

        await SavingsService.completePlan({
            planId: plan._id,
            userId: plan.userId,
            amount: plan.principal, // Full amount
            idempotencyKey: `early-withdraw-${plan._id}-${Date.now()}`,
            forceImmediate: true
        } as any); // Type cast until I update the interface

        logger.info(`Successfully processed early withdrawal for plan ${plan._id}`);

        // Note: completePlan will update status to COMPLETED.
    }
}

// Start the worker if this file is run directly
if (require.main === module) {
    SavingsEarlyWithdrawalWorker.start().catch(console.error);
}
