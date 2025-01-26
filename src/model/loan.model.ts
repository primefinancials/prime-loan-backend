import { Schema, model } from 'mongoose';
import { LoanApplication } from '../interfaces';

// Define the LoanApplication Schema
const LoanApplicationSchema: Schema = new Schema(
  {
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    dob: { type: String, required: true },
    bvn: { type: String, required: true },
    nin: { type: String, required: true },
    address: { type: String, required: true },
    company: { type: String, default: null },
    company_address: { type: String, default: null },
    annual_income: { type: String, default: null },
    guarantor_1_name: { type: String, default: null },
    guarantor_1_phone: { type: String, default: null },
    guarantor_2_name: { type: String, default: null },
    guarantor_2_phone: { type: String, default: null },
    doi: { type: String, default: null },
    tin: { type: String, default: null },
    userId: { type: String, required: true },
    base64Image: { type: String, required: true },
    acknowledgment: { type: Boolean, required: true },
    category: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, required: true },
    amount: { type: Number, required: true },
    outstanding: { type: Number, required: true },
    reason: { type: String, required: true },
    duration: { type: Number, required: true },
    repayment_amount: { type: Number, required: true },
    percentage: { type: Number, required: true },
    repayment_date: { type: String, required: true },
    loan_date: { type: String, required: true },
    loan_payment_status: { type: String, required: true },
  },
  { timestamps: true }
);

// Create the LoanApplication model
const LoanApplicationModel = model<LoanApplication>('loans', LoanApplicationSchema);

export default LoanApplicationModel;
