
import { PayBetaProvider } from '../src/shared/providers/paybeta.provider';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
dotenv.config();

async function testPurchase() {
  const payBeta = new PayBetaProvider();
  const reference = `TEST_PB_${Date.now()}`;
  const phone = '09113378646';
  const amount = 100;
  const service = 'airtel_vtu';

  console.log(`Initiating Test Purchase:`);
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
    } else if (error.status) {
      console.error('Custom Status:', error.status);
    }
    
    // In our provider, we catch error and re-throw with message.
    // Let's see if we can get more details.
  }
}

testPurchase();
