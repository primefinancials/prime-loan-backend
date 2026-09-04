import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export type EscrowType = 'p2p' | 'marketplace';
export type EscrowStatus = 'INITIALIZING' | 'PENDING' | 'LOCKED' | 'PROCESSING' | 'COMPLETED' | 'DISPUTED' | 'REFUNDED' | 'CANCELLED' | 'REJECTED' | 'FAILED';

export interface IEscrowItem {
    name: string;
    quantity: number;
    price: number;
    image?: string;
    description?: string;
    productId?: string;
    color?: string;
    size?: string;
}

export interface IEscrowTransaction extends Document {
    transactionId: string;
    type: EscrowType;
    buyerId: string;
    sellerId: string;
    amount: number;
    fee: number;
    totalAmount: number;
    status: EscrowStatus;
    description?: string;
    items: IEscrowItem[];
    inviteEmail?: string;
    rejectionReason?: string;
    chatRoomId?: string;
    disputeReason?: string;
    disputeEvidence?: string[];
    resolvedBy?: string;
    resolutionNote?: string;
    lockCode?: string;
    expiryDate?: Date;
    inspectionPeriod?: number;
    deliveryDate?: Date;
    completedAt?: Date;
    referralCode?: string;
    createdAt: Date;
    updatedAt: Date;
}

// ... existing code ...

const EscrowItemSchema = new Schema({
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    price: { type: Number, required: true },
    image: { type: String },
    description: { type: String },
    productId: { type: String },
    color: { type: String },
    size: { type: String }
}, { _id: false });

const EscrowTransactionSchema = new Schema<IEscrowTransaction>({
    transactionId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['p2p', 'marketplace'], required: true },
    buyerId: { type: String, required: true, index: true },
    sellerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true }, // Principal amount
    fee: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true }, // Total locked

    status: {
        type: String,
        enum: ['INITIALIZING', 'PENDING', 'LOCKED', 'PROCESSING', 'COMPLETED', 'DISPUTED', 'REFUNDED', 'CANCELLED', 'REJECTED', 'FAILED'],
        default: 'PENDING',
        index: true
    },

    description: { type: String },
    items: [EscrowItemSchema],

    inviteEmail: { type: String },
    rejectionReason: { type: String },
    chatRoomId: { type: String },

    disputeReason: { type: String },
    disputeEvidence: [{ type: String }],
    resolvedBy: { type: String },
    resolutionNote: { type: String },

    lockCode: { type: String },
    expiryDate: { type: Date },
    inspectionPeriod: { type: Number, default: 3 }, // Default 3 days inspection
    deliveryDate: { type: Date },
    completedAt: { type: Date },
    referralCode: { type: String }
}, {
    timestamps: true,
    collection: getCollectionName('escrows')
});

export const EscrowTransaction = mongoose.model<IEscrowTransaction>('EscrowTransaction', EscrowTransactionSchema);
