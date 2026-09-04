import { Request, Response, NextFunction } from "express";
import { CartService } from "./cart.service";
// import { AuthRequest } from "../../shared/middlewares";

export class CartController {
    static async getCart(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user._id;
            const cart = await CartService.getCart(userId);
            res.status(200).json({ status: "success", data: cart });
        } catch (error) {
            next(error);
        }
    }

    static async addItem(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user._id;
            const { productId, quantity, variantId, color, size } = req.body;
            const cart = await CartService.addItem(userId, productId, quantity, variantId, color, size);
            res.status(200).json({ status: "success", data: cart });
        } catch (error) {
            next(error);
        }
    }

    static async updateItem(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user._id;
            const { productId, quantity, variantId } = req.body;
            const cart = await CartService.updateQuantity(userId, productId, quantity, variantId);
            res.status(200).json({ status: "success", data: cart });
        } catch (error) {
            next(error);
        }
    }

    static async removeItem(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user._id;
            const { productId, variantId } = req.body;
            // Or params? Body is easier for complex keys like variantId
            const cart = await CartService.removeItem(userId, productId, variantId);
            res.status(200).json({ status: "success", data: cart });
        } catch (error) {
            next(error);
        }
    }

    static async clearCart(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user._id;
            const cart = await CartService.clearCart(userId);
            res.status(200).json({ status: "success", data: cart });
        } catch (error) {
            next(error);
        }
    }
}
