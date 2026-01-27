import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IReview extends Document {
    userId: string; // The buyer/reviewer
    vendorId: string; // The vendor being reviewed
    productId?: string; // Optional: Review for specific product
    rating: number; // 1 to 5
    comment: string;
    createdAt: Date;
    updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>({
    userId: { type: String, required: true, index: true },
    vendorId: { type: String, required: true, index: true },
    productId: { type: String }, // Optional
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
}, {
    timestamps: true,
    collection: getCollectionName('marketplace_reviews')
});

export const Review = mongoose.model<IReview>('Review', ReviewSchema);
