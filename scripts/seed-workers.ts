
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import WorkerStatus from '../src/modules/workers/worker-status.model';
import { CollectionUtils } from '../src/shared/utils/collection.utils';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const WORKERS = [
    { name: 'billPaymentsPoller', description: 'Polls for bill payment status' },
    { name: 'transfersPoller', description: 'Polls for transfer status updates' },
    { name: 'penaltiesCron', description: 'Daily check for loan penalties' },
    { name: 'profitsCron', description: 'Calculates daily profits' },
    { name: 'maturitiesWorker', description: 'Checks for savings maturities' },
    { name: 'escrowTimeoutWorker', description: 'Handles expired escrows' },
    { name: 'defaulterCallWorker', description: 'Calls loan defaulters' },
    { name: 'profit-realization', description: 'Realizes transaction profits' }
];

async function seedWorkers() {
    try {
        const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/prime-loan-backend';
        console.log(`Connecting to MongoDB...`);
        await mongoose.connect(mongoUri);
        console.log('Connected.');

        for (const worker of WORKERS) {
            console.log(`Checking worker: ${worker.name}`);
            const existing = await WorkerStatus.findOne({ workerName: worker.name });
            if (!existing) {
                await WorkerStatus.create({
                    workerName: worker.name,
                    status: 'stopped',
                    metadata: { description: worker.description },
                    lastRunAt: new Date(0), // Never run
                    lastActivity: new Date()
                });
                console.log(`Created worker: ${worker.name}`);
            } else {
                console.log(`Worker exists: ${worker.name}`);
            }
        }

        console.log('Worker seeding complete.');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding workers:', error);
        process.exit(1);
    }
}

seedWorkers();
