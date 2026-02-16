import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export enum OrderStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    PROCESSING = 'PROCESSING',
    SHIPPED = 'SHIPPED',
    DELIVERED = 'DELIVERED',
    CANCELLED = 'CANCELLED',
    REFUNDED = 'REFUNDED'
}

export interface IOrderItem {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
    variantId?: string;
    variantName?: string;
}

export interface IOrder extends Document {
    userId: string;
    vendorId: string; // One order per vendor
    items: IOrderItem[];
    totalAmount: number;
    status: OrderStatus;
    shippingAddress: string; // Simple string for now, could be object
    escrowId?: string; // Link to Escrow transaction if applicable
    paymentReference?: string;

    createdAt: Date;
    updatedAt: Date;
}

const OrderItemSchema = new Schema({
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    variantId: { type: String },
    variantName: { type: String }
}, { _id: false });

const OrderSchema = new Schema<IOrder>({
    userId: { type: String, required: true, index: true },
    vendorId: { type: String, required: true, index: true },
    items: [OrderItemSchema],
    totalAmount: { type: Number, required: true },
    status: {
        type: String,
        enum: Object.values(OrderStatus),
        default: OrderStatus.PENDING,
        index: true
    },
    shippingAddress: { type: String, required: true },
    escrowId: { type: String },
    paymentReference: { type: String }
}, {
    timestamps: true,
    collection: getCollectionName('marketplace_orders')
});

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
