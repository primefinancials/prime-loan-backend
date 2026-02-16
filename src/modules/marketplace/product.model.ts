import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export enum ProductStatus {
    ACTIVE = 'ACTIVE',
    DRAFT = 'DRAFT',
    OUT_OF_STOCK = 'OUT_OF_STOCK',
    HIDDEN = 'HIDDEN'
}

export interface IProduct extends Document {
    vendorId: string; // Link to the Vendor (by userId or vendor _id? Let's use vendor _id for strict relation)
    name: string;
    description: string;
    price: number; // in kobo or smallest currency unit
    stock: number;

    images: string[];
    video?: string;
    category: string;
    type: 'physical' | 'digital';
    tags: string[];
    variants?: {
        name: string;
        options: string[];
        priceModifier?: number;
    }[];
    v?: number; // Version key if needed, or just let Mongoose handle it
    rating?: number;
    status: ProductStatus;

    createdAt: Date;
    updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>({
    vendorId: { type: String, required: true, index: true }, // References Vendor._id
    name: { type: String, required: true, index: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, default: 0, min: 0 },

    images: [{ type: String }],
    video: { type: String },
    category: { type: String, required: true },
    type: { type: String, enum: ['physical', 'digital'], default: 'physical' },
    tags: [{ type: String }],
    variants: [{
        name: { type: String },
        options: [{ type: String }],
        priceModifier: { type: Number }
    }],
    rating: { type: Number, default: 0 },
    status: {
        type: String,
        enum: Object.values(ProductStatus),
        default: ProductStatus.DRAFT,
        index: true
    }
}, {
    timestamps: true,
    collection: getCollectionName('marketplace_products')
});

// Text index for search
ProductSchema.index({ name: 'text', description: 'text', tags: 'text' });

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
