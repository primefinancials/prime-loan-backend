/**
 * Savings Contribution Worker
 * Processes scheduled contributions for Flexible savings plans
 * - Runs daily to check for due contributions
 * - Marks pending deductions on schedule days
 * - Attempts to deduct from user wallet when funds available
 */
import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { SavingsPlan } from '../../modules/savings/savings.plan.model';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { TransferService } from '../../modules/transfers/transfer.service';
import { TransferRequest } from '../../shared/providers/vfd.provider';
import { LedgerService } from '../../modules/ledger/LedgerService';
import User from '../../modules/users/user.model';
import { sha512 } from 'js-sha512';
import pino from 'pino';

const logger = pino({ name: 'savings-contribution' });

export class SavingsContributionWorker {
    static register() {
        WorkerControlService.register('savings-contribution', async () => {
            const settings = await SettingsService.getSettings();
            let schedule = '0 6 * * *'; // Daily at 6 AM
            if (settings.workersConfig?.has('savings-contribution')) {
                const config = settings.workersConfig.get('savings-contribution');
                if (config?.cronSchedule) schedule = config.cronSchedule;
            }

            await QueueService.removeRepeatableJobs('savings-contribution');
            await QueueService.scheduleRepeatableJob('savings-contribution', schedule);

            return QueueService.createWorker(
                'savings-contribution',
                async () => {
                    await this.processContributions();
                }
            );
        });
    }

    static async start() {
        await DatabaseService.connect();
        await QueueService.connect();
        this.register();
        await WorkerControlService.start('savings-contribution');
    }

    private static async processContributions() {
        try {
            const now = new Date();
            const currentDay = now.getDay(); // 0-6
            const currentDate = now.getDate(); // 1-31

            // Find all active Flexible plans with contribution configured
            const plans = await SavingsPlan.find({
                status: 'ACTIVE',
                planType: 'FLEXIBLE',
                'contribution.frequency': { $exists: true }
            });

            logger.info(`Processing ${plans.length} Flexible savings plans for contributions`);
            await WorkerControlService.reportActivity('savings-contribution', `Checking ${plans.length} plans`);

            for (const plan of plans) {
                try {
                    await this.processPlanContribution(plan, currentDay, currentDate);
                } catch (error: any) {
                    logger.error({
                        planId: plan._id,
                        error: error.message
                    }, 'Error processing contribution');
                    await WorkerLogService.log('savings-contribution', 'error', `Error: ${error.message}`, { planId: plan._id });
                }
            }
        } catch (error: any) {
            logger.error({ error: error.message }, 'Fatal error in contribution worker');
            await WorkerLogService.log('savings-contribution', 'error', `Fatal: ${error.message}`);
        }
    }

    private static async processPlanContribution(plan: any, currentDay: number, currentDate: number) {
        const contribution = plan.contribution;
        if (!contribution || !contribution.frequency || !contribution.amount) return;

        // Check if today is a deduction day
        const isDueDay =
            (contribution.frequency === 'weekly' && contribution.dayOfWeek === currentDay) ||
            (contribution.frequency === 'monthly' && contribution.dayOfMonth === currentDate);

        // Mark as pending if due day or already pending
        if (isDueDay && !contribution.pendingDeduction) {
            plan.contribution.pendingDeduction = true;
            await plan.save();
            logger.info(`Marked plan ${plan._id} for pending deduction`);
        }

        // Attempt deduction if pending
        if (plan.contribution.pendingDeduction) {
            await this.attemptDeduction(plan);
        }
    }

    private static async attemptDeduction(plan: any) {
        const vfdProvider = new VfdProvider();
        const contribution = plan.contribution;
        const amount = contribution.amount;

        try {
            // Get user account
            const user = await User.findById(plan.userId);
            if (!user) {
                logger.warn(`User not found for plan ${plan._id}`);
                return;
            }

            const from = (await vfdProvider.getAccountInfo(user.user_metadata.accountNo)).data;

            // Check if user has sufficient balance
            if (from.accountBalance < amount) {
                logger.info(`Insufficient balance for plan ${plan._id}, keeping pendingDeduction=true`);
                await WorkerLogService.log('savings-contribution', 'info', `Insufficient balance, retrying later`, { planId: plan._id, balance: from.accountBalance, required: amount });
                return; // Will retry on next run
            }

            const to = (await vfdProvider.getPrimeAccountInfo()).data;

            // Create transfer
            const trxn = await TransferService.initiateTransfer({
                fromAccount: from.accountNo,
                userId: plan.userId,
                toAccount: to.accountNo,
                amount: amount,
                beneficiaryName: to.client,
                transferType: "intra",
                bankCode: "999999",
                remark: `Flexible savings contribution for ${plan.planName}`,
                walletBalance: String(from.accountBalance),
                naration: `Auto contribution - ${plan.planName}`,
                idempotencyKey: `contrib-${plan._id}-${Date.now()}`,
            }, "savings-deposit");

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
                amount: amount,
                remark: `Flexible savings contribution for ${plan.planName}`,
                transferType: "intra",
                reference: trxn.reference,
            };

            const providerRes = await vfdProvider.transfer(transferReq);

            if (providerRes.status === "00") {
                const trxnRes = await TransferService.completeTransfer(trxn.reference, "savings-deposit");

                // Update plan
                plan.principal += amount;
                plan.contribution.pendingDeduction = false;
                plan.contribution.lastDeductionDate = new Date();
                await plan.save();

                // Ledger entry
                await LedgerService.createDoubleEntry(
                    trxnRes?.traceId || "",
                    `user_wallet:${plan.userId}`,
                    'savings_pool',
                    amount,
                    'savings',
                    {
                        userId: plan.userId,
                        subtype: 'contribution',
                        meta: {
                            planId: plan._id,
                            transactionId: trxnRes?.transferId || ""
                        }
                    }
                );

                logger.info(`Successfully processed contribution for plan ${plan._id}`);
                await WorkerLogService.log('savings-contribution', 'info', `Contribution processed`, { planId: plan._id, amount });
            } else {
                await TransferService.failTransfer(trxn.reference);
                logger.warn(`Transfer failed for plan ${plan._id}: ${providerRes.message}`);
            }
        } catch (error: any) {
            logger.error({ planId: plan._id, error: error.message }, 'Error during deduction attempt');
            throw error;
        }
    }
}

// Start the worker if this file is run directly
if (require.main === module) {
    SavingsContributionWorker.start().catch(console.error);
}
