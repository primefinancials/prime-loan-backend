const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: '/home/cypher/Documents/prime-loan-backend/.env' });

async function run() {
  try {
    const res = await axios.post('https://api.flutterwave.com/v3/bills', {
      country: 'NG',
      customer: '08030000000',
      amount: 100,
      type: 'AIRTIME', 
      reference: 'test-' + Date.now(),
      biller_name: 'MTN VTU' // Maybe this works?
    }, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    console.log("Success with type=AIRTIME and biller_name=MTN VTU:", res.data);
  } catch (e) {
    console.error("Error with type=AIRTIME:", e.response ? e.response.data : e.message);
  }
}
run();
