import { Vendor, IVendor, VendorStatus } from './vendor.model';
import { Product, IProduct, ProductStatus } from './product.model';
import User from '../users/user.model';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../exceptions';
import { DatabaseService } from '../../shared/db';
import { EscrowTransaction } from '../escrow/escrow.model';
import { Order, OrderStatus } from './order.model';
import { SettingsService } from '../admin/settings.service';

export class MarketplaceService {
    /* =========================================
       VENDOR MANAGEMENT
    ========================================= */

    /**
     * Apply to become a vendor
     */
    static async applyAsVendor(userId: string, data: Partial<IVendor>) {
        const existing = await Vendor.findOne({ userId });
        if (existing) {
            if (existing.status === VendorStatus.PENDING) throw new BadRequestError('Application already pending');
            if (existing.status === VendorStatus.APPROVED) throw new BadRequestError('Already a vendor');
            // If rejected, allow re-application logic? Or update existing?
            // For simplicity, allow update if rejected
            if (existing.status === VendorStatus.REJECTED) {
                existing.status = VendorStatus.PENDING;
                existing.rejectionReason = undefined;
                Object.assign(existing, data);
                return existing.save();
            }
        }

        const vendor = await Vendor.create({
            userId,
            ...data,
            status: VendorStatus.PENDING
        });
        return vendor;
    }

    static async getVendorProfile(userId: string) {
        return Vendor.findOne({ userId });
    }

    static async approveVendor(vendorId: string, adminId: string) {
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) throw new NotFoundError('Vendor not found');

