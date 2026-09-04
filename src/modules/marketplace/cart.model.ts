import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface ICartItem {
    productId: string;
    quantity: number;
    price: number;
    variantId?: string; // If product has variants
    color?: string;
    size?: string;
    vendorId: string;
    name?: string;  // Snapshotted from the product at add-time, like price
    image?: string; // ditto
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
    color: { type: String },
    size: { type: String },
    vendorId: { type: String, required: true },
    name: { type: String },
    image: { type: String }
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
