const axios = require('axios');
const url = 'https://api.paybeta.ng';
const key = 'UEJfTElWRS1jNTQ0NWNkNmUzNDNjMDBlMzY1OTc2OTZm';
const headers = { 'P-API-KEY': key, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const testRoutes = [
  '/data-bundle/list',
  '/v1/data-bundle/list',
  '/api/v1/data-bundle/list',
  '/data/plans',
  '/api/v1/data/plans',
  '/api/v1/data/list',
  '/v2/data-bundle/list'
];

async function run() {
  for (const path of testRoutes) {
    try {
      const res = await axios.post(`${url}${path}`, { service: "mtn" }, { headers });
      console.log(`${path}: HTTP ${res.status}`);
    } catch (err) {
      console.log(`${path}: HTTP ${err.response ? err.response.status : err.message}`);
    }
  }
}
run();
