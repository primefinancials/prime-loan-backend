export type TransactionType = "loan" | "paybills" | "transfer";
export type TransactionCategory = "credit" | "debit" | "airtime" | "data" | "betting" | "tv" | "power" | "internet" | "waec" | "jamb" ;
export type TransactionStatus = "success" | "failed";

export interface Transaction {
  _id: string; // Unique transaction identifier (UUID)
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
  created_at: string; // Timestamp of when the transaction was created
  updated_at: string; // Timestamp of when the transaction was updated
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
