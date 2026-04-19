const axios = require('axios');
const url = 'https://api.paybeta.ng/v2';
const key = 'UEJfTElWRS1jNTQ0NWNkNmUzNDNjMDBlMzY1OTc2OTZm';
const headers = { 'P-API-KEY': key, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function run() {
  try {
    const res3 = await axios.post(`${url}/data-bundle/list`, { service: 'mtn' }, { headers });
    console.log(`/v2/data-bundle/list: ${res3.status}`);
  } catch(e) { console.log(`/v2/data-bundle/list: ${e.response?.status} - ${JSON.stringify(e.response?.data)}`); }
}
run();
