const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: '/home/cypher/Documents/prime-loan-backend/.env' });

async function run() {
  try {
    const res = await axios.get('https://api.flutterwave.com/v3/bill-categories', {
      params: { country: 'NG', airtime: 1 },
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    console.log("Airtime categories count:", res.data.data.length);
    console.log("Sample airtime category:", res.data.data[0]);
    
    const resData = await axios.get('https://api.flutterwave.com/v3/bill-categories', {
      params: { country: 'NG', data_bundle: 1 },
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    console.log("Data categories count:", resData.data.data.length);
    console.log("Sample data category:", resData.data.data[0]);
  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
