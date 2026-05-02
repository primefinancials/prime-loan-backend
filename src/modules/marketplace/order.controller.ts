import { Response, NextFunction } from "express";
import { OrderService } from "./order.service";
import { InfluencerService } from "../influencer/influencer.service";
import { ProtectedRequest } from "../../interfaces";

export class OrderController {
    static async checkout(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const { shippingAddress, referralCode } = req.body;

            if (!shippingAddress) {
                // Or validate more strictly
                // throw new BadRequestError("Shipping address is required");
            }

            const orders = await OrderService.checkout(userId, shippingAddress || "Default Address", referralCode);

            res.status(201).json({ status: "success", data: orders });
        } catch (error) {
            next(error);
        }
    }

    static async getMyOrders(req: ProtectedRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user!._id.toString();
            const orders = await OrderService.getOrders(userId);
            res.status(200).json({ status: "success", data: orders });
        } catch (error) {
            next(error);
        }
    }

    // Vendor specific endpoints can be added here or in MarketplaceController
}
