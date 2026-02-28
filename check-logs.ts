import mongoose from 'mongoose';
import { DatabaseService } from './src/shared/db';
import WorkerLog from './src/modules/worker-logs/worker-log.model';

async function run() {
    await DatabaseService.connect();
    const logs = await WorkerLog.find({ workerName: 'profit-realization', level: 'error' }).sort({ createdAt: -1 }).limit(10).lean();
    console.log('--- RECENT ERROR LOGS ---');
    for (const log of logs) {
        console.log(`[${(log as any).createdAt}] ${(log as any).message}`);
        if ((log as any).metadata) console.log((log as any).metadata);
    }

    process.exit(0);
}

run().catch(console.error);
