/**
 * Influencer Commission Model — Tracks individual commission events
 */
import mongoose, { Schema } from 'mongoose';
import { IInfluencerCommission } from './influencer.interface';
import { getCollectionName } from '../../shared/utils/collection.utils';

const InfluencerCommissionSchema = new Schema<IInfluencerCommission>({
  influencerId: { type: Schema.Types.ObjectId, ref: 'Influencer', required: true, index: true },
  userId: { type: String, required: true, index: true },
  transactionRef: { type: String },
  transactionType: {
    type: String,
    enum: ['loan', 'escrow', 'savings', 'bill-payment', 'marketplace', 'signup'],
    required: true,
    index: true
  },
  transactionAmount: { type: Number, required: true },
  commissionRate: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'paid', 'cancelled'],
    default: 'pending',
    index: true
  }
}, {
  timestamps: true,
  collection: getCollectionName('influencer_commissions')
});

InfluencerCommissionSchema.index({ influencerId: 1, transactionType: 1 });
InfluencerCommissionSchema.index({ influencerId: 1, createdAt: -1 });

export const InfluencerCommission = mongoose.model<IInfluencerCommission>('InfluencerCommission', InfluencerCommissionSchema);
