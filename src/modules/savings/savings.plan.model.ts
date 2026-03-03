/**
 * Savings Plan Model - User savings accounts
 * Supports both locked and flexible savings with interest calculations
 */
import mongoose, { Document, Schema } from 'mongoose';
import { ObjectId } from 'mongodb';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface ISavingsPlan extends Document {
  _id: ObjectId;
  userId: string;
  planName: string;
  planType: 'LOCKED' | 'FLEXIBLE';
  subType?: 'STANDARD' | 'INSTANT';
  principal: number; // in kobo
  interestEarned: number; // in kobo
  targetAmount?: number; // in kobo
  durationDays?: number;
  durationMonths?: number; // For Fixed plans (alternative to days)
  interestRate: number; // annual percentage
  status: 'ACTIVE' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  maturityDate?: Date;
  locked: boolean;
  createdAt: Date;
  completedAt?: Date;
  meta?: {
    autoRenew?: boolean;
    penaltyRate?: number;
    compoundingFrequency?: 'daily' | 'monthly' | 'maturity';
  };
  // Flexible Savings Contribution Config
  contribution?: {
    frequency: 'weekly' | 'monthly';
    amount: number; // in naira
    dayOfWeek?: number; // 0-6 for weekly (0 = Sunday)
    dayOfMonth?: number; // 1-31 for monthly
    pendingDeduction: boolean; // true if deduction is due/overdue
    lastDeductionDate?: Date;
  };
  // Comprehensive Transaction Histories
  contributionHistory?: {
    amount: number;
    initiated: Date;
    processed: boolean;
    transactionId?: string;
  }[];
  withdrawalHistory?: {
    amount: number;
    penalty: number;
    netAmount: number;
    scheduledDate?: Date;
    initiated: Date;
    completed?: Date | null;
    earlyWithdrawal: boolean;
    processed: boolean;
    traceId?: string;
    transactionId?: string;
  }[];
  // Legacy autoSave (deprecated for new plans, kept for migration)
  autoSaveConfig?: {
    enabled: boolean;
    amount: number;
    lastRun?: Date;
    retryCount: number;
  };
  earlyWithdrawalDate?: Date;
}

const SavingsPlanSchema = new Schema<ISavingsPlan>({
  userId: { type: String, required: true, index: true },
  planName: { type: String, required: true },
  planType: { type: String, enum: ['LOCKED', 'FLEXIBLE'], required: true },
  subType: { type: String, enum: ['STANDARD', 'INSTANT'] },
  principal: { type: Number, required: true, default: 0 },
  interestEarned: { type: Number, default: 0 },
  targetAmount: { type: Number },
  durationDays: { type: Number },
  durationMonths: { type: Number }, // Fixed plans: duration in months
  interestRate: { type: Number, required: true }, // annual percentage
  status: {
    type: String,
    enum: ['ACTIVE', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
    default: 'ACTIVE',
    index: true
  },
  maturityDate: { type: Date },
  locked: { type: Boolean, required: true },
  completedAt: { type: Date },
  meta: {
    autoRenew: { type: Boolean, default: false },
    penaltyRate: { type: Number },
    compoundingFrequency: { type: String, enum: ['daily', 'monthly', 'maturity'], default: 'maturity' }
  },
  // Flexible Savings Contribution Schedule
  contribution: {
    frequency: { type: String, enum: ['weekly', 'monthly'] },
    amount: { type: Number, default: 0 },
    dayOfWeek: { type: Number, min: 0, max: 6 }, // 0=Sunday
    dayOfMonth: { type: Number, min: 1, max: 31 },
    pendingDeduction: { type: Boolean, default: false },
    lastDeductionDate: { type: Date }
  },
  // Comprehensive Histories
  contributionHistory: [{
    amount: { type: Number, required: true },
    initiated: { type: Date, default: Date.now },
    processed: { type: Boolean, default: false },
    transactionId: { type: String }
  }],
  withdrawalHistory: [{
    amount: { type: Number, required: true },
    penalty: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    scheduledDate: { type: Date },
    initiated: { type: Date, default: Date.now },
    completed: { type: Date, default: null },
    earlyWithdrawal: { type: Boolean, default: false },
    processed: { type: Boolean, default: false },
    traceId: { type: String },
    transactionId: { type: String }
  }],
  // Legacy autoSave (deprecated)
  autoSaveConfig: {
    enabled: { type: Boolean, default: false },
    amount: { type: Number, default: 0 },
    lastRun: { type: Date },
    retryCount: { type: Number, default: 0 }
  },
  earlyWithdrawalDate: { type: Date, default: null }
}, {
  timestamps: true,
  collection: getCollectionName('savings_plans')
});

SavingsPlanSchema.index({ userId: 1, status: 1 });
SavingsPlanSchema.index({ maturityDate: 1, status: 1 });

export const SavingsPlan = mongoose.model<ISavingsPlan>('SavingsPlan', SavingsPlanSchema);