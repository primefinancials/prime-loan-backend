import { Order, IOrder, OrderStatus, IOrderItem } from "./order.model";
import { CartService } from "./cart.service";
import { Product } from "./product.model";
import { NotFoundError, BadRequestError } from "../../exceptions";
import mongoose from "mongoose";

export class OrderService {

    /**
     * Checkout process:
     * 1. Get cart items.
     * 2. Validate stock (again).
     * 3. Group by vendor.
     * 4. Create an Order for each vendor.
     * 5. Clear cart.
     * 6. Return created orders.
     *
     * @param referralCode - Optional per-transaction influencer referral code (from request body).
     *   Priority inside recordCommissionForUser:
     *     1. referralCode param  — per-transaction code, takes priority if provided
     *     2. user.referredBy     — signup referral fallback (influencer who referred this user)
     *     3. Neither found       — commission silently skipped, no error thrown
     */
    static async checkout(userId: string, shippingAddress: string, referralCode?: string): Promise<IOrder[]> {
        const cart = await CartService.getCart(userId);

        if (!cart.items || cart.items.length === 0) {
            throw new BadRequestError("Cart is empty");
        }

        // Validate stock and prepare items
        const itemsWithProduct = await Promise.all(cart.items.map(async (item) => {
            const product = await Product.findById(item.productId);
            if (!product) {
                throw new NotFoundError(`Product not found: ${item.productId}`);
            }
            if (product.stock < item.quantity) {
                throw new BadRequestError(`Insufficient stock for ${product.name}`);
            }
            return {
                ...item,
                productName: product.name,
                vendorId: product.vendorId,
            };
        }));

        // Group by Vendor
        const ordersByVendor = new Map<string, IOrderItem[]>();

        for (const item of itemsWithProduct) {
            const orderItem: IOrderItem = {
                productId: item.productId.toString(),
                productName: item.productName,
                quantity: item.quantity,
                price: item.price,
                variantId: item.variantId,
                color: (item as any).color,
                size: (item as any).size,
            };

            const vendorId = (item as any).vendorId || (item as any)._doc?.vendorId;

            if (!ordersByVendor.has(vendorId)) {
                ordersByVendor.set(vendorId, []);
            }
            ordersByVendor.get(vendorId)?.push(orderItem);
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        const createdOrders: IOrder[] = [];

        try {
            for (const [vendorId, items] of ordersByVendor) {
                const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                const [order] = await Order.create([{
                    userId,
                    vendorId,
                    items,
                    totalAmount,
                    status: OrderStatus.PENDING,
                    shippingAddress
                }], { session });

                createdOrders.push(order);

                // Reduce stock
                for (const item of items) {
                    await Product.findByIdAndUpdate(item.productId, {
                        $inc: { stock: -item.quantity }
                    }, { session });
                }
            }

            // Clear Cart
            await CartService.clearCart(userId, session);

            await session.commitTransaction();

            // --- INFLUENCER COMMISSION HOOK ---
            // Single authoritative location — do NOT also call in the controller (causes double-recording).
            // recordCommissionForUser resolves priority internally:
            //   1. referralCode (per-transaction, from request body via controller)  — highest priority
            //   2. user.referredBy (signup influencer)                               — automatic fallback
            //   3. Neither found → returns silently, no commission recorded
            try {
                const { InfluencerService } = await import("../influencer/influencer.service");
                const totalVolume = createdOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                const transactionRef = createdOrders[0]?._id?.toString();

                InfluencerService.recordCommissionForUser(
                    userId,
                    "marketplace",
                    totalVolume,
                    transactionRef,
                    referralCode   // undefined is fine — triggers user.referredBy fallback inside the service
                ).catch(err => console.warn("Marketplace commission recording failed (non-fatal):", err));
            } catch (hookErr) {
                console.warn("Failed to trigger influencer hook for marketplace checkout:", hookErr);
            }
            // ----------------------------------

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }

        return createdOrders;
    }

    static async getOrders(userId: string) {
        return Order.find({ userId }).sort({ createdAt: -1 });
    }

    static async getVendorOrders(vendorId: string) {
        return Order.find({ vendorId }).sort({ createdAt: -1 });
    }
}