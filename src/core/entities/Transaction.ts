export interface TransactionEntity {
  id: string;
  name: string;
  userId: string;
  type: 'loan' | 'paybills' | 'transfer';
  category: 'credit' | 'debit' | 'airtime' | 'data' | 'betting' | 'tv' | 'power' | 'internet' | 'waec' | 'jamb';
  amount: number;
  outstanding: number;
  details: string;
  transactionNumber: string;
  sessionId: string;
  status: 'success' | 'failed';
  message?: string;
  receiver: string;
  bank: string;
  accountNumber: string;
  activity?: number;
  createdAt: Date;
  updatedAt: Date;
}