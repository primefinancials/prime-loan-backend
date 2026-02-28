import * as dotenv from 'dotenv';
dotenv.config();

import { VfdProvider } from './src/shared/providers/vfd.provider';

async function run() {
    const vfd = new VfdProvider();

    const references = ['TXN_6989AED6', 'TXN_DCA5EBDF'];

    for (const ref of references) {
        try {
            console.log(`Querying ${ref}...`);
            const status = await vfd.queryTransaction(ref);
            console.log('Result:', JSON.stringify(status, null, 2));
        } catch (e: any) {
            console.error(`Error querying ${ref}:`, e.response?.data?.message || e.message);
        }
    }
}

run().catch(console.error);
