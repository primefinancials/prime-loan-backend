const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: '/home/cypher/Documents/prime-loan-backend/.env' });

async function run() {
  try {
    const res = await axios.get('https://api.flutterwave.com/v3/bill-categories', {
      params: { country: 'NG', airtime: 1 },
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    
    // Find MTN airtime
    const mtn = res.data.data.find(c => c.short_name.toLowerCase().includes('mtn'));
    console.log("MTN Category:", mtn);

  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
