import WorkerLog, { IWorkerLog } from './worker-log.model';

export class WorkerLogService {
    /**
     * Log a worker event to the database
     */
    static async log(
        workerName: string,
        level: 'info' | 'error' | 'warn',
        message: string,
        metadata?: any
    ): Promise<IWorkerLog> {
        try {
            const log = new WorkerLog({
                workerName,
                level,
                message,
                metadata
            });
            return await log.save();
        } catch (error) {
            console.error('Failed to save worker log:', error);
            // Return a partial object or throw, depending on how strict we want to be.
            // Since logging failure shouldn't crash the worker, we'll swallow and return as casted any.
            return {} as IWorkerLog;
        }
    }

    /**
     * Retrieve logs for a specific worker or all workers
     */
    static async getLogs(workerName?: string, limit: number = 100): Promise<IWorkerLog[]> {
        const query = workerName ? { workerName } : {};
        return await WorkerLog.find(query)
            .sort({ timestamp: -1 })
            .limit(limit)
            .exec();
    }
}
