/**
 * Auto-Debit Model — Stores linked payment methods (card tokens + bank mandates)
 * Replaces the old mono_account field on the User model
 */
import { Schema, model, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IAutoDebit extends Document {
  userId: string;
  type: 'card' | 'bank';
  token: string;
  email: string;

  // Card-specific fields
  last4?: string;
  cardBrand?: string; // visa, mastercard, verve
  expMonth?: string;
  expYear?: string;

  // Bank-specific fields
  bankName?: string;
  accountNumber?: string;
  accountName?: string;

  status: 'active' | 'revoked' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

const AutoDebitSchema = new Schema<IAutoDebit>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ['card', 'bank'], required: true },
    token: { type: String, required: true },
    email: { type: String, required: true },

    // Card fields
    last4: { type: String },
    cardBrand: { type: String },
    expMonth: { type: String },
    expYear: { type: String },

    // Bank fields
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },

    status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active' },
    expiresAt: { type: Date },
  },
  { collection: getCollectionName('auto_debits'), timestamps: true }
);

export const AutoDebit = model<IAutoDebit>('AutoDebit', AutoDebitSchema);
