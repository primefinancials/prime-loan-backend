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
     */
    static async checkout(userId: string, shippingAddress: string): Promise<IOrder[]> {
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
                vendorId: product.vendorId, // Ensure we use current vendorId from product
                // Handle variant name update if needed
            };
        }));

        // Group by Vendor
        const ordersByVendor = new Map<string, IOrderItem[]>();

        for (const item of itemsWithProduct) {
            // Re-map to OrderItem interface
            const orderItem: IOrderItem = {
                productId: item.productId.toString(), // Ensure string
                productName: item.productName,
                quantity: item.quantity,
                price: item.price,
                variantId: item.variantId,
                // variantName: ... (fetch if needed)
            };

            const vendorId = (item as any).vendorId || (item as any)._doc?.vendorId; // Safe access

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
