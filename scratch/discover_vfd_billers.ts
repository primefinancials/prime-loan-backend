
import { VfdProvider } from '../src/shared/providers/vfd.provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function discover() {
  const vfd = new VfdProvider();
  try {
    console.log("Fetching Categories...");
    const cats = await vfd.getBillerCategories();
    console.log("Categories:", JSON.stringify(cats, null, 2));

    if (cats.data) {
      for (const cat of cats.data) {
        console.log(`\nFetching items for category: ${cat.name} (${cat.id})`);
        const items = await vfd.getBillerItems(cat.id);
        console.log(`Items for ${cat.name}:`, JSON.stringify(items, null, 2));
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

discover();
