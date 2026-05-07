
const axios = require('axios');

const authUrl = "https://api-apps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token";
const baseUrl = "https://api-apps.vfdbank.systems/vtech-wallet/api/v2/wallet2";
const customerKey = "fRUTNmaQ85BCoo2YKslv0QqjiBF6";
const customerSecret = "tOkY1cVVOBMYqcBlzhATnqs73kYs";

async function run() {
  try {
    console.log("Generating Token...");
    const authRes = await axios.post(authUrl, {
      consumerKey: customerKey,
      consumerSecret: customerSecret,
      validityTime: "-1"
    });

    const token = authRes.data?.data?.access_token || authRes.data?.access_token;
    if (!token) {
      console.log("Auth Response:", authRes.data);
      return;
    }

    const headers = {
      AccessToken: token,
      "Content-Type": "application/json"
    };

    console.log("\nFetching Biller Categories...");
    const catRes = await axios.get(`${baseUrl}/biller/categories`, { headers });
    console.log("Status:", catRes.status);
    console.log("Data Type:", typeof catRes.data);
    console.log("Data:", catRes.data);

    if (Array.isArray(catRes.data?.data)) {
        for (const cat of catRes.data.data) {
            console.log(`\n--- Items for Category: ${cat.name} (${cat.id}) ---`);
            const itemRes = await axios.get(`${baseUrl}/biller/items?categoryId=${cat.id}`, { headers });
            console.log(itemRes.data);
        }
    }

  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

run();
