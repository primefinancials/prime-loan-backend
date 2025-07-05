export interface LoanEntity {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  bvn: string;
  nin: string;
  address: string;
  company?: string;
  companyAddress?: string;
  annualIncome?: string;
  guarantor1Name?: string;
  guarantor1Phone?: string;
  guarantor2Name?: string;
  guarantor2Phone?: string;
  requestedAmount: number;
  amount: number;
  outstanding: number;
  reason: string;
  category: 'personal' | 'working';
  type: 'request' | 'repay';
  status: 'pending' | 'rejected' | 'accepted';
  duration: number;
  repaymentAmount: number;
  percentage: number;
  loanDate: string;
  repaymentDate: string;
  paymentStatus: 'complete' | 'in-progress' | 'not-started';
  creditMessage: string;
  creditScore?: CreditScore;
  repaymentHistory: RepaymentHistory[];
  lastInterestAdded?: string;
  rejectionReason?: string;
  debitAccount: string;
  base64Image: string;
  acknowledgment: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditScore {
  loanId: string;
  lastReported: string;
  creditorName: string;
  totalDebt: string;
  accountType: string;
  outstandingBalance: number;
  activeLoan: number;
  loansTaken: number;
  income: number;
  repaymentHistory: string;
  openedDate: string;
  lengthOfCreditHistory: string;
  remarks: string;
  creditors: Creditor[];
  loanDetails: LoanDetail[];
}

export interface Creditor {
  subscriberId: string;
  name: string;
  phone: string;
  address: string;
}

export interface LoanDetail {
  loanProvider: string;
  accountNumber: string;
  loanAmount: number;
  outstandingBalance: number;
  status: string;
  performanceStatus: string;
  overdueAmount: number;
  type: string;
  loanDuration: string;
  repaymentFrequency: string;
  repaymentBehavior: string;
  paymentProfile: string;
  dateAccountOpened: string;
  lastUpdatedAt: string;
  loanCount: number;
  monthlyInstallmentAmount: number;
}

export interface RepaymentHistory {
  amount: number;
  outstanding: number;
  date: string;
  action: string;
}