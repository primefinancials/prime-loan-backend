/**
 * Loan Ladder Model - OCR extracted income ladder for loan eligibility
 * Stores extracted amounts from calculator images for loan approval decisions
 */
import mongoose, { Document, Schema } from 'mongoose';
import { ObjectId } from 'mongodb';

export interface ILoanLadder extends Document {
  _id: ObjectId;
  step: number;
  amount: number;
  verifiedBy?: string;
  createdAt: Date;
  meta?: {
    adminNotes?: string;
  };
}

const LoanLadderSchema = new Schema<ILoanLadder>({
  step: { type: Number, required: true, unique: true }, 
  amount: { type: Number, required: true }, 
  verifiedBy: { type: String },
  meta: {
    adminNotes: { type: String }
  }
}, { 
  timestamps: true,
  collection: 'loan_ladders'
});

LoanLadderSchema.index({ userId: 1, createdAt: -1 });
LoanLadderSchema.index({ trusted: 1, source: 1 });

export const LoanLadder = mongoose.model<ILoanLadder>('LoanLadder', LoanLadderSchema);