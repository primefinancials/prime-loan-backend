
import { PayBetaProvider } from '../src/shared/providers/paybeta.provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function testPurchase() {
  const payBeta = new PayBetaProvider();
  const reference = `${Date.now()}`; // Numeric only
  const phone = '09113378646';
  const amount = 100;
  const service = 'airtel_vtu';

  console.log(`Initiating Test Purchase (Numeric Reference):`);
  console.log(`Phone: ${phone}`);
  console.log(`Amount: ${amount}`);
  console.log(`Service: ${service}`);
  console.log(`Reference: ${reference}`);

  try {
    const result = await payBeta.buyAirtime({
      service,
      phoneNumber: phone,
      amount,
      reference
    });
    console.log('Purchase Result:', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('Purchase Failed!');
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testPurchase();
