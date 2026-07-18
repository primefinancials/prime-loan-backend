
import "dotenv/config";
import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function run() {
  const payload = {
    amount: 5000000 * 100,
    type: "recurring-debit",
    method: "mandate",
    mandate_type: "emandate",
    debit_type: "variable",
    description: "Prime Loan Auto-Debit Mandate",
    reference: `MN${Date.now()}`,
    start_date: new Date().toISOString().split("T")[0],
    end_date: new Date(Date.now() + 5*365*24*60*60*1000).toISOString().split("T")[0],
    customer: {
      email: "test@example.com",
      name: "John Doe",
      phone: "08000000000",
      address: "Lagos, Nigeria",
      identity: { type: "bvn", number: "11111111111" }
    }
  };

  try {
    const response = await axios.post(
      "https://api.withmono.com/v2/payments/initiate",
      payload,
      {
        headers: {
          "mono-sec-key": process.env.MONO_SECRET_KEY,
          "Content-Type": "application/json"
        },
        httpsAgent
      }
    );
    console.log("Success:", JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error("Mono Validation Error:", JSON.stringify(error.response?.data, null, 2) || error.message);
  }
}

run();

