import { Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { EscrowService } from "./escrow.service";
import { validateReqBody } from "../../shared/middlewares"; // Assuming you have validation schemas or usage pattern

export class EscrowController {

    /**
     * Create P2P Escrow
     */
    static async createP2P(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const { sellerEmail, amount, description, expiryDays } = req.body;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.createEscrow({
                buyerId: userId,
                sellerEmail,
                type: 'p2p',
                amount,
                description,
                expiryDays
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
            const { sellerId, items, amount, description } = req.body;
            const userId = req.user!._id.toString();

            const escrow = await EscrowService.createEscrow({
                buyerId: userId,
                sellerId,
                type: 'marketplace',
                amount,
                description: description || "Marketplace Order",
                items
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
}
