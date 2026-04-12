/**
 * Auto-Debit Log Model — Tracks Flutterwave auto-debit attempts (card + bank)
 * Replaces the old MonoDebitLog model
 */
import { Schema, model, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IAutoDebitLog extends Document {
  userId: string;
  loanId?: string;
  type: 'card' | 'bank';
  amount: number;
  reference: string;
  token: string;
  status: 'pending' | 'successful' | 'failed';
  provider: 'flutterwave';
  providerResponse?: any;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AutoDebitLogSchema = new Schema<IAutoDebitLog>(
  {
    userId: { type: String, required: true, index: true },
    loanId: { type: String },
    type: { type: String, enum: ['card', 'bank'], required: true },
    amount: { type: Number, required: true },
    reference: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    status: { type: String, enum: ['pending', 'successful', 'failed'], default: 'pending' },
    provider: { type: String, default: 'flutterwave' },
    providerResponse: { type: Schema.Types.Mixed },
    errorMessage: { type: String },
  },
  { collection: getCollectionName('auto_debit_logs'), timestamps: true }
);

export const AutoDebitLog = model<IAutoDebitLog>('AutoDebitLog', AutoDebitLogSchema);
