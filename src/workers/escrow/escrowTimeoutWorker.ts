import { QueueService } from '../../shared/queue';
import { EscrowTransaction } from '../../modules/escrow/escrow.model';
import { DatabaseService } from '../../shared/db';
import { WorkerLogService } from '../../modules/worker-logs/worker-log.service';
import { WorkerControlService } from '../../modules/workers/worker-control.service';
import pino from 'pino';

const logger = pino({ name: 'escrow-timeout-worker' });

export class EscrowTimeoutWorker {
    static register() {
        WorkerControlService.register('escrow-timeout', async () => {
            return QueueService.createWorker(
                'escrow-timeout',
                async () => {
                    await this.processExpiredEscrows();
                },
                {
                    repeat: { pattern: '0 0 * * *' }, // Daily at midnight
                    removeOnComplete: 5,
                    removeOnFail: 10
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

            for (const escrow of expiredPending) {
                escrow.status = 'CANCELLED';
                await escrow.save();
                await WorkerLogService.log('escrow-timeout', 'info', `Auto-cancelled expired pending escrow ${escrow.transactionId}`);
            }

            // 2. Find Expired LOCKED escrows (Just log for now, manual intervention might be safer)
            const expiredLocked = await EscrowTransaction.find({
                status: 'LOCKED',
                expiryDate: { $lt: now }
            });

            if (expiredLocked.length > 0) {
                logger.warn(`Found ${expiredLocked.length} expired LOCKED escrows requiring attention`);
                await WorkerLogService.log('escrow-timeout', 'warn', `Found ${expiredLocked.length} expired LOCKED escrows. Admin review needed.`);
            }

        } catch (error: any) {
            logger.error({ error: error.message }, 'Fatal error in escrow timeout worker');
            await WorkerLogService.log('escrow-timeout', 'error', `Fatal error: ${error.message}`);
        }
    }
}
