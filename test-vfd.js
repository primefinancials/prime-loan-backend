const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

const baseUrl = 'https://api-apps.vfdbank.systems/vtech-wallet/api/v1';
const customerKey = process.env.VFD_KEY || 'ab339d1ff04d9c02506e93eb5a8e03bc';
const customerSecret = process.env.VFD_SECRET || 'b4b1a43a6d71b8ab1778912e75e9275e';
const proxyUrl = 'http://107.23.194.31:3128';

async function generateToken() {
    const authUrl = `${baseUrl}/auth/b2b`;
    const password = crypto.createHash('sha512').update(customerSecret).digest('hex');
    const requestBody = { client_id: customerKey, password: password };
    const agent = new HttpsProxyAgent(proxyUrl);
    
    console.log("Generating token...");
    try {
        const response = await axios.post(authUrl, requestBody, { httpsAgent: agent });
        return response.data.data.access_token || response.data.access_token;
    } catch (e) {
        console.error("Token err:", e.response?.data || e.message);
        throw e;
    }
}

async function testVfd() {
    try {
        const token = await generateToken();
        console.log("Token generated:", token.substring(0, 10) + "...");
        
        const agent = new HttpsProxyAgent(proxyUrl);
        const headers = { 'AccessToken': token, 'Content-Type': 'application/json' };
        
        console.log("Fetching account 1042136275...");
        const res1 = await axios.get(`${baseUrl}/account/enquiry?accountNumber=1042136275`, { headers, httpsAgent: agent });
        console.log("Response 1:", JSON.stringify(res1.data, null, 2));

        console.log("Fetching without accountNumber...");
        const res2 = await axios.get(`${baseUrl}/account/enquiry`, { headers, httpsAgent: agent });
        console.log("Response 2:", JSON.stringify(res2.data, null, 2));

        console.log("Fetching beneficiary 1042136275...");
        const res3 = await axios.get(`${baseUrl}/transfer/recipient?accountNo=1042136275&bank=999999&transfer_type=intra`, { headers, httpsAgent: agent });
        console.log("Response 3:", JSON.stringify(res3.data, null, 2));

    } catch (e) {
        console.error("Test failed:", e.response?.data || e.message);
    }
}

testVfd();
