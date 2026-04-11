/**
 * Influencer Interfaces
 */
import { Document } from 'mongoose';
import { ObjectId } from 'mongodb';

export type InfluencerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type CommissionStatus = 'pending' | 'paid' | 'cancelled';
export type PayoutStatus = 'pending' | 'completed' | 'failed';
export type CommissionTransactionType = 'loan' | 'escrow' | 'savings' | 'bill-payment' | 'marketplace' | 'signup';

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
}

export interface InfluencerDashboard {
  status: InfluencerStatus;
  referralCode: string;
  referralLink: string;
  totalReferred: number;
  totalEarnings: number;
  pendingPayout: number;
  earningsByService: Record<CommissionTransactionType, number>;
}
