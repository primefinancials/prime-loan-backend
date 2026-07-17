require('dotenv').config();
const axios = require('axios');

async function checkBanks() {
  try {
    const res = await axios.get('https://api.flutterwave.com/v3/banks/NG', {
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      }
    });
    const banks = res.data.data;
    console.log(banks.filter(b => b.name.toLowerCase().includes('kuda') || b.name.toLowerCase().includes('first')));
  } catch(e) {
    console.log(e.response ? e.response.data : e.message);
  }
}
checkBanks();
