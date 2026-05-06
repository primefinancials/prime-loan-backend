
import { PayBetaProvider } from '../src/shared/providers/paybeta.provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function queryTxn() {
  const payBeta = new PayBetaProvider();
  const reference = 'TEST_PB_1778055682939';
  try {
    const result = await payBeta.queryTransaction(reference);
    console.log('Query Result:', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('Query Failed:', error.message);
  }
}

queryTxn();
