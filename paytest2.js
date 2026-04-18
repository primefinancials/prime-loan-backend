const axios = require('axios');
const url = 'https://api.paybeta.ng/v2';
const url1 = 'https://api.paybeta.ng';
const key = 'UEJfTElWRS1jNTQ0NWNkNmUzNDNjMDBlMzY1OTc2OTZm';
const headers = { 'P-API-KEY': key, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function run() {
  try {
    const res1 = await axios.get(`${url1}/airtime/providers`, { headers });
    console.log(`/airtime/providers V1: ${res1.status}`);
  } catch(e) { console.log(`/airtime/providers V1: ${e.response?.status}`); }
  try {
    const res2 = await axios.get(`${url}/airtime/providers`, { headers });
    console.log(`/airtime/providers V2: ${res2.status}`);
  } catch(e) { console.log(`/airtime/providers V2: ${e.response?.status}`); }
  
  try {
    const res3 = await axios.post(`${url}/data-bundle/list`, { provider: 'mtn' }, { headers });
    console.log(`/v2/data-bundle/list: ${res3.status}`);
  } catch(e) { console.log(`/v2/data-bundle/list: ${e.response?.status} - ${JSON.stringify(e.response?.data)}`); }
}
run();
