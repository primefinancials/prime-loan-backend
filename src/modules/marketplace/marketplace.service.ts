import { Vendor, IVendor, VendorStatus } from './vendor.model';
import { Product, IProduct, ProductStatus } from './product.model';
import User from '../users/user.model';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../exceptions';
import { DatabaseService } from '../../shared/db';
import { EscrowTransaction } from '../escrow/escrow.model';

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

    static async listVendors(status?: VendorStatus, page = 1, limit = 20) {
        const query: any = {};
        if (status) query.status = status;

        const skip = (page - 1) * limit;

        const [vendors, total] = await Promise.all([
            Vendor.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Vendor.countDocuments(query)
        ]);

        return { data: vendors, total, page, pages: Math.ceil(total / limit) };
    }

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

        const product = await Product.create({
            vendorId: vendor._id,
            ...data,
            status: data.status || ProductStatus.DRAFT
        });
        return product;
    }

    static async updateProduct(productId: string, userId: string, data: Partial<IProduct>) {
        const vendor = await Vendor.findOne({ userId }); // Check ownership via vendor
        if (!vendor) throw new UnauthorizedError('Vendor profile not found');

        const product = await Product.findOne({ _id: productId, vendorId: vendor._id });
        if (!product) throw new NotFoundError('Product not found or unauthorized');

        Object.assign(product, data);
        return product.save();
    }

    static async deleteProduct(productId: string, userId: string) {
        const vendor = await Vendor.findOne({ userId });
        if (!vendor) throw new UnauthorizedError('Vendor profile not found');

        return Product.findOneAndDelete({ _id: productId, vendorId: vendor._id });
    }

    static async getProduct(productId: string) {
        return Product.findById(productId);
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
    }) {
        const { page = 1, limit = 20, search, category, vendorId, minPrice, maxPrice } = params;

        const query: any = { status: ProductStatus.ACTIVE };

        if (category) query.category = category;
        if (vendorId) query.vendorId = vendorId;

        if (minPrice !== undefined || maxPrice !== undefined) {
            query.price = {};
            if (minPrice !== undefined) query.price.$gte = minPrice;
            if (maxPrice !== undefined) query.price.$lte = maxPrice;
        }

        if (search) {
            query.$text = { $search: search };
        }

        const skip = (page - 1) * limit;

        const [products, total] = await Promise.all([
            Product.find(query)
                .sort(search ? { score: { $meta: 'textScore' } } : { createdAt: -1 }) // Sort by relevance if search, else new
                .skip(skip)
                .limit(limit),
            Product.countDocuments(query)
        ]);

        return { data: products, total, page, pages: Math.ceil(total / limit) };
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
        const [products, total] = await Promise.all([
            Product.find({ vendorId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Product.countDocuments({ vendorId })
        ]);
        return { data: products, total, page, pages: Math.ceil(total / limit) };
    }

    static async getAdminEscrows(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [escrows, total] = await Promise.all([
            EscrowTransaction.find({ type: 'marketplace' }).sort({ createdAt: -1 }).skip(skip).limit(limit),
            EscrowTransaction.countDocuments({ type: 'marketplace' })
        ]);
        return { data: escrows, total, page, pages: Math.ceil(total / limit) };
    }
}
