const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: '/home/cypher/Documents/prime-loan-backend/.env' });

async function run() {
  try {
    const res = await axios.post('https://api.flutterwave.com/v3/bills', {
      country: 'NG',
      customer: '08030000000',
      amount: 100,
      type: 'AIRTIME', // Try data biller name? Or maybe type is the biller_name for data? Let's check documentation.
      biller_name: 'MTN 50 MB',
      reference: 'test-' + Date.now(),
    }, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    console.log("Success with data biller name:", res.data);
  } catch (e) {
    console.error("Error with data biller name:", e.response ? e.response.data : e.message);
  }
}
run();
