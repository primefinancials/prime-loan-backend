/**
 * Mono Debit Log Model — Audit trail for all Mono direct debit attempts
 * Tracks each debit attempt (successful, pending, or failed) for loan recovery.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { ObjectId } from 'mongodb';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IMonoDebitLog extends Document {
  _id: ObjectId;
  loanId: ObjectId;
  userId: string;
  monoAccountId: string;
  amount: number;        // in naira
  reference: string;     // unique reference per debit attempt
  paymentId: string;     // Mono payment ID
  mandateId?: string;    // Mono mandate ID (if mandate-based)
  debitType: 'onetime' | 'mandate';
  status: 'initiated' | 'pending' | 'successful' | 'failed';
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MonoDebitLogSchema = new Schema<IMonoDebitLog>({
  loanId: { type: Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
  userId: { type: String, required: true, index: true },
  monoAccountId: { type: String, required: true },
  amount: { type: Number, required: true },
  reference: { type: String, required: true, unique: true },
  paymentId: { type: String },
  mandateId: { type: String },
  debitType: { type: String, enum: ['onetime', 'mandate'], default: 'onetime' },
  status: {
    type: String,
    enum: ['initiated', 'pending', 'successful', 'failed'],
    default: 'initiated',
    index: true
  },
  failureReason: { type: String }
}, {
  timestamps: true,
  collection: getCollectionName('mono_debit_logs')
});

MonoDebitLogSchema.index({ status: 1, createdAt: -1 });
MonoDebitLogSchema.index({ loanId: 1, status: 1 });

export const MonoDebitLog = mongoose.model<IMonoDebitLog>('MonoDebitLog', MonoDebitLogSchema);
