
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore';
const AUTH_URL = 'https://api-apps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token';

async function getToken() {
    const payload = {
        consumerKey: process.env.CUSTOMER_KEY,
        consumerSecret: process.env.CUSTOMER_SECRET,
        validityTime: "-1"
    };
    const res = await axios.post(AUTH_URL, payload);
    return res.data.access_token || res.data.data?.access_token;
}

async function test() {
    try {
        const token = await getToken();
        console.log(`\n--- Inspecting Biller List for Airtime ---`);
        const headers = { 
            Authorization: `Bearer ${token}`,
            AccessToken: token
        };
        const url = `${BASE_URL}/billerList?categoryName=Airtime`;
        const res = await axios.get(url, { headers });
        console.log('Biller List:', JSON.stringify(res.data, null, 2));
        
        const biller = (res.data.data?.billers || res.data.data)?.[0];
        if (biller) {
            console.log('\n--- Inspecting Items for first biller ---');
            const itemsUrl = `${BASE_URL}/billerItems?billerId=${biller.id}&divisionId=${biller.division}&productId=${biller.product}`;
            const itemsRes = await axios.get(itemsUrl, { headers });
            console.log('Items Response:', JSON.stringify(itemsRes.data, null, 2));
        }
    } catch (e) {
        console.log('Failed:', e.response?.status, JSON.stringify(e.response?.data, null, 2) || e.message);
    }
}

test();
