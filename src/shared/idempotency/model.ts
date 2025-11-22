/**
 * Idempotency Key Model - Prevents duplicate operations
 * Stores responses for idempotent endpoints to return cached results
 */
import mongoose, { Document, Schema } from 'mongoose';
import { ObjectId } from 'mongodb';

export interface IIdempotencyKey extends Document {
  _id: ObjectId;
  key: string;
  userId?: string;
  response: any;
  createdAt: Date;
  expiresAt?: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>({
  key: { type: String, required: true, unique: true },
  userId: { type: String, index: true },
  response: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }
}, { 
  timestamps: true,
  collection: 'idempotency_keys'
});

export const IdempotencyKey = mongoose.model<IIdempotencyKey>('IdempotencyKey', IdempotencyKeySchema);