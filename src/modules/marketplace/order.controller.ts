import { Request, Response, NextFunction } from "express";
import { OrderService } from "./order.service";

export class OrderController {
    static async checkout(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user.userId;
            const { shippingAddress } = req.body;

            if (!shippingAddress) {
                // Or validate more strictly
                // throw new BadRequestError("Shipping address is required");
            }

            const orders = await OrderService.checkout(userId, shippingAddress || "Default Address");
            res.status(201).json({ status: "success", data: orders });
        } catch (error) {
            next(error);
        }
    }

    static async getMyOrders(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user.userId;
            const orders = await OrderService.getOrders(userId);
            res.status(200).json({ status: "success", data: orders });
        } catch (error) {
            next(error);
        }
    }

    // Vendor specific endpoints can be added here or in MarketplaceController
}
