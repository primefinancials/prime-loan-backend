import { Schema, model } from 'mongoose';
import { Transaction } from '../interfaces';

const transactionSchema = new Schema<Transaction>(
  {
    name: {
      type: String,
      required: true, // Transaction name or description
    },
    user: {
      type: String,
      required: true, // User ID (UUID)
    },
    type: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true, // Amount involved in the transaction
    },
    outstanding: {
      type: Number,
      required: true, // Outstanding amount, if any
    },
    activity: {
      type: Number,
      required: false, // Optional activity status
    },
    details: {
      type: String,
      required: true, // Details or description of the transaction
    },
    transaction_number: {
      type: String,
      required: true, // Unique transaction number
      unique: true, // Ensures uniqueness
    },
    session_id: {
      type: String,
      required: true, // Session ID associated with the transaction
    },
    status: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: false, // Additional message (optional)
    },
    receiver: {
      type: String,
      required: true, // Receiver information
    },
    bank: {
      type: String,
      required: true, // Bank details
    },
    account_number: {
      type: String,
      required: true, // Account number
    },
  },
  { timestamps: true }
);

const Transaction = model<Transaction>('transactions', transactionSchema);

// Sync indexes with the database
(async () => {
  await Transaction.syncIndexes();
})();

export default Transaction;
