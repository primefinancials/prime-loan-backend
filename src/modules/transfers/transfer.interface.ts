import { Document } from 'mongoose';
import { ObjectId } from "mongodb";

export type TransactionType = "loan" | "paybills" | "transfer";
export type TransactionCategory = "credit" | "debit" | "airtime" | "data" | "betting" | "tv" | "power" | "internet" | "waec" | "jamb";
export type TransactionStatus = "success" | "pending" | "failed";

export interface Transaction {
  _id: ObjectId; // Unique transaction identifier (UUID)
  name: string; // Transaction name or description
  user: string; // User ID (UUID)
  type: TransactionType; // Restricted to "loan" or "paybills"
  category: TransactionCategory; // Restricted to specific categories
  amount: number; // Amount involved in the transaction
  outstanding: number; // Outstanding amount, if any
  activity?: number; // Activity status (optional)
  details: string; // Details or description of the transaction
  transaction_number: string; // Unique transaction number
  session_id: string; // Session ID associated with the transaction
  status: TransactionStatus; // Restricted to "success" or "failed"
  createdAt: string; // Timestamp of when the transaction was created
  updatedAt: string; // Timestamp of when the transaction was updated
  message?: string; // Additional message, if any (optional)
  receiver: string; // Receiver information
  bank: string; // Bank details
  account_number: string; // Account number
}

export interface CREATETRANSACTION {
  name: string; // Transaction name or description
  user: string; // User ID (UUID)
  type: TransactionType; // Restricted to "loan" or "paybills"
  category: TransactionCategory; // Restricted to specific categories
  amount: number; // Amount involved in the transaction
  outstanding: number; // Outstanding amount, if any
  activity?: number; // Activity status (optional)
  details: string; // Details or description of the transaction
  transaction_number: string; // Unique transaction number
  session_id: string; // Session ID associated with the transaction
  status: TransactionStatus; // Restricted to "success" or "failed"
  message?: string; // Additional message, if any (optional)
  receiver: string; // Receiver information
  bank: string; // Bank details
  account_number: string; // Account number
}

export interface UPDATETRANSACTION {
  status?: TransactionStatus; // Restricted to "success" or "failed"
}

export interface Transfer extends Document {
  _id: ObjectId;
  userId: string;
  traceId: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  transferType: 'intra' | 'inter';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'MANUAL_REVIEW';
  providerRef?: string;
  /** The RECEIVING party's name (whoever toAccount is). */
  beneficiaryName?: string;
  /** The SENDING party's name (whoever fromAccount is). */
  senderName?: string;
  bankCode?: string;
  reference: string;
  /**
   * What this movement is, from the customer's point of view. Fees the
   * platform sweeps are real transfers out of the user's account, so without
   * this they appeared in the user's own history as an ordinary transfer to
   * an unexplained account number.
   */
  category?: 'transfer' | 'fee' | 'savings-withdrawal' | 'loan' | 'bill-payment' | 'escrow' | 'marketplace';
  remark?: string;
  naration?: string;
  processedAt?: Date;
  meta?: Record<string, any>;
  idempotencyKey?: string;
  walletBalance?: number;
  createdAt: Date;
}