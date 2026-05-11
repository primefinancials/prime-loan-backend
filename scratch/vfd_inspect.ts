
import { VfdProvider } from './src/shared/providers/vfd.provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function inspect() {
  const vfd = new VfdProvider();
  
  const categories = ['Airtime', 'Data', 'Cable TV', 'Utility', 'Betting', 'Internet Subscription'];
  
  for (const cat of categories) {
    console.log(`\n--- INSPECTING CATEGORY: ${cat} ---`);
    try {
      const res = await vfd.getBillerList(cat);
      console.log(`Status: ${res.status}`);
      const body = (vfd as any).unwrapBody ? (vfd as any).unwrapBody(res) : res;
      
      if (body.data) {
        const raw = Array.isArray(body.data) ? body.data : (body.data.billers || body.data.categories || body.data);
        const sample = Array.isArray(raw) ? raw[0] : raw;
        
        console.log('Biller Sample:', JSON.stringify(sample, null, 2));
        
        if (sample) {
          const bId = sample.id || sample.billerId || sample.code;
          const dId = sample.division || sample.divisionId;
          const pId = sample.product || sample.productId;
          
          console.log(`Attempting items discovery for ${sample.name} using billerId=${bId}, divisionId=${dId}, productId=${pId}`);
          const itemsRes = await vfd.getBillerItems(bId, dId, pId);
          const itemsBody = (vfd as any).unwrapBody ? (vfd as any).unwrapBody(itemsRes) : itemsRes;
          console.log(`Items Status: ${itemsBody.status}`);
          console.log('Items Data Sample:', JSON.stringify(itemsBody.data?.paymentitems?.[0] || itemsBody.data?.[0] || itemsBody.data, null, 2));
        }
      } else {
         console.log('No data returned for category:', cat, JSON.stringify(body));
      }
    } catch (e: any) {
      console.error(`Error inspecting ${cat}:`, e.message);
    }
  }
}

inspect();
