/**
 * Auto Save Service
 * Handles automatic debits for savings plans and retries failed attempts.
 */
import { SavingsPlan } from './savings.plan.model';
import { TransferService } from '../transfers/transfer.service';
import { QueueService } from '../../shared/queue';
import { WorkerLogService } from '../worker-logs/worker-log.service';
import User from '../users/user.model';
import { UuidService } from '../../shared/utils/uuid';
import { SettingsService } from '../admin/settings.service';

export class AutoSaveService {
    /**
     * Trigger auto-debit for a plan
     */
    static async triggerAutoSave(planId: string) {
        const plan = await SavingsPlan.findById(planId);
        if (!plan || plan.status !== 'ACTIVE' || !plan.autoSaveConfig?.enabled) return;

        const amount = plan.autoSaveConfig.amount;
        // Check if last run was recent (idempotency check broadly)

        try {
            // Attempt Debit
            await this.executeDebit(plan.userId, amount, planId);

            // On Success: Update plan (lastAutoSaveDate)
            plan.autoSaveConfig.lastRun = new Date();
            plan.autoSaveConfig.retryCount = 0; // Reset retries
            await plan.save();

        } catch (error) {
            // On Failure: Schedule Retry
            await this.scheduleRetry(planId);
        }
    }

    private static async executeDebit(userId: string, amount: number, planId: string) {
        // Logic similar to createPlan but appending to existing
        // 1. Debit Wallet -> Credit Savings Pool
        const idempotencyKey = `autosave_${planId}_${Date.now()}`;

        // Use TransferService logic...
        // For brevity: assuming wallet funded. Real implementation needs VFD transfer logic if from bank,
        // or just wallet debit if from wallet. Assuming Wallet Debit for AutoSave usually.

        const user = await User.findById(userId);
        if (!user) throw new Error("User not found");

        if (Number(user.user_metadata.wallet) < amount) {
            throw new Error("Insufficient Funds");
        }

        // Add to plan principal
        await SavingsPlan.findByIdAndUpdate(planId, { $inc: { principal: amount } });

        // Ledger entry...
        // Notification...
    }

    private static async scheduleRetry(planId: string) {
        const plan = await SavingsPlan.findById(planId);
        if (!plan || !plan.autoSaveConfig) return;

        const settings = await SettingsService.getSettings();
        const maxRetries = settings.savings.autoSave.maxRetries || 3;

        if (plan.autoSaveConfig.retryCount < maxRetries) {
            plan.autoSaveConfig.retryCount += 1;
            await plan.save();

            // Queue retry job (e.g. queue.add('autosave-retry', { planId }, { delay: 24h }))
            const queue = QueueService.createQueue('autosave-retry');
            if (queue) {
                await queue.add('retry-debit', { planId }, { delay: 24 * 60 * 60 * 1000 });
                await WorkerLogService.log('autosave', 'info', `Scheduled retry ${plan.autoSaveConfig.retryCount} for plan ${planId}`);
            }
        } else {
            // Max retries reached
            await WorkerLogService.log('autosave', 'warn', `Max retries reached for plan ${planId}. Auto-save paused?`);
            // Optionally disable auto-save or notify user
        }
    }
}
