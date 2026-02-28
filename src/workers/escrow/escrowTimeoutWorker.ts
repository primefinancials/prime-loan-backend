import { QueueService } from '../../shared/queue';
import { SettingsService } from '../../modules/admin/settings.service';
import { EscrowTransaction } from '../../modules/escrow/escrow.model';
import { DatabaseService } from '../../shared/db';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import { EscrowService } from '../../modules/escrow/escrow.service';
import pino from 'pino';

const logger = pino({ name: 'escrow-timeout-worker' });

export class EscrowTimeoutWorker {
    static register() {
        WorkerControlService.register('escrow-timeout', async () => {
            const settings = await SettingsService.getSettings();
            let schedule = '*/5 * * * *'; // Every 5 minutes
            if (settings.workersConfig?.has('escrow-timeout')) {
                const config = settings.workersConfig.get('escrow-timeout');
                if (config?.cronSchedule) schedule = config.cronSchedule;
            }

            await QueueService.removeRepeatableJobs('escrow-timeout');
            await QueueService.scheduleRepeatableJob('escrow-timeout', schedule);

            return QueueService.createWorker(
                'escrow-timeout',
                async () => {
                    await this.processExpiredEscrows();
                }
            );
        });
    }

    static async start() {
        await DatabaseService.connect();
        await QueueService.connect();
        this.register();
        await WorkerControlService.start('escrow-timeout');
    }

    private static async processExpiredEscrows() {
        try {
            const now = new Date();

            // 1. Find Expired PENDING escrows
            const expiredPending = await EscrowTransaction.find({
                status: 'PENDING',
                expiryDate: { $lt: now }
            });

            logger.info(`Found ${expiredPending.length} expired PENDING escrows`);
            await WorkerControlService.reportActivity('escrow-timeout', `Found ${expiredPending.length} expired PENDING`);
            await WorkerLogService.log('escrow-timeout', 'info', `Found ${expiredPending.length} expired PENDING escrows`);

            for (const escrow of expiredPending) {
                escrow.status = 'CANCELLED';
                await escrow.save();
                await WorkerLogService.log('escrow-timeout', 'info', `Auto-cancelled expired pending escrow ${escrow.transactionId}`);
            }

            // 2. Find Expired LOCKED escrows -> Auto-Resolve
            const expiredLocked = await EscrowTransaction.find({
                status: 'LOCKED',
                expiryDate: { $lt: now }
            });

            if (expiredLocked.length > 0) {
                logger.info(`Found ${expiredLocked.length} expired LOCKED escrows. Auto-resolving...`);
                await WorkerControlService.reportActivity('escrow-timeout', `Auto-resolving ${expiredLocked.length} locked escrows`);

                for (const escrow of expiredLocked) {
                    try {
                        // System Auto-Complete
                        await EscrowService.confirmDelivery((escrow._id as any).toString(), 'system', true);
                        await WorkerLogService.log('escrow-timeout', 'info', `Auto-completed escrow ${escrow.transactionId}`);
                    } catch (err: any) {
                        logger.error({ err }, `Failed to auto-resolve escrow ${escrow.transactionId}`);
                        await WorkerLogService.log('escrow-timeout', 'error', `Failed to resolve ${escrow.transactionId}: ${err.message}`);
                    }
                }
            }

        } catch (error: any) {
            logger.error({ error: error.message }, 'Fatal error in escrow timeout worker');
            await WorkerLogService.log('escrow-timeout', 'error', `Fatal error: ${error.message}`);
        }
    }
}
