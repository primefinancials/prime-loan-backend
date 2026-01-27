
import mongoose from 'mongoose';
import { MarketplaceService } from './src/modules/marketplace/marketplace.service';
import { Product } from './src/modules/marketplace/product.model';
import { Vendor } from './src/modules/marketplace/vendor.model';

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/prime-loan-backend');
        console.log('Connected to DB');

        // create temp vendor
        const vendor = await Vendor.create({ userId: new mongoose.Types.ObjectId(), businessName: "TempVendor", description: "desc", status: "APPROVED", address: "addr", phone: "123" });
        await Product.create({ vendorId: vendor._id, name: "P1", description: "d", price: 100, stock: 10, category: "c" });

        const result = await MarketplaceService.getProductsByVendor(vendor._id.toString());
        console.log('Result type:', typeof result);
        console.log('Result keys:', Object.keys(result));
        console.log('Is array?', Array.isArray(result));

        // clean up
        await Product.deleteMany({ vendorId: vendor._id });
        await Vendor.findByIdAndDelete(vendor._id);

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

run();
