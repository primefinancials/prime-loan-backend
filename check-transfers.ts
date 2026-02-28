import mongoose from 'mongoose';
import { DatabaseService } from './src/shared/db';
import { Transfer } from './src/modules/transfers/transfer.model';

async function run() {
    await DatabaseService.connect();
    const transfers = await Transfer.find({ remark: 'transaction Profit' }).sort({ createdAt: -1 }).limit(3).lean();
    console.log('--- RECENT TRANSFERS ---');
    for (const t of transfers) {
        console.log(t);
    }

    process.exit(0);
}

run().catch(console.error);
