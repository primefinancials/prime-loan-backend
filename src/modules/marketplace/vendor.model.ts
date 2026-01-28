import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export enum VendorStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    SUSPENDED = 'SUSPENDED'
}

export interface IVendor extends Document {
    userId: string; // Link to the User model
    businessName: string;
    businessDescription: string;
    status: VendorStatus;
    logo?: string;
    contactEmail: string;
    contactPhone: string;
    address?: string;

    // Admin fields
    approvedBy?: string;
    rejectionReason?: string;

    avgRating: number;
    reviewCount: number;

    createdAt: Date;
    updatedAt: Date;
}

const VendorSchema = new Schema<IVendor>({
    userId: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, required: true, unique: true },
    businessDescription: { type: String, required: true },
    status: {
        type: String,
        enum: Object.values(VendorStatus),
        default: VendorStatus.PENDING,
        index: true
    },
    logo: { type: String },
    contactEmail: { type: String, required: true },
    contactPhone: { type: String, required: true },
    address: { type: String },

    approvedBy: { type: String },
    rejectionReason: { type: String },

    avgRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 }
}, {
    timestamps: true,
    collection: getCollectionName('vendors')
});

export const Vendor = mongoose.model<IVendor>('Vendor', VendorSchema);
