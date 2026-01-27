import mongoose, { Schema, Document } from 'mongoose';

export type EscrowType = 'p2p' | 'marketplace';
export type EscrowStatus = 'PENDING' | 'LOCKED' | 'COMPLETED' | 'DISPUTED' | 'REFUNDED' | 'CANCELLED';

export interface IEscrowItem {
    name: string;
    quantity: number;
    price: number;
    image?: string;
    description?: string;
}

export interface IEscrowTransaction extends Document {
    transactionId: string;
    type: EscrowType;
    buyerId: string;
    sellerId: string;
    amount: number;
    fee: number;
    totalAmount: number; // amount + fee
    status: EscrowStatus;
    description: string;
    items: IEscrowItem[];

    // Dispute fields
    disputeReason?: string;
    disputeEvidence?: string[];
    resolvedBy?: string;
    resolutionNote?: string;

    // Delivery
    lockCode?: string; // Code given to buyer to confirm delivery (optional)
    expiryDate?: Date; // Auto-refund or auto-complete date

    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
}

const EscrowItemSchema = new Schema({
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    price: { type: Number, required: true },
    image: { type: String },
    description: { type: String }
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
        enum: ['PENDING', 'LOCKED', 'COMPLETED', 'DISPUTED', 'REFUNDED', 'CANCELLED'],
        default: 'PENDING',
        index: true
    },

    description: { type: String },
    items: [EscrowItemSchema],

    disputeReason: { type: String },
    disputeEvidence: [{ type: String }],
    resolvedBy: { type: String },
    resolutionNote: { type: String },

    lockCode: { type: String },
    expiryDate: { type: Date },
    completedAt: { type: Date }
}, {
    timestamps: true,
    collection: 'escrows'
});

export const EscrowTransaction = mongoose.model<IEscrowTransaction>('EscrowTransaction', EscrowTransactionSchema);
