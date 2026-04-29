/**
 * Bill Payment Model - Tracks bill payment transactions
 * Extended from existing structure with v2 fields
 */
import mongoose, { Document, Schema } from 'mongoose';
import { IBillPayment } from './bill-payment.interface';
import { getCollectionName } from '../../shared/utils/collection.utils';

const BillPaymentSchema = new Schema<IBillPayment>({
  userId: { type: String, required: true, index: true },
  traceId: { type: String, required: true, index: true }, // v2 addition
  serviceType: { type: String, required: true },
  serviceId: { type: String, required: true },
  customerReference: { type: String, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'MANUAL_REVIEW'],
    required: true,
    index: true
  },
  providerRef: { type: String },
  referralCode: { type: String },
  processedAt: { type: Date },
  meta: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: getCollectionName('bill_payments')
});

BillPaymentSchema.index({ status: 1, createdAt: 1 });
BillPaymentSchema.index({ providerRef: 1 });
BillPaymentSchema.index({ serviceId: 1 });
BillPaymentSchema.index({ customerReference: 1 });

export const BillPayment = mongoose.model<IBillPayment>('BillPayment', BillPaymentSchema);