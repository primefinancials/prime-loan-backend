
import { PayBetaProvider } from '../src/shared/providers/paybeta.provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkBalance() {
  const payBeta = new PayBetaProvider();
  try {
    const balance = await payBeta.getWalletBalance();
    console.log('PayBeta Wallet Balance:', JSON.stringify(balance, null, 2));
  } catch (error: any) {
    console.error('Error fetching balance:', error.message);
  }
}

checkBalance();
