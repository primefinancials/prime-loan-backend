
import { PayBetaProvider } from '../src/shared/providers/paybeta.provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function listProviders() {
  const payBeta = new PayBetaProvider();
  try {
    const providers = await payBeta.getAirtimeProviders();
    console.log('Airtime Providers:', JSON.stringify(providers, null, 2));
  } catch (error: any) {
    console.error('Error fetching providers:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

listProviders();
