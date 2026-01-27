import { Schema, model } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';
import { ILoan } from './loan.interface';

// Subscriber Schema
const SubscriberSchema = new Schema({
  Subscriber_ID: { type: String, required: false },
  Name: { type: String, required: false },
  Phone: { type: String, required: false },
  Address: { type: String, required: false },
});

// Loan Details Schema
const LoanDetailsSchema = new Schema({
  loanProvider: { type: String, required: false },
  accountNumber: { type: String, required: false },
  loanAmount: { type: Number, required: false },
  outstandingBalance: { type: Number, required: false },
  status: { type: String, required: false },
  performanceStatus: { type: String, required: false },
  overdueAmount: { type: Number, required: false },
  type: { type: String, required: false },
  loanDuration: { type: String, required: false },
  repaymentFrequency: { type: String, required: false },
  repaymentBehavior: { type: String, required: false },
  paymentProfile: { type: String, required: false },
  dateAccountOpened: { type: String, required: false },
  lastUpdatedAt: { type: String, required: false },
  loanCount: { type: Number, required: false },
  monthlyInstallmentAmt: { type: Number, required: false },
});

// Credit Score Schema
const CreditScoreSchema = new Schema({
  lastReported: { type: String, required: false },
  creditorName: { type: String, required: false },
  totalDebt: { type: String, required: false },
  outstandingBalance: { type: Number, required: false },
  activeLoan: { type: Number, required: false },
  loansTaken: { type: Number, required: false },
  income: { type: Number, required: false },
  repaymentHistory: { type: String, required: false },
  openedDate: { type: String, required: false },
  lengthOfCreditHistory: { type: String, required: false },
  remarks: { type: String, required: false },
  creditors: [SubscriberSchema],
  loan_details: [LoanDetailsSchema],
});

// Repayment History Schema
const RepaymentHistorySchema = new Schema({
  amount: { type: Number, required: false },
  outstanding: { type: Number, required: false },
  date: { type: String, required: false },
  action: { type: String, required: false },
});

// Admin Action
const adminAction = new Schema({
  action: { type: String, enum: ["Approve", "Reject"], required: false },
  adminId: { type: String, required: false },
  date: { type: String, required: false },
});

// Define the LoanApplication Schema
const LoanSchema: Schema = new Schema(
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
    base64Image: { type: String },
    documentType: { type: String, enum: ["NIN_SLIP", "NIN", "NATIONAL_ID", "DRIVERS_LICENSE", "PASSPORT"] },
    faceVideoBase64: { type: String }, // mandatory facial video recording
    acknowledgment: { type: Boolean, required: true },
    amount: { type: Number, required: true },
    requested_amount: { type: Number, required: true },
    outstanding: { type: Number, required: true },
    repayment_amount: { type: Number, required: true },
    percentage: { type: Number },
    reason: { type: String, required: true },
    duration: { type: String, required: true },
    category: { type: String, enum: ["personal", "working"], required: true },
    type: { type: String, enum: ["request", "repay"], required: true },
    status: { type: String, enum: ["pending", "rejected", "accepted", "canceled"], required: true },
    loan_payment_status: { type: String, enum: ["complete", "in-progress", "not-started"], required: true },
    repayment_date: { type: String, required: true },
    loan_date: { type: String, required: true },
    credit_message: { type: String, required: true },
    credit_score: CreditScoreSchema,
    repayment_history: [RepaymentHistorySchema],
    lastInterestAdded: { type: String, required: false },
    rejectionReason: { type: String, required: false },
    debit_account: { type: String },
    adminAction,
    call_history: [{
      date: { type: Date },
      status: { type: String },
      provider: { type: String }
    }]
  },
  { timestamps: true, collection: getCollectionName('loans') }
);

// Create the LoanApplication model
const Loan = model<ILoan>('loans', LoanSchema);

export default Loan;
