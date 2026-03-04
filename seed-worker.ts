import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { SettingsService } from './src/modules/admin/settings.service';
import WorkerStatus from './src/modules/workers/worker-status.model';
import { LoanPenaltiesCron } from './src/workers/loans/penaltiesCron';

dotenv.config();

const DB_URL = process.env.DB_URL || 'mongodb://localhost:27017/prime-loan';

async function runReset() {
    try {
        await mongoose.connect(DB_URL);
        console.log('Connected to DB:', DB_URL);

        const settings = await SettingsService.getSettings();

        // Ensure map exists
        if (!settings.workersConfig) {
            settings.workersConfig = new mongoose.Types.Map();
        }

        // Set the explicit configuration
        settings.workersConfig.set('loan-penalties', {
            enabled: true,
            cronSchedule: '0 */12 * * *' // Enforce 12 hours fallback 
        });

        await settings.save();
        console.log('✅ Injected loan-penalties configuration into System Settings map.');

        const verify = await SettingsService.getSettings();
        console.log('Settings verification:', verify.workersConfig?.get('loan-penalties'));

    } catch (e) {
        console.log(e);
    } finally {
        await mongoose.disconnect();
    }
}

runReset();
