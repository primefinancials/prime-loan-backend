import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { generateBearerToken } from '../src/shared/utils/generateBearerToken';
import { customerKey, customerSecret } from '../src/config';

async function run() {
    const accessToken = await generateBearerToken(customerKey, customerSecret);
    const headers = {
        AccessToken: accessToken,
        "Content-Type": "application/json",
    };

    const urls = [
        "https://api-apps.vfdbank.systems/vtech-wallet/api/v2/wallet2",
        "https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore"
    ];

    for (const baseUrl of urls) {
        console.log(`\n=== Testing Base URL: ${baseUrl} ===`);
        try {
            console.log('Fetching Categories...');
            const response = await axios.get(`${baseUrl}/biller/categories`, { headers });
            console.log('Response Status:', response.status);
            console.log('Categories:', JSON.stringify(response.data, null, 2));

            if (response.data && response.data.data) {
                const firstCat = response.data.data[0];
                const catId = firstCat.name || firstCat.id;
                console.log(`Fetching items for first category: ${catId}`);
                const itemsRes = await axios.get(`${baseUrl}/biller/items?categoryId=${catId}`, { headers });
                console.log('Items:', JSON.stringify(itemsRes.data, null, 2));
            }
        } catch (e: any) {
            console.error(`Error with ${baseUrl}:`, e.response?.status, e.response?.data || e.message);
        }
    }
}

run().catch(console.error);