        vendor.status = VendorStatus.APPROVED;
        vendor.approvedBy = adminId;
        vendor.rejectionReason = undefined;
        return vendor.save();
    }

    static async rejectVendor(vendorId: string, adminId: string, reason: string) {
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) throw new NotFoundError('Vendor not found');

        vendor.status = VendorStatus.REJECTED;
        vendor.rejectionReason = reason;
        return vendor.save();
    }

    static async suspendVendor(vendorId: string, adminId: string, reason: string) {
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) throw new NotFoundError('Vendor not found');

        vendor.status = VendorStatus.SUSPENDED;
        vendor.deactivationReason = reason;
        return vendor.save();
    }

    static async reactivateVendor(vendorId: string, adminId: string) {
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) throw new NotFoundError('Vendor not found');

        vendor.status = VendorStatus.APPROVED;
        vendor.deactivationReason = undefined;
        return vendor.save();
    }

    static async listVendors(status?: VendorStatus, page = 1, limit = 20) {
        const query: any = {};
        if (status) query.status = status;

        const skip = (page - 1) * limit;

        const [vendors, total] = await Promise.all([
            Vendor.find(query).lean().sort({ createdAt: -1 }).skip(skip).limit(limit),
            Vendor.countDocuments(query)
        ]);

        // Aggregate stats for these vendors
        const vendorIds = vendors.map(v => v._id.toString());

        const stats = await Order.aggregate([
            {
                $match: {
                    vendorId: { $in: vendorIds },
                    status: { $in: [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED] }
                }
            },
            {
                $group: {
                    _id: "$vendorId",
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: "$totalAmount" }
                }
            }
        ]);

        const statsMap = stats.reduce((acc, curr) => {
            acc[curr._id] = curr;
            return acc;
        }, {} as any);

        const data = vendors.map(vendor => ({
            ...vendor,
            stats: {
                totalSales: statsMap[vendor._id.toString()]?.totalSales || 0,
                totalRevenue: statsMap[vendor._id.toString()]?.totalRevenue || 0
            }
        }));

        return { data, total, page, pages: Math.ceil(total / limit) };
    }

    /**
     * Get Detailed Vendor Profile for Admin
     */
    static async getVendorDetails(vendorId: string) {
        const vendor = await Vendor.findById(vendorId).lean();
        if (!vendor) throw new NotFoundError('Vendor not found');

        // Get aggregate stats
        const stats = await Order.aggregate([
            {
                $match: {
                    vendorId: vendorId,
                    status: { $in: [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: "$totalAmount" }
                }
            }
        ]);

        const totalSales = stats[0]?.totalSales || 0;
        const totalRevenue = stats[0]?.totalRevenue || 0;

        return {
            ...vendor,
            stats: {
                totalSales,
                totalRevenue,
                netRevenue: totalRevenue // Assuming net = gross for now as per plan
            }
        };
    }

    /* =========================================
       PRODUCT MANAGEMENT
    ========================================= */

    /* =========================================
       PRODUCT MANAGEMENT
    ========================================= */

    /**
     * Create Product
     * Checks if user is an Approved Vendor first
     */
    static async createProduct(userId: string, data: Partial<IProduct>) {
        const vendor = await Vendor.findOne({ userId, status: VendorStatus.APPROVED });
        if (!vendor) throw new UnauthorizedError('User is not an approved vendor');

        // Validate description
        if (!data.description || data.description.trim().length === 0) {
            throw new BadRequestError('Product description is required');
        }
        const wordCount = data.description.trim().split(/\s+/).length;
        if (wordCount > 200) {
            throw new BadRequestError(`Product description must be 200 words or less (currently ${wordCount} words)`);
        }

        const product = await Product.create({
            vendorId: vendor._id,
            ...data,
            status: data.status || ProductStatus.ACTIVE // Default to ACTIVE for visibility
        });
        return product;
    }

    static async updateVendor(userId: string, vendorId: string, data: Partial<IVendor>) {
        const vendor = await Vendor.findOne({ _id: vendorId, userId });
        if (!vendor) throw new NotFoundError('Vendor not found or unauthorized');

        // Prevent status update via this endpoint if needed, or allow everything
        // For now, allow updating business details
        if (data.businessName) vendor.businessName = data.businessName;
        if (data.businessDescription) vendor.businessDescription = data.businessDescription;
        if (data.address) vendor.address = data.address;
        if (data.contactPhone) vendor.contactPhone = data.contactPhone;
        if (data.logistics) vendor.logistics = data.logistics; // Allow logistics update
        // Add other fields as necessary

        return vendor.save();
    }

    static async updateProduct(productId: string, userId: string, data: Partial<IProduct>) {
        const vendor = await Vendor.findOne({ userId }); // Check ownership via vendor
        if (!vendor) throw new UnauthorizedError('Vendor profile not found');

        const product = await Product.findOne({ _id: productId, vendorId: vendor._id });
        if (!product) throw new NotFoundError('Product not found or unauthorized');

        // Validate description if provided
        if (data.description !== undefined) {
            if (data.description.trim().length === 0) {
                throw new BadRequestError('Product description cannot be empty');
            }
            const wordCount = data.description.trim().split(/\s+/).length;
            if (wordCount > 200) {
                throw new BadRequestError(`Product description must be 200 words or less (currently ${wordCount} words)`);
            }
        }

        Object.assign(product, data);
        return product.save();
    }

    static async deleteProduct(productId: string, userId: string) {
        const vendor = await Vendor.findOne({ userId });
        if (!vendor) throw new UnauthorizedError('Vendor profile not found');

        return Product.findOneAndDelete({ _id: productId, vendorId: vendor._id });
    }

    static async getProduct(productId: string, viewerId?: string) {
        const product = await Product.findById(productId).lean();
        if (!product) return null;

        const vendor = await Vendor.findById(product.vendorId).lean();

        let isOwner = false;
        if (viewerId && vendor && vendor.userId === viewerId) {
            isOwner = true;
        }

        // Calculate escrow/service fee from settings
        let escrowFee = 0;
        try {
            escrowFee = await SettingsService.calculateProfit('escrow', 'send', product.price);
        } catch (e) {
            // If no profit config exists, fee remains 0
        }

        return {
            ...product,
            vendorId: vendor || { _id: product.vendorId, businessName: 'Unknown Vendor' },
            isOwner,
            escrowFee,
            serviceFee: escrowFee
        };
    }

    /**
     * Public Product Listing (Search & Filter)
     */
    static async listProducts(params: {
        page?: number;
        limit?: number;
        search?: string;
        category?: string;
        vendorId?: string;
        minPrice?: number;
        maxPrice?: number;
        sortBy?: 'relevance' | 'newest' | 'price_asc' | 'price_desc';
        viewerId?: string;
    }) {
        const { page = 1, limit = 20, search, category, vendorId, minPrice, maxPrice, sortBy = 'newest', viewerId } = params;

        const query: any = { status: ProductStatus.ACTIVE };

        if (category) query.category = category;
        if (vendorId) query.vendorId = vendorId;

        if (minPrice !== undefined || maxPrice !== undefined) {
            query.price = {};
            if (minPrice !== undefined) query.price.$gte = minPrice;
            if (maxPrice !== undefined) query.price.$lte = maxPrice;
        }

        let sort: any = { createdAt: -1 };

        if (search) {
            // Basic text search if index exists, else Regex
            // Use regex for partial matches if search is short or text index not robust
            // Optimization: Search 'name' and 'description'
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
            // If we used $text, we'd use { score: { $meta: "textScore" } } for sort. 
            // But for smaller catalogs, RegEx is often 'fuzzier' and easier to control without index setup issues. 
            // We stick to simple Regex for robustness unless catalog is huge.
        }

        // Sorting Logic
        if (sortBy === 'price_asc') sort = { price: 1 };
        else if (sortBy === 'price_desc') sort = { price: -1 };
        else if (sortBy === 'newest') sort = { createdAt: -1 };
        // Relevance is default if search exists but we aren't using strict text score here.

        const skip = (page - 1) * limit;

        const [products, total] = await Promise.all([
            Product.find(query)
                .lean()
                .sort(sort)
                .skip(skip)
                .limit(limit),
            Product.countDocuments(query)
        ]);

        // Populate Vendor Details manually
        const vendorIds = [...new Set(products.map(p => p.vendorId))];
        const vendors = await Vendor.find({ _id: { $in: vendorIds } }).lean();
        const vendorMap = vendors.reduce((acc, v) => {
            acc[v._id.toString()] = v;
            return acc;
        }, {} as any);

        // Calculate fees for each product
        const feeCache: Map<number, number> = new Map();
        const calculateFee = async (price: number): Promise<number> => {
            if (feeCache.has(price)) return feeCache.get(price)!;
            try {
                const fee = await SettingsService.calculateProfit('escrow', 'send', price);
                feeCache.set(price, fee);
                return fee;
            } catch {
                return 0;
            }
        };

        const data = await Promise.all(products.map(async product => {
            const escrowFee = await calculateFee(product.price);
            return {
                ...product,
                vendorId: vendorMap[product.vendorId] || { _id: product.vendorId, businessName: 'Unknown Vendor' },
                isOwner: params.vendorId && vendorMap[product.vendorId]?.userId === params.vendorId
                    ? true : (params.viewerId && vendorMap[product.vendorId]?.userId === params.viewerId),
                escrowFee,
                serviceFee: escrowFee
            };
        }));

        return { data, total, page, pages: Math.ceil(total / limit) };
    }

    /* =========================================
       REVIEW MANAGEMENT
    ========================================= */

    static async addReview(userId: string, vendorId: string, rating: number, comment: string, productId?: string) {
        if (rating < 1 || rating > 5) throw new BadRequestError('Rating must be between 1 and 5');

        // Check if vendor exists
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) throw new NotFoundError('Vendor not found');

        // Create review
        const review = await import('./review.model').then(m => m.Review.create({
            userId,
            vendorId,
            productId,
            rating,
            comment
        }));

        // Recalculate Vendor Rating
        const result = await import('./review.model').then(m => m.Review.aggregate([
            { $match: { vendorId } },
            { $group: { _id: '$vendorId', avg: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]));

        if (result.length > 0) {
            vendor.avgRating = parseFloat(result[0].avg.toFixed(1)); // round to 1 decimal
            vendor.reviewCount = result[0].count;
            await vendor.save();
        }

        return review;
    }

    static async getReviews(vendorId: string, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const Review = (await import('./review.model')).Review;

        const [reviews, total] = await Promise.all([
            Review.find({ vendorId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Review.countDocuments({ vendorId })
        ]);

        return { data: reviews, total, page, pages: Math.ceil(total / limit) };
    }

    // Admin Helper
    static async getProductsByVendor(vendorId: string, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        // NOTE: This returns ALL products (Active, Draft, etc) for the vendor dashboard
        const [products, total] = await Promise.all([
            Product.find({ vendorId }).lean().sort({ createdAt: -1 }).skip(skip).limit(limit),
            Product.countDocuments({ vendorId })
        ]);

        // Aggregate product stats from orders
        const productIds = products.map(p => p._id.toString());

        const stats = await Order.aggregate([
            {
                $match: {
                    status: { $in: [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
                    "items.productId": { $in: productIds }
                }
            },
            { $unwind: "$items" },
            {
                $match: {
                    "items.productId": { $in: productIds }
                }
            },
            {
                $group: {
                    _id: "$items.productId",
                    unitsSold: { $sum: "$items.quantity" },
                    revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } }
                }
            }
        ]);

        const statsMap = stats.reduce((acc, curr) => {
            acc[curr._id] = curr;
            return acc;
        }, {} as any);

        const data = products.map(product => ({
            ...product,
            stats: {
                unitsSold: statsMap[product._id.toString()]?.unitsSold || 0,
                revenue: statsMap[product._id.toString()]?.revenue || 0
            }
        }));

        return { data, total, page, pages: Math.ceil(total / limit) };
    }

    static async getAdminEscrows(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [escrows, total] = await Promise.all([
            EscrowTransaction.find({ type: 'marketplace' }).sort({ createdAt: -1 }).skip(skip).limit(limit),
            EscrowTransaction.countDocuments({ type: 'marketplace' })
        ]);
        return { data: escrows, total, page, pages: Math.ceil(total / limit) };
    }

    static async getVendorEscrows(userId: string, vendorId: string, page = 1, limit = 20) {
        // First verify the user owns the vendor profile
        const vendor = await Vendor.findOne({ _id: vendorId, userId });
        if (!vendor) throw new NotFoundError('Vendor not found or unauthorized');

        // Find escrows where sellerEmail matches user email?
        // Or better: EscrowTransaction should ideally save vendorId or sellerId (userId).
        // Current Escrow model might rely on email or userId. Let's check Escrow model.
        // Assuming EscrowTransaction has 'sellerId' or we need to look up by email.
        // For accurate linking, let's look up the User to get their email, then query Escrow.

        const user = await User.findById(userId);
        if (!user) throw new NotFoundError('User not found');

        const skip = (page - 1) * limit;
        const query = {
            type: 'marketplace',
            $or: [{ seller: user.email }, { sellerId: userId }] // Handle both potential fields
        };

        const [escrows, total] = await Promise.all([
            EscrowTransaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
            EscrowTransaction.countDocuments(query)
        ]);
        return { data: escrows, total, page, pages: Math.ceil(total / limit) };
    }

    static async getPublicVendorProfile(vendorId: string) {
        const vendor = await Vendor.findById(vendorId).lean();
        if (!vendor) throw new NotFoundError('Vendor not found');

        // Only return active products for public view
        const products = await Product.find({
            vendorId: vendorId,
            status: ProductStatus.ACTIVE
        }).lean().sort({ createdAt: -1 });

        return {
            ...vendor,
            products
        };
    }
}
