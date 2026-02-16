
import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { Vendor, VendorStatus } from '../modules/marketplace/vendor.model';
import { Product, ProductStatus } from '../modules/marketplace/product.model';
import { Order, OrderStatus } from '../modules/marketplace/order.model';
import { MarketplaceService } from '../modules/marketplace/marketplace.service';
import { DatabaseService } from '../shared/db';

async function verifyVendorAnalytics() {
    console.log("Starting verification...");

    // Connect to DB (assuming local or using env)
    // You might need to adjust connection string based on your environment
    const mongoUri = process.env.MONGO_URI || process.env.DB_URL || 'mongodb://localhost:27017/prime-loan-backend';
    console.log("Using Mongo URI:", mongoUri.replace(/\/\/.*@/, '//***@')); // Mask creds

    try {
        await mongoose.connect(mongoUri);
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("Connection Failed:", err);
        return;
    }

    try {
        // 1. Create Dummy Vendor
        const vendorId = new mongoose.Types.ObjectId();
        const vendor: any = await Vendor.create({
            _id: vendorId,
            userId: new mongoose.Types.ObjectId().toString(),
            businessName: `Test Vendor ${Date.now()}`,
            businessDescription: 'Test Description',
            status: VendorStatus.APPROVED,
            contactEmail: 'test@example.com',
            contactPhone: '1234567890'
        });
        console.log(`Created Vendor: ${(vendor as any)._id}`);

        // 2. Create Dummy Products
        const product1: any = await Product.create({
            vendorId: vendor._id.toString(),
            name: 'Product 1',
            description: 'Desc 1',
            price: 1000,
            stock: 10,
            category: 'Electronics',
            status: ProductStatus.ACTIVE
        });
        const product2: any = await Product.create({
            vendorId: vendor._id.toString(),
            name: 'Product 2',
            description: 'Desc 2',
            price: 2000,
            stock: 10,
            category: 'Electronics',
            status: ProductStatus.ACTIVE
        });
        console.log(`Created Products: ${(product1 as any)._id}, ${(product2 as any)._id}`);

        // 3. Create Dummy Orders
        // Order 1: 2x Product 1 (2000), 1x Product 2 (2000) = 4000. PAID.
        await Order.create({
            userId: new mongoose.Types.ObjectId().toString(),
            vendorId: (vendor as any)._id.toString(),
            items: [
                { productId: (product1 as any)._id.toString(), productName: 'P1', quantity: 2, price: 1000 },
                { productId: (product2 as any)._id.toString(), productName: 'P2', quantity: 1, price: 2000 }
            ],
            totalAmount: 4000,
            status: OrderStatus.PAID,
            shippingAddress: 'Test Address'
        });

        // Order 2: 1x Product 1 (1000). DELIVERED.
        await Order.create({
            userId: new mongoose.Types.ObjectId().toString(),
            vendorId: (vendor as any)._id.toString(),
            items: [
                { productId: (product1 as any)._id.toString(), productName: 'P1', quantity: 1, price: 1000 }
            ],
            totalAmount: 1000,
            status: OrderStatus.DELIVERED,
            shippingAddress: 'Test Address'
        });

        // Order 3: 1x Product 2 (2000). PENDING (Should not count).
        await Order.create({
            userId: new mongoose.Types.ObjectId().toString(),
            vendorId: (vendor as any)._id.toString(),
            items: [
                { productId: (product2 as any)._id.toString(), productName: 'P2', quantity: 1, price: 2000 }
            ],
            totalAmount: 2000,
            status: OrderStatus.PENDING,
            shippingAddress: 'Test Address'
        });

        console.log("Created Orders");

        // 4. Verify listVendors (Stats)
        const vendorList: any = await MarketplaceService.listVendors(VendorStatus.APPROVED);
        const listedVendor = vendorList.data.find((v: any) => v._id.toString() === (vendor as any)._id.toString());

        console.log("Vendor Stats from listVendors:", listedVendor.stats);
        if (listedVendor.stats.totalSales !== 2) throw new Error(`Expected 2 sales, got ${listedVendor.stats.totalSales}`);
        if (listedVendor.stats.totalRevenue !== 5000) throw new Error(`Expected 5000 revenue, got ${listedVendor.stats.totalRevenue}`);

        // 5. Verify getVendorDetails
        const vendorDetails: any = await MarketplaceService.getVendorDetails((vendor as any)._id.toString());
        console.log("Vendor Details Stats:", vendorDetails.stats);
        if (vendorDetails.stats.totalSales !== 2) throw new Error("Vendor Details totalSales mismatch");
        if (vendorDetails.stats.totalRevenue !== 5000) throw new Error("Vendor Details totalRevenue mismatch");

        // 6. Verify getProductsByVendor
        const productList: any = await MarketplaceService.getProductsByVendor((vendor as any)._id.toString());
        const p1 = productList.data.find((p: any) => p._id.toString() === (product1 as any)._id.toString());
        const p2 = productList.data.find((p: any) => p._id.toString() === (product2 as any)._id.toString());

        console.log("Product 1 Stats:", p1.stats);
        console.log("Product 2 Stats:", p2.stats);

        // P1: Order 1 (2 qty), Order 2 (1 qty) = 3 total
        // P1 Rev: 3 * 1000 = 3000
        if (p1.stats.unitsSold !== 3) throw new Error(`P1 unitsSold mismatch: Expected 3, got ${p1.stats.unitsSold}`);
        if (p1.stats.revenue !== 3000) throw new Error(`P1 revenue mismatch: Expected 3000, got ${p1.stats.revenue}`);

        // P2: Order 1 (1 qty). Order 3 is PENDING, so ignored.
        // P2 Rev: 1 * 2000 = 2000
        if (p2.stats.unitsSold !== 1) throw new Error(`P2 unitsSold mismatch: Expected 1, got ${p2.stats.unitsSold}`);
        if (p2.stats.revenue !== 2000) throw new Error(`P2 revenue mismatch: Expected 2000, got ${p2.stats.revenue}`);

        // 7. Verify listProducts (Vendor Population)
        const publicProducts: any = await MarketplaceService.listProducts({ vendorId: (vendor as any)._id.toString() });
        const pp1 = publicProducts.data.find((p: any) => p._id.toString() === (product1 as any)._id.toString());

        console.log("Public Product Vendor Info:", pp1.vendorId);
        if (typeof pp1.vendorId !== 'object' || (pp1.vendorId as any)._id.toString() !== (vendor as any)._id.toString()) {
            throw new Error("Vendor not populated correctly in listProducts");
        }
        if (!(pp1.vendorId as any).businessName) throw new Error("Vendor businessName missing in populated data");

        // 8. Verify getPublicVendorProfile
        const publicProfile: any = await MarketplaceService.getPublicVendorProfile((vendor as any)._id.toString());
        console.log("Public Vendor Profile Products Count:", publicProfile.products.length);

        if ((publicProfile as any)._id.toString() !== (vendor as any)._id.toString()) throw new Error("Public Profile vendor ID mismatch");
        if (!publicProfile.products) throw new Error("Public Profile products missing");

        // Should have 2 active products (product1 and product2)
        // Note: product1 and product2 were created with status ACTIVE
        if (publicProfile.products.length !== 2) throw new Error(`Expected 2 active products in public profile, got ${publicProfile.products.length}`);

        const pp_p1 = publicProfile.products.find((p: any) => p._id.toString() === (product1 as any)._id.toString());
        if (!pp_p1) throw new Error("Product 1 not found in public profile");

        console.log("✅ ALL CHECKS PASSED");

    } catch (error) {
        console.error("❌ Mismatch or Error:", error);
    } finally {
        // Cleanup?? Maybe manual cleanup if needed, but for now just close connection
        await mongoose.disconnect();
        console.log("Disconnected");
    }
}

verifyVendorAnalytics();
