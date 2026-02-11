import { Worker } from 'bullmq';
import WorkerStatus from './worker-status.model';
import pino from 'pino';
import { SocketService } from '../../shared/sockets';

const logger = pino({ name: 'worker-control-service' });

type WorkerFactory = () => Promise<Worker>;

export class WorkerControlService {
    private static registry: Map<string, WorkerFactory> = new Map();
    private static activeWorkers: Map<string, Worker> = new Map();

    /**
     * Register a worker definition
     * @param name Unique name of the worker
     * @param factory Function that returns a BullMQ Worker instance
     */
    static register(name: string, factory: WorkerFactory) {
        this.registry.set(name, factory);
        logger.info(`Registered worker: ${name}`);
    }

    /**
     * Start a specific worker
     */
    static async start(name: string) {
        if (!this.registry.has(name)) {
            throw new Error(`Worker ${name} not registered`);
        }

        if (this.activeWorkers.has(name)) {
            // Already running (or at least we have an instance)
            // Check if it's closed? BullMQ workers don't have a simple 'isClosed' property exposed easily 
            // but if we have it in activeWorkers, we assume it's running.
            logger.warn(`Worker ${name} is already active`);
            return;
        }

        try {
            const factory = this.registry.get(name)!;
            const workerInstance = await factory();

            this.activeWorkers.set(name, workerInstance);

            // Update DB status
            await WorkerStatus.findOneAndUpdate(
                { workerName: name },
                {
                    status: 'running',
                    lastRunAt: new Date(),
                    lastActivity: new Date(),
                    lastError: null
                },
                { upsert: true, new: true }
            );

            logger.info(`Started worker: ${name}`);
        } catch (error: any) {
            logger.error({ err: error }, `Failed to start worker ${name}`);
            await WorkerStatus.findOneAndUpdate(
                { workerName: name },
                { status: 'error', lastError: error.message },
                { upsert: true }
            );
            throw error;
        }
    }

    /**
     * Stop a specific worker
     */
    static async stop(name: string) {
        const worker = this.activeWorkers.get(name);
        if (!worker) {
            logger.warn(`Worker ${name} is not running`);
            return;
        }

        try {
            await worker.close();
            this.activeWorkers.delete(name);

            await WorkerStatus.findOneAndUpdate(
                { workerName: name },
                { status: 'stopped' },
                { upsert: true }
            );

            logger.info(`Stopped worker: ${name}`);
        } catch (error: any) {
            logger.error({ err: error }, `Error stopping worker ${name}`);
            throw error;
        }
    }

    /**
     * Restart a worker
     */
    static async restart(name: string) {
        await this.stop(name);
        await this.start(name);
    }

    /**
     * Start all registered workers (e.g. on server startup)
     */
    static async startAll() {
        logger.info('Starting all registered workers...');
        for (const name of this.registry.keys()) {
            try {
                await this.start(name);
            } catch (e) {
                logger.error(`Failed to auto-start worker ${name}`);
            }
        }
    }

    /**
     * Stop all workers (graceful shutdown)
     */
    static async stopAll() {
        logger.info('Stopping all workers...');
        for (const name of this.activeWorkers.keys()) {
            await this.stop(name);
        }
    }

    /**
     * Update heartbeat/activity for a worker
     */
    static async reportActivity(name: string, message?: string) {
        try {
            await WorkerStatus.findOneAndUpdate(
                { workerName: name },
                {
                    lastActivity: new Date(),
                    ...(message ? { 'metadata.lastMessage': message } : {})
                }, // Update activity timestamp
                { upsert: true }
            );

            // Broadcast Status
            try {
                const io = SocketService.getIO();
                const adminNamespace = io.of('/admin');
                adminNamespace.emit('worker_status', {
                    name,
                    status: 'running',
                    lastActivity: new Date(),
                    lastMessage: message
                });
            } catch (e) {
                // Ignore socket errors here
            }

        } catch (err) {
            // Don't crash worker if status update fails
            logger.warn({ err }, `Failed to report activity for ${name}`);
        }
    }

    /**
     * Get operational status of all workers
     */
    static async getStatuses() {
        // Get DB state
        const dbStatuses = await WorkerStatus.find({});
        const statusMap = new Map(dbStatuses.map(s => [s.workerName, s.toObject()]));

        // Combine with registry to show all potential workers
        const result = [];
        for (const name of this.registry.keys()) {
            const dbStatus = statusMap.get(name);
            const isActive = this.activeWorkers.has(name);

            result.push({
                name,
                isRunning: isActive,
                dbStatus: dbStatus || { status: 'unknown' },
                activeDetails: isActive ? 'Process Active' : 'Process Inactive'
            });
        }
        return result;
    }
}
