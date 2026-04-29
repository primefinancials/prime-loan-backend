/**
 * Influencer Interfaces
 */
import { Document } from 'mongoose';
import { ObjectId } from 'mongodb';

export type InfluencerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type CommissionStatus = 'pending' | 'paid' | 'cancelled';
export type PayoutStatus = 'pending' | 'completed' | 'failed';
export type CommissionTransactionType = 'loan' | 'escrow' | 'savings' | 'bill-payment' | 'marketplace' | 'signup';

/**
 * Per-influencer discount/bonus configuration.
 * discountPercent: 0–100% discount off user's transaction fee.
 * bonusAmount: flat Naira bonus credited to user's wallet after a successful transaction.
 */
export interface DiscountConfig {
  enabled: boolean;
  discountPercent: number;
  bonusAmount: number;
}

export interface IInfluencer extends Document {
  _id: ObjectId;
  userId: string;
  status: InfluencerStatus;
  referralCode: string;
  applicationVideo?: string;
  socialLinks?: Record<string, string>;
  applicationDate: Date;
  approvalDate?: Date;
  rejectionReason?: string;
  totalEarnings: number;
  pendingPayout: number;
  payoutHistory: {
    amount: number;
    date: Date;
    reference: string;
    status: PayoutStatus;
  }[];
  payoutDetails: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  totalVolumeGenerated?: number;
  discountConfig?: DiscountConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInfluencerCommission extends Document {
  _id: ObjectId;
  influencerId: ObjectId;
  userId: string;
  transactionRef: string;
  transactionType: CommissionTransactionType;
  transactionAmount: number;
  commissionRate: number;
  commissionAmount: number;
  status: CommissionStatus;
  createdAt: Date;
}

export interface ApplyInfluencerDto {
  userId: string;
  applicationVideo?: string;
  socialLinks?: Record<string, string>;
}

export interface RecordCommissionDto {
  userId: string;
  transactionRef: string;
  transactionType: CommissionTransactionType;
  transactionAmount: number;
  referralCode?: string;
}

export interface InfluencerDashboard {
  status: InfluencerStatus;
  referralCode: string;
  referralLink: string;
  totalReferred: number;
  totalEarnings: number;
  pendingPayout: number;
  totalVolumeGenerated?: number;
  earningsByService: Record<CommissionTransactionType, { total: number; count: number }>;
}
