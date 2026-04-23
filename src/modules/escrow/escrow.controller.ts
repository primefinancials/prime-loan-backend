import { Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { EscrowService } from "./escrow.service";
import { validateReqBody } from "../../shared/middlewares";
import { SettingsService } from "../admin/settings.service";

export class EscrowController {

    /**
     * Create P2P Escrow
     */
    static async createP2P(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { sellerEmail, amount, description, expiryDays, referralCode } = req.body;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.createEscrow({
                buyerId: userId,
                sellerEmail,
                type: 'p2p',
                amount,
                description,
                inspectionPeriodDays: expiryDays,
                referralCode,
            });

            res.status(201).json({
                status: "success",
                message: "Escrow created and funds deducted",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Create Marketplace Escrow
     */
    static async createMarketplace(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { sellerId, items, amount, description, referralCode } = req.body;
            const userId = req.user!._id.toString();

            // Enrich items with Product details if available
            const enrichedItems = await Promise.all(items.map(async (item: any) => {
                if (item.productId) {
                    try {
                        const { Product } = await import('../marketplace/product.model');
                        const product = await Product.findById(item.productId);
                        if (product) {
                            return {
                                ...item,
                                name: item.name || product.name,
                                image: item.image || (product.images && product.images.length > 0 ? product.images[0] : undefined),
                                description: item.description || product.description
                            };
                        }
                    } catch (e) { }
                }
                return item;
            }));

            // Resolve Vendor userId to avoid "inviting" the seller if they are already a user
            let resolvedSellerId = sellerId;
            try {
                const { Vendor } = await import('../marketplace/vendor.model');
                const vendor = await Vendor.findById(sellerId);
                if (vendor && vendor.userId) {
                    resolvedSellerId = vendor.userId.toString();
                }
            } catch (e) {}

            const escrow = await EscrowService.createEscrow({
                buyerId: userId,
                sellerId: resolvedSellerId,
                type: 'marketplace',
                amount,
                description: description || "Marketplace Order",
                items: enrichedItems,
                referralCode,
            });

            res.status(201).json({
                status: "success",
                message: "Order placed and funds deducted",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Accept Escrow
     */
    static async acceptEscrow(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.acceptEscrow(id, userId);

            res.status(200).json({
                status: "success",
                message: "Escrow accepted",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Reject Escrow
     */
    static async rejectEscrow(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.rejectEscrow(id, userId, reason);

            res.status(200).json({
                status: "success",
                message: "Escrow rejected and funds refunded",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Cancel Escrow (Buyer)
     */
    static async cancelEscrow(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.cancelEscrow(id, userId);

            res.status(200).json({
                status: "success",
                message: "Escrow cancelled and funds refunded",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Confirm Delivery
     */
    static async confirmDelivery(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.confirmDelivery(id, userId);

            res.status(200).json({
                status: "success",
                message: "Delivery confirmed, funds released to seller",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * My Escrows
     */
    static async getMyEscrows(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const type = req.query.type as any;

            const escrows = await EscrowService.getMyEscrows(userId, type);

            res.status(200).json({
                status: "success",
                data: escrows
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Raise Dispute
     */
    static async raiseDispute(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.raiseDispute(id, userId, reason);

            res.status(200).json({
                status: "success",
                message: "Dispute raised",
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Admin: Resolve Dispute
     */
    static async resolveDispute(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { decision, note } = req.body;
            const adminId = req.admin!._id.toString();

            const escrow = await EscrowService.resolveDispute(id, adminId, decision, note);

            res.status(200).json({
                status: "success",
                message: `Dispute resolved: ${decision}`,
                data: escrow
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Admin: Get Escrow Statistics Widgets
     */
    static async adminGetEscrowStats(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const result = await EscrowService.getAdminEscrowStats();
            res.status(200).json({
                status: "success",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Admin: Get All Escrows
     */
    static async adminGetEscrows(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { page, limit, status, search } = req.query;

            const result = await EscrowService.getAllEscrows({
                page: page ? Number(page) : 1,
                limit: limit ? Number(limit) : 20,
                status: status as string,
                search: search as string
            });

            res.status(200).json({
                status: "success",
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get Escrow Fees for a given amount
     * Supports ?type=marketplace to include marketplace-specific fees (VAT etc.)
     */
    static async getEscrowFees(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const amount = Number(req.query.amount);
            if (!amount || amount <= 0) {
                return res.status(400).json({ status: 'error', message: 'A valid positive amount is required' });
            }

            const feeType = (req.query.type as string) || 'escrow';

            // Determine which categories to include
            const categories: ("escrow" | "marketplace")[] = feeType === 'marketplace'
                ? ['escrow', 'marketplace']
                : ['escrow'];

            const breakdown = await SettingsService.calculateFeeBreakdown(categories, 'send', amount);

            // Sum fees by category
            const escrowFee = breakdown
                .filter(b => b.category === 'escrow')
                .reduce((sum, b) => sum + b.fee, 0);
            const serviceFee = breakdown
                .filter(b => b.category === 'marketplace')
                .reduce((sum, b) => sum + b.fee, 0);
            const totalFees = escrowFee + serviceFee;

            res.status(200).json({
                status: 'success',
                data: {
                    amount,
                    escrowFee,
                    serviceFee,
                    feeBreakdown: breakdown,
                    total: amount + totalFees
                }
            });
        } catch (error) {
            next(error);
        }
    }
}
