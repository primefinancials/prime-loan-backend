
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore';

async function getToken() {
    const authUrl = 'https://api-apps.vfdbank.systems/baasauth/token';
    const payload = {
        customer_key: process.env.VFD_CUSTOMER_KEY,
        customer_secret: process.env.VFD_CUSTOMER_SECRET
    };
    const res = await axios.post(authUrl, payload);
    return res.data.access_token;
}

async function inspect() {
    try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };
        
        const categories = ['Airtime', 'Data', 'Cable TV', 'Utility', 'Betting', 'Internet Subscription'];
        
        for (const cat of categories) {
            console.log(`\n--- ${cat} ---`);
            const listUrl = `${BASE_URL}/billerList?categoryName=${encodeURIComponent(cat)}`;
            const listRes = await axios.get(listUrl, { headers });
            
            console.log('List Raw:', JSON.stringify(listRes.data, null, 2));
        }
    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
}

inspect();
