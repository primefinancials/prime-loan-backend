
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

async function test() {
    try {
        const token = await getToken();
        console.log(`\n--- Testing vtech-bills with AccessToken header ---`);
        const url = `${BASE_URL}/billercategory`;
        const res = await axios.get(url, { headers: { AccessToken: token } });
        console.log('Response:', JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.log('Failed:', e.response?.status, JSON.stringify(e.response?.data, null, 2) || e.message);
    }
}

test();
