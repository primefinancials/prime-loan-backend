/**
 * Ledger Entry Model - Single source of truth for all financial transactions
 * Every money movement in the system must create corresponding ledger entries
 */
import mongoose, { Document, Schema } from 'mongoose';
import { ObjectId } from 'mongodb';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface ILedgerEntry extends Document {
  _id: ObjectId;
  traceId: string;
  userId?: string;
  account: string; // 'user_wallet:<id>' | 'provider:<name>' | 'platform_revenue' | 'savings_pool'
  entryType: 'DEBIT' | 'CREDIT';
  category: 'bill-payment' | 'transfer' | 'loan' | 'savings' | 'fee' | 'refund' | 'settlement' | 'escrow';
  subtype?: string;
  amount: number; // in kobo
  currency: string;
  balanceBefore?: number;
  balanceAfter?: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  relatedTo?: string;
  meta?: Record<string, any>;
  idempotencyKey?: string;
  createdAt: Date;
  processedAt?: Date;
}

const LedgerEntrySchema = new Schema<ILedgerEntry>({
  traceId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  account: { type: String, required: true, index: true },
  entryType: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
  category: {
    type: String,
    enum: ['bill-payment', 'transfer', 'loan', 'savings', 'fee', 'refund', 'settlement', 'escrow'],
    required: true,
    index: true
  },
  subtype: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  balanceBefore: { type: Number },
  balanceAfter: { type: Number },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], required: true, index: true },
  relatedTo: { type: String },
  meta: { type: Schema.Types.Mixed },
  idempotencyKey: { type: String, index: true },
  processedAt: { type: Date }
}, {
  timestamps: true,
  collection: getCollectionName('ledger_entries')
});

// Compound indexes for efficient queries
LedgerEntrySchema.index({ traceId: 1, createdAt: -1 });
LedgerEntrySchema.index({ userId: 1, category: 1, createdAt: -1 });
LedgerEntrySchema.index({ status: 1, category: 1, createdAt: 1 });

export const LedgerEntry = mongoose.model<ILedgerEntry>('LedgerEntry', LedgerEntrySchema);