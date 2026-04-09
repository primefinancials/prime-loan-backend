/**
 * Influencer Model — Influencer/Affiliate profiles
 */
import mongoose, { Schema } from 'mongoose';
import { IInfluencer } from './influencer.interface';
import { getCollectionName } from '../../shared/utils/collection.utils';

const InfluencerSchema = new Schema<IInfluencer>({
  userId: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
    index: true
  },
  referralCode: { type: String, unique: true, sparse: true },
  applicationVideo: { type: String },
  applicationDate: { type: Date, default: Date.now },
  approvalDate: { type: Date },
  rejectionReason: { type: String },
  totalEarnings: { type: Number, default: 0 },
  pendingPayout: { type: Number, default: 0 },
  payoutHistory: [{
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    reference: { type: String },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' }
  }],
  payoutDetails: {
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String }
  }
}, {
  timestamps: true,
  collection: getCollectionName('influencers')
});

InfluencerSchema.index({ referralCode: 1 });
InfluencerSchema.index({ status: 1, createdAt: -1 });

export const Influencer = mongoose.model<IInfluencer>('Influencer', InfluencerSchema);
