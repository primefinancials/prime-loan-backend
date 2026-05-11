
const axios = require('axios');
require('dotenv').config();

// Testing both prefixes
const PREFIXES = [
    'https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore',
    'https://api-apps.vfdbank.systems/vtech-wallet/api/v2/billspaymentstore'
];

async function getToken() {
    const authUrl = 'https://api-apps.vfdbank.systems/baasauth/token';
    const payload = {
        customer_key: process.env.VFD_CUSTOMER_KEY,
        customer_secret: process.env.VFD_CUSTOMER_SECRET
    };
    const res = await axios.post(authUrl, payload);
    return res.data.access_token;
}

async function test() {
    try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };
        
        for (const base of PREFIXES) {
            console.log(`\n--- Testing Base: ${base} ---`);
            try {
                const url = `${base}/billercategory`;
                const res = await axios.get(url, { headers });
                console.log('Success!', res.data.status, (res.data.data?.categories || res.data.data)?.length, 'categories');
            } catch (e) {
                console.log('Failed:', e.response?.status, e.response?.data?.message || e.message);
            }
        }
    } catch (e) {
        console.error('Auth Error:', e.message);
    }
}

test();
