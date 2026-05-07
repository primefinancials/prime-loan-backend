import * as dotenv from 'dotenv';
dotenv.config();

import { VfdProvider } from '../src/shared/providers/vfd.provider';

async function run() {
    const vfd = new VfdProvider();

    try {
        console.log('--- Fetching Categories ---');
        const categories = await vfd.getBillerCategories();
        console.log('Categories:', JSON.stringify(categories, null, 2));

        if (categories.data && categories.data.length > 0) {
            for (const cat of categories.data) {
                const catId = cat.name || cat.id;
                console.log(`\n--- Fetching Billers/Items for Category: ${catId} ---`);
                try {
                    const items = await vfd.getBillerItems(catId);
                    console.log(`Items for ${catId}:`, JSON.stringify(items, null, 2));
                } catch (e: any) {
                    console.error(`Error fetching items for ${catId}:`, e.response?.data?.message || e.message);
                }
            }
        }
    } catch (e: any) {
        console.error('Error:', e.response?.data?.message || e.message);
    }
}

run().catch(console.error);
