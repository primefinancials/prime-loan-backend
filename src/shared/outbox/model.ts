/**
 * Outbox Event Model - Reliable event publishing pattern
 * Ensures external calls are made reliably using transactional outbox pattern
 */
import mongoose, { Document, Schema } from 'mongoose';
import { ObjectId } from 'mongodb';

export interface IOutboxEvent extends Document {
  _id: ObjectId;
  topic: string;
  payload: any;
  processed: boolean;
  createdAt: Date;
  processedAt?: Date;
  retryCount: number;
  lastError?: string;
}

const OutboxEventSchema = new Schema<IOutboxEvent>({
  topic: { type: String, required: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  processed: { type: Boolean, default: false, index: true },
  processedAt: { type: Date },
  retryCount: { type: Number, default: 0 },
  lastError: { type: String }
}, { 
  timestamps: true,
  collection: 'outbox_events'
});

// Index for efficient polling of unprocessed events
OutboxEventSchema.index({ processed: 1, createdAt: 1 });

export const OutboxEvent = mongoose.model<IOutboxEvent>('OutboxEvent', OutboxEventSchema);