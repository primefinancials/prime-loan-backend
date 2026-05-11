
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore';
const AUTH_URL = 'https://api-apps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token';

async function getToken() {
    const payload = {
        consumerKey: process.env.VFD_CUSTOMER_KEY,
        consumerSecret: process.env.VFD_CUSTOMER_SECRET,
        validityTime: "-1"
    };
    const res = await axios.post(AUTH_URL, payload);
    return res.data.access_token || res.data.data?.access_token;
}

async function test() {
    try {
        const token = await getToken();
        console.log(`\n--- Testing with CORRECT AUTH_URL and vtech-bills ---`);
        const headers = { Authorization: `Bearer ${token}` };
        const url = `${BASE_URL}/billercategory`;
        const res = await axios.get(url, { headers });
        console.log('Response:', JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.log('Failed:', e.response?.status, JSON.stringify(e.response?.data, null, 2) || e.message);
    }
}

test();
