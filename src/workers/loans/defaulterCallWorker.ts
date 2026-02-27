import { QueueService } from '../../shared/queue';
import Loan from '../../modules/loans/loan.model';
import { DatabaseService } from '../../shared/db';
import { SettingsService } from '../../modules/admin/settings.service';
import { TwilioProvider } from '../../shared/providers/twilio.provider';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import pino from 'pino';
import { UserService } from '../../modules/users/user.service';

const logger = pino({ name: 'defaulter-call-worker' });

export class DefaulterCallWorker {
    static register() {
        WorkerControlService.register('defaulter-call-worker', async () => {
            const settings = await SettingsService.getSettings();
            let schedule = '0 10 * * *'; // Default 10 AM every day
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
            // 1. Get Settings
            const settings = await SettingsService.getSettings();
            const config = settings.defaulterCallConfig;

            if (!config || !config.enabled) {
                logger.info('Defaulter calls are disabled in settings');
                await WorkerControlService.reportActivity('defaulter-call-worker', 'Calls disabled');
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

            const twilio = new TwilioProvider();
            const today = new Date().toISOString().split('T')[0];
            const calledUsers: { phone: string, name?: string, amount?: number }[] = [];

            for (const loan of overdueLoans) {
                try {
                    const user = await UserService.getUser(loan.userId);
                    const phone = user?.user_metadata?.phone;

                    if (!phone) {
                        logger.warn({ loanId: loan._id }, 'User has no phone number');
                        continue;
                    }

                    // Check call history limit
                    const callsToday = (loan.call_history || []).filter((call: any) =>
                        call.date && new Date(call.date).toISOString().startsWith(today)
                    ).length;

                    if (callsToday >= config.maxCallsPerDay) {
                        logger.info({ loanId: loan._id }, 'Max calls reached for today');
                        continue;
                    }

                    // Make Call
                    // Try-catch specific call to avoid stopping loop
                    try {
                        await twilio.makeCall(phone, message);

                        // Update Loan History
                        loan.call_history = [
                            ...(loan.call_history || []),
                            {
                                date: new Date(),
                                status: 'initiated',
                                provider: 'twilio'
                            }
                        ];
                        // Mark modified if mixed type doesn't auto-detect
                        loan.markModified('call_history');
                        await loan.save();

                        logger.info({ loanId: loan._id, phone }, 'Call initiated');
                        await WorkerLogService.log('defaulter-call-worker', 'info', `Call initiated to ${phone}`, { loanId: loan._id, name: user.name || user.firstName });

                        calledUsers.push({ phone, name: user.name || user.firstName, amount: loan.outstanding });

                    } catch (callErr: any) {
                        logger.error({ loanId: loan._id, error: callErr.message }, 'Twilio call failed');
                        await WorkerLogService.log('defaulter-call-worker', 'error', `Twilio call failed: ${callErr.message}`, { loanId: loan._id });
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
