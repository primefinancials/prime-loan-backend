import { Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { MarketplaceService } from "./marketplace.service";

export class MarketplaceController {

    /* =====================
       VENDOR ENDPOINTS
    ===================== */

    static async applyAsVendor(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const vendor = await MarketplaceService.applyAsVendor(userId, req.body);
            res.status(201).json({ status: "success", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async getMyVendorProfile(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const vendor = await MarketplaceService.getVendorProfile(userId);
            res.status(200).json({ status: "success", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async getVendorDetails(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const vendor = await MarketplaceService.getVendorDetails(id);
            res.status(200).json({ status: "success", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    // Admin
    static async listVendors(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { status, page, limit } = req.query;
            const result = await MarketplaceService.listVendors(status as any, Number(page), Number(limit));
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }

    static async approveVendor(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const adminId = req.admin!._id.toString();
            const vendor = await MarketplaceService.approveVendor(id, adminId);
            res.status(200).json({ status: "success", message: "Vendor approved", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async rejectVendor(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const adminId = req.admin!._id.toString();
            const vendor = await MarketplaceService.rejectVendor(id, adminId, reason);
            res.status(200).json({ status: "success", message: "Vendor rejected", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async suspendVendor(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const adminId = req.admin!._id.toString();
            const vendor = await MarketplaceService.suspendVendor(id, adminId, reason);
            res.status(200).json({ status: "success", message: "Vendor suspended", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async reactivateVendor(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const adminId = req.admin!._id.toString();
            const vendor = await MarketplaceService.reactivateVendor(id, adminId);
            res.status(200).json({ status: "success", message: "Vendor reactivated", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async getVendorProducts(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { page, limit } = req.query;
            const result = await MarketplaceService.getProductsByVendor(id, Number(page), Number(limit));
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }

    /* =====================
       PRODUCT ENDPOINTS
    ===================== */

    static async createProduct(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const product = await MarketplaceService.createProduct(userId, req.body);
            res.status(201).json({ status: "success", data: product });
        } catch (error) {
            next(error);
        }
    }

    static async updateProduct(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const { id } = req.params;
            const product = await MarketplaceService.updateProduct(id, userId, req.body);
            res.status(200).json({ status: "success", data: product });
        } catch (error) {
            next(error);
        }
    }

    static async deleteProduct(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const { id } = req.params;
            await MarketplaceService.deleteProduct(id, userId);
            res.status(200).json({ status: "success", message: "Product deleted" });
        } catch (error) {
            next(error);
        }
    }

    // Public/User
    static async listProducts(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const result = await MarketplaceService.listProducts({
                page: Number(req.query.page),
                limit: Number(req.query.limit),
                search: req.query.search as string,
                category: req.query.category as string,
                minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
                maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
                vendorId: req.query.vendorId as string,
                sortBy: req.query.sortBy as 'relevance' | 'newest' | 'price_asc' | 'price_desc'
            });
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }

    static async getProduct(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const product = await MarketplaceService.getProduct(id);
            if (!product) return res.status(404).json({ status: "failed", message: "Product not found" });
            res.status(200).json({ status: "success", data: product });
        } catch (error) {
            next(error);
        }
    }

    static async getPublicVendorProfile(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const result = await MarketplaceService.getPublicVendorProfile(id);
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }

    // Reviews
    static async addReview(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const { vendorId, rating, comment, productId } = req.body;
            const review = await MarketplaceService.addReview(userId, vendorId, rating, comment, productId);
            res.status(201).json({ status: "success", data: review });
        } catch (error) {
            next(error);
        }
    }

    static async getVendorReviews(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params; // Vendor ID
            const { page, limit } = req.query;
            const result = await MarketplaceService.getReviews(id, Number(page), Number(limit));
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }

    // Admin Escrows
    static async getAdminEscrows(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { page, limit } = req.query;
            const result = await MarketplaceService.getAdminEscrows(Number(page), Number(limit));
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }

    static async updateVendor(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const { id } = req.params;
            const vendor = await MarketplaceService.updateVendor(userId, id, req.body);
            res.status(200).json({ status: "success", data: vendor });
        } catch (error) {
            next(error);
        }
    }

    static async getVendorEscrows(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const { id } = req.params;
            const { page, limit } = req.query;
            const result = await MarketplaceService.getVendorEscrows(userId, id, Number(page), Number(limit));
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            next(error);
        }
    }
}
