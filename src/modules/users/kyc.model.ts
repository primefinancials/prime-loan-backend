/**
 * KYC Upgrade Request Model
 * Tracks VFD account tier upgrade requests and document submissions
 */
import mongoose from 'mongoose';

export interface IKYCUpgradeRequest extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  currentTier: number;
  requestedTier: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  documents: Array<{
    type: 'NIN' | 'DRIVER_LICENSE' | 'PASSPORT' | 'BVN' | 'UTILITY_BILL' | 'ID_CARD';
    reference: string;
    url?: string;               // Cloudinary URL of the uploaded document
    number?: string;            // the document number the user typed (NIN/BVN etc.)
    status: 'uploaded' | 'verified' | 'failed';
    uploadedAt?: Date;
  }>;
  address?: string;
  phone?: string;
  bvn?: string;
  nin?: string;
  submittedAt: Date;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  rejectedAt?: Date;
  rejectedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
  meta: {
    accountNo: string;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const KYCUpgradeRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    currentTier: {
      type: Number,
      required: true,
      enum: [1, 2, 3],
      default: 1
    },
    requestedTier: {
      type: Number,
      required: true,
      enum: [2, 3]
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      default: 'pending',
      index: true
    },
    documents: [
      {
        type: {
          type: String,
          enum: ['NIN', 'DRIVER_LICENSE', 'PASSPORT', 'BVN', 'UTILITY_BILL', 'ID_CARD'],
          required: true
        },
        reference: { type: String, required: true },
        url: { type: String },
        number: { type: String },
        status: {
          type: String,
          enum: ['uploaded', 'verified', 'failed'],
          default: 'uploaded'
        },
        uploadedAt: { type: Date, default: Date.now },
        _id: false
      }
    ],
    address: String,
    phone: String,
    bvn: String,
    nin: String,
    submittedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    approvedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedAt: Date,
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectionReason: String,
    // Free-form: accountNo, vfdUpgradeRef, vfd sync notes, etc.
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    collection: 'kyc_upgrade_requests',
    timestamps: true
  }
);

// Index for finding pending requests for admin review
KYCUpgradeRequestSchema.index({ status: 1, submittedAt: -1 });
// Index for user-specific requests
KYCUpgradeRequestSchema.index({ userId: 1, submittedAt: -1 });

export const KYCUpgradeRequest = mongoose.model<IKYCUpgradeRequest>(
  'KYCUpgradeRequest',
  KYCUpgradeRequestSchema
);

export default KYCUpgradeRequest;
