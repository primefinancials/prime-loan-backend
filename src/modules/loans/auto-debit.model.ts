/**
 * Auto-Debit Model — Stores linked payment methods (card tokens + bank mandates)
 * Replaces the old mono_account field on the User model.
 *
 * CHANGE: Added `bankCode` field (numeric Flutterwave bank code, e.g. "057").
 * Previously absent, causing the cron to pass `bankName` ("Zenith Bank") as
 * the bank code to Flutterwave's direct-debit endpoint — which requires the
 * numeric code. The controller now persists `bankCode` on link-bank.
 */
import { Schema, model, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IAutoDebit extends Document {
  userId: string;
  type: 'card' | 'bank' | 'wallet';
  token: string;
  email: string;

  // Card-specific fields
  last4?: string;
  cardBrand?: string;   // visa, mastercard, verve
  expMonth?: string;
  expYear?: string;

  // Bank-specific fields
  bankName?: string;    // Human-readable name, e.g. "Zenith Bank"
  bankCode?: string;    // Numeric Flutterwave bank code, e.g. "057" ← NEW
  accountNumber?: string;
  accountName?: string;

  // Wallet-specific / Provider fields
  provider?: 'flutterwave' | 'opay' | 'monnify' | 'mono';
  walletPhone?: string;
  mandateCode?: string;

  // Mono direct-debit lifecycle metadata
  providerAccountId?: string;   // Mono linked-account id (for balance enquiry), if exposed
  providerReference?: string;   // reference we sent to Mono on initiate
  monoUrl?: string;             // last authorisation URL issued to the customer
  providerStatusRaw?: string;   // last raw status string seen from the provider
  lastSyncedAt?: Date;          // last time we reconciled this row against the provider
  lastError?: string;           // last provider error (linking or debit)

  /**
   * status lifecycle:
   *  initiating -> pending -> approved -> active           (happy path)
   *  * -> revoked | cancelled | rejected | expired | failed (terminal)
   * 'active' means the mandate is confirmed debitable (Mono ready_to_debit).
   */
  status:
    | 'initiating'
    | 'pending'
    | 'approved'
    | 'active'
    | 'revoked'
    | 'cancelled'
    | 'rejected'
    | 'expired'
    | 'failed';
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

const AutoDebitSchema = new Schema<IAutoDebit>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ['card', 'bank', 'wallet'], required: true },
    token: { type: String, required: true },
    email: { type: String, required: true },

    // Card fields
    last4: { type: String },
    cardBrand: { type: String },
    expMonth: { type: String },
    expYear: { type: String },

    // Bank fields
    bankName: { type: String },
    bankCode: { type: String },   // ← NEW: Flutterwave numeric bank code
    accountNumber: { type: String },
    accountName: { type: String },

    // Wallet fields
    provider: { type: String, enum: ['flutterwave', 'opay', 'monnify', 'mono'] },
    walletPhone: { type: String },
    mandateCode: { type: String },

    // Mono direct-debit lifecycle metadata
    providerAccountId: { type: String },
    providerReference: { type: String },
    monoUrl: { type: String },
    providerStatusRaw: { type: String },
    lastSyncedAt: { type: Date },
    lastError: { type: String },

    status: {
      type: String,
      enum: ['initiating', 'pending', 'approved', 'active', 'revoked', 'cancelled', 'rejected', 'expired', 'failed'],
      default: 'active',
    },
    expiresAt: { type: Date },
  },
  { collection: getCollectionName('auto_debits'), timestamps: true }
);

export const AutoDebit = model<IAutoDebit>('AutoDebit', AutoDebitSchema);