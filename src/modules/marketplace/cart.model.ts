import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface ICartItem {
    productId: string;
    quantity: number;
    price: number;
    variantId?: string; // If product has variants
    vendorId: string;
}

export interface ICart extends Document {
    userId: string;
    items: ICartItem[];
    totalAmount: number;
    updatedAt: Date;
}

const CartItemSchema = new Schema({
    productId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }, // Snapshotted price
    variantId: { type: String },
    vendorId: { type: String, required: true }
}, { _id: false });

const CartSchema = new Schema<ICart>({
    userId: { type: String, required: true, unique: true, index: true },
    items: [CartItemSchema],
    totalAmount: { type: Number, default: 0 }
}, {
    timestamps: true,
    collection: getCollectionName('carts')
});

// Middleware to recalculate total before save? 
// For now, let service handle it.

export const Cart = mongoose.model<ICart>('Cart', CartSchema);
