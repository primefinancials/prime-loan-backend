const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: '/home/cypher/Documents/prime-loan-backend/.env' });

async function run() {
  try {
    const res = await axios.post('https://api.flutterwave.com/v3/bills', {
      country: 'NG',
      customer: '08030000000',
      amount: 2500, // Matching the data plan
      type: '4GB + 2GB Youtube Night + 200MB (YT, IG & Tiktok)', // The biller_name for the data plan
      reference: 'test-' + Date.now(),
    }, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    console.log("Success with type=data biller_name:", res.data);
  } catch (e) {
    console.error("Error with type=data biller_name:", e.response ? e.response.data : e.message);
  }
}
run();
