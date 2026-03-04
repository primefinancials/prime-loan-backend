import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { SettingsService } from './src/modules/admin/settings.service';
import WorkerStatus from './src/modules/workers/worker-status.model';

dotenv.config();

const DB_URL = process.env.DB_URL || 'mongodb://localhost:27017/prime-loan';

async function runCheck() {
    try {
        await mongoose.connect(DB_URL);
        console.log('Connected to DB:', DB_URL);

        const settings = await SettingsService.getSettings();
        const workersConfig = settings.workersConfig as any;

        let loanConfig = 'NOT FOUND';
        if (workersConfig && typeof workersConfig.get === 'function' && workersConfig.has('loan-penalties')) {
            loanConfig = workersConfig.get('loan-penalties');
        }

        console.log('--- SYSTEM SETTINGS: loan-penalties ---');
        console.log(loanConfig);

        console.log('\n--- WORKER STATUS TICKETS ---');
        const statuses = await WorkerStatus.find({ workerName: 'loan-penalties' });
        console.log(statuses);

    } catch (e) {
        console.log(e);
    } finally {
        await mongoose.disconnect();
    }
}

runCheck();
