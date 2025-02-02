import { Schema, model } from 'mongoose';
import { LoanApplication } from '../interfaces';

// Subscriber Schema
const SubscriberSchema = new Schema({
  Subscriber_ID: { type: String, required: true },
  Name: { type: String, required: true },
  Phone: { type: String, required: true },
  Address: { type: String, required: true },
});

// Loan Details Schema
const LoanDetailsSchema = new Schema({
  loanProvider: { type: String, required: true },
  accountNumber: { type: String, required: true },
  loanAmount: { type: Number, required: true },
  outstandingBalance: { type: Number, required: true },
  status: { type: String, required: true },
  performanceStatus: { type: String, required: true },
  overdueAmount: { type: Number, required: true },
  type: { type: String, required: true },
  loanDuration: { type: String, required: true },
  repaymentFrequency: { type: String, required: true },
  repaymentBehavior: { type: String, required: true },
  paymentProfile: { type: String, required: true },
  dateAccountOpened: { type: String, required: true },
  lastUpdatedAt: { type: String, required: true },
  loanCount: { type: Number, required: true },
  monthlyInstallmentAmt: { type: Number, required: true },
});

// Credit Score Schema
const CreditScoreSchema = new Schema({
  loanId: { type: String, required: true },
  lastReported: { type: String, required: true },
  creditorName: { type: String, required: true },
  totalDebt: { type: String, required: true },
  accountype: { type: String, required: true },
  outstandingBalance: { type: Number, required: true },
  activeLoan: { type: Number, required: true },
  loansTaken: { type: Number, required: true },
  income: { type: Number, required: true },
  repaymentHistory: { type: String, required: true },
  openedDate: { type: String, required: true },
  lengthOfCreditHistory: { type: String, required: true },
  remarks: { type: String, required: true },
  creditors: [SubscriberSchema],
  loan_details: [LoanDetailsSchema],
});

// Repayment History Schema
const RepaymentHistorySchema = new Schema({
  amount: { type: Number, required: true },
  outstanding: { type: Number, required: true },
  date: { type: Number, required: true },
  action: { type: String, required: true },
});

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
    credit_score: CreditScoreSchema,
    repayment_history: [RepaymentHistorySchema],
  },
  { timestamps: true }
);

// Create the LoanApplication model
const LoanApplicationModel = model<LoanApplication>('loans', LoanApplicationSchema);

export default LoanApplicationModel;
