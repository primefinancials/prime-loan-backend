import { QueueService } from '../../shared/queue';
import Loan from '../../modules/loans/loan.model';
import { DatabaseService } from '../../shared/db';
import { SettingsService } from '../../modules/admin/settings.service';
import { getVoiceProvider, getRecoveryMessage } from '../../shared/providers/voice-call.provider';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import pino from 'pino';
import { UserService } from '../../modules/users/user.service';

const logger = pino({ name: 'defaulter-call-worker' });

export class DefaulterCallWorker {
    static register() {
        WorkerControlService.register('defaulter-call-worker', async () => {
            const settings = await SettingsService.getSettings();
            let schedule = '*/5 * * * *'; // Every 5 minutes
            if (settings.workersConfig?.has('defaulter-call-worker')) {
                const config = settings.workersConfig.get('defaulter-call-worker');
                if (config?.cronSchedule) schedule = config.cronSchedule;
            }

            // Remove existing instances of repeatable jobs and replace with new schedule
            await QueueService.removeRepeatableJobs('defaulter-call-worker');
            await QueueService.scheduleRepeatableJob('defaulter-call-worker', schedule);

            return QueueService.createWorker(
                'defaulter-call-worker',
                async () => {
                    await this.processDefaulters();
                }
            );
        });
    }

    static async start() {
        await DatabaseService.connect();
        await QueueService.connect();
        this.register();
        await WorkerControlService.start('defaulter-call-worker');
    }

    private static async processDefaulters() {
        try {
            await WorkerLogService.log('defaulter-call-worker', 'info', 'Starting defaulter call processing loop...');

            // 1. Get Settings
            const settings = await SettingsService.getSettings();
            const config = settings.defaulterCallConfig;

            if (!config || !config.enabled) {
                logger.info('Defaulter calls are disabled in settings');
                await WorkerControlService.reportActivity('defaulter-call-worker', 'Calls disabled');
                await WorkerLogService.log('defaulter-call-worker', 'warn', 'Defaulter calls are currently disabled in settings. Skipping...');
                return;
            }

            // 2. Find Defaulters (Accepted loans, outstanding > 0, overdue)
            const now = new Date();
            const overdueLoans = await Loan.find({
                status: 'accepted',
                outstanding: { $gt: 0 },
                repayment_date: { $lt: now.toISOString() } // assuming string ISO date in usage
            });

            const message = config.message || "This is a reminder from Prime Finance about your overdue loan.";

            logger.info(`Found ${overdueLoans.length} overdue loans`);
            await WorkerControlService.reportActivity('defaulter-call-worker', `Processing ${overdueLoans.length} overdue loans`);
            await WorkerLogService.log('defaulter-call-worker', 'info', `Found ${overdueLoans.length} overdue loans to process.`);

            if (overdueLoans.length === 0) {
                return; // Nothing to process
            }

            const voiceProvider = await getVoiceProvider();
            const providerName = voiceProvider.providerName;
            const today = new Date().toISOString().split('T')[0];
            const calledUsers: { phone: string, name?: string, amount?: number }[] = [];

            for (const loan of overdueLoans) {
                try {
                    const user = await UserService.getUser(loan.userId);
                    let phone = user?.user_metadata?.phone;

                    if (!phone) {
                        logger.warn({ loanId: loan._id }, 'User has no phone number');
                        continue;
                    }

                    // Format phone for provider
                    if (phone.startsWith('0')) {
                        phone = '+234' + phone.substring(1);
                    } else if (phone.startsWith('234')) {
                        phone = '+' + phone;
                    }

                    // Check call history limit
                    const callsToday = (loan.call_history || []).filter((call: any) =>
                        call.date && new Date(call.date).toISOString().startsWith(today)
                    ).length;

                    if (callsToday >= config.maxCallsPerDay) {
                        logger.info({ loanId: loan._id }, 'Max calls reached for today');
                        await WorkerLogService.log('defaulter-call-worker', 'warn', `Skipping ${phone}: Max calls (${config.maxCallsPerDay}) reached for today for this loan.`);
                        continue;
                    }

                    // Calculate days overdue for escalation
                    const dueDate = new Date(loan.repayment_date);
                    const daysOverdue = Math.max(1, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

                    // Build escalation-aware recovery message
                    const customTemplates: Record<string, string> = {};
                    const templates = (config as any).messageTemplates;
                    if (templates) {
                        if (templates.tier1?.smsTemplate) customTemplates['tier1'] = templates.tier1.smsTemplate;
                        if (templates.tier2?.smsTemplate) customTemplates['tier2'] = templates.tier2.smsTemplate;
                        if (templates.tier3?.smsTemplate) customTemplates['tier3'] = templates.tier3.smsTemplate;
                        if (templates.tier4?.smsTemplate) customTemplates['tier4'] = templates.tier4.smsTemplate;
                    }

                    const recovery = getRecoveryMessage(daysOverdue, {
                        name: user.user_metadata?.first_name || 'Customer',
                        amount: String(loan.amount || 0),
                        outstanding: String(loan.outstanding || 0),
                        date: dueDate.toLocaleDateString('en-NG'),
                        days: daysOverdue
                    }, Object.keys(customTemplates).length > 0 ? customTemplates : undefined);

                    const callMessage = recovery.message || message;
                    const maxCallsForTier = recovery.maxCallsPerDay;

                    // Use tier-specific max calls if available
                    if (callsToday >= maxCallsForTier) {
                        logger.info({ loanId: loan._id, tier: recovery.tier, callsToday, maxCallsForTier }, 'Max calls reached for today (tier-aware)');
                        continue;
                    }

                    // Make Call
                    try {
                        await voiceProvider.makeCall(phone, callMessage);

                        // Update Loan History
                        loan.call_history = [
                            ...(loan.call_history || []),
                            {
                                date: new Date(),
                                status: 'initiated',
                                provider: providerName
                            }
                        ];
                        // Mark modified if mixed type doesn't auto-detect
                        loan.markModified('call_history');
                        await loan.save();

                        logger.info({ loanId: loan._id, phone }, 'Call initiated');
                        await WorkerLogService.log('defaulter-call-worker', 'info', `Call initiated to ${phone}`, { loanId: loan._id, name: user.user_metadata?.first_name });

                        calledUsers.push({ phone, name: user.user_metadata?.first_name, amount: loan.outstanding });

                    } catch (callErr: any) {
                        logger.error({ loanId: loan._id, error: callErr.message }, `${providerName} call failed`);
                        await WorkerLogService.log('defaulter-call-worker', 'error', `${providerName} call failed: ${callErr.message}`, { loanId: loan._id });
                    }

                } catch (err: any) {
                    logger.error({ loanId: loan._id, error: err.message }, 'Error in defaulter loop');
                }
            }

            // Log detailed summary
            await WorkerLogService.log('defaulter-call-worker', 'info', `Finished automated calls. Successfully called ${calledUsers.length} users.`, {
                calledUsers
            });

        } catch (error: any) {
            logger.error({ error: error.message }, 'Fatal error in defaulter call worker');
            await WorkerLogService.log('defaulter-call-worker', 'error', `Fatal error: ${error.message}`);
        }
    }
}
