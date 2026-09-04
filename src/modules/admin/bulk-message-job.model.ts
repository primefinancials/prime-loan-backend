/**
 * Bulk Message Job
 * ----------------
 * A durable record of an admin-triggered bulk voice-call or SMS blast to an
 * arbitrary list of phone numbers (platform users or anyone else - guarantors,
 * references, etc). Recipients are processed sequentially in the background;
 * the admin UI polls this document for live progress.
 *
 * Lifecycle: running -> completed
 */
import { Schema, model, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IBulkMessageRecipient {
  phone: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string | null;
  providerId?: string | null;
  sentAt?: Date | null;
}

export interface IBulkMessageJob extends Document {
  type: 'call' | 'sms';
  message: string;
  provider?: string; // voice calls only: 'termii' | 'africastalking'
  recipients: IBulkMessageRecipient[];
  total: number;
  sentCount: number;
  failedCount: number;
  status: 'running' | 'completed';
  requestedBy?: string;
  createdAt: Date;
  completedAt?: Date | null;
}

const RecipientSchema = new Schema<IBulkMessageRecipient>(
  {
    phone: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    error: { type: String, default: null },
    providerId: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { _id: false }
);

const schema = new Schema<IBulkMessageJob>(
  {
    type: { type: String, enum: ['call', 'sms'], required: true },
    message: { type: String, required: true },
    provider: { type: String },
    recipients: { type: [RecipientSchema], default: [] },
    total: { type: Number, required: true },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'completed'], default: 'running', index: true },
    requestedBy: { type: String },
    completedAt: { type: Date, default: null },
  },
  { collection: getCollectionName('bulk_message_jobs'), timestamps: true }
);

schema.index({ createdAt: -1 });

export const BulkMessageJob = model<IBulkMessageJob>('BulkMessageJob', schema);
