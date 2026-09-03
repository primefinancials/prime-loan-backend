/**
 * Bank Balance Snapshot
 * ---------------------
 * A durable record of every Mono balance inquiry an admin triggers for a loan's
 * linked mandate. Replaces the opaque Redis cache: the admin always sees the
 * LAST known balance + when it was taken, and can see a fresh inquiry running.
 *
 * Lifecycle: fetching -> done | error
 */
import { Schema, model, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IBankBalanceSnapshot extends Document {
  userId: string;
  loanId?: string;
  mandateId: string;            // AutoDebit._id
  mandateToken: string;         // Mono mmc_...
  status: 'fetching' | 'done' | 'error';
  balance: number | null;       // NGN
  sufficient: boolean | null;
  testedAmount: number;         // NGN the sufficiency check ran against
  currency: string;
  requestedBy?: string;         // admin id
  requestedAt: Date;
  completedAt?: Date | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IBankBalanceSnapshot>(
  {
    userId: { type: String, required: true, index: true },
    loanId: { type: String, index: true },
    mandateId: { type: String, required: true },
    mandateToken: { type: String, required: true, index: true },
    status: { type: String, enum: ['fetching', 'done', 'error'], default: 'fetching', index: true },
    balance: { type: Number, default: null },
    sufficient: { type: Boolean, default: null },
    testedAmount: { type: Number, default: 1000 },
    currency: { type: String, default: 'NGN' },
    requestedBy: { type: String },
    requestedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { collection: getCollectionName('bank_balance_snapshots'), timestamps: true }
);

schema.index({ mandateToken: 1, status: 1, completedAt: -1 });

export const BankBalanceSnapshot = model<IBankBalanceSnapshot>('BankBalanceSnapshot', schema);
