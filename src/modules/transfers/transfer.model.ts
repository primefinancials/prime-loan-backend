import mongoose, { Document, Schema } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';
import { Transaction as ITransaction, Transfer as ITransfer } from './transfer.interface';
/**
 * Legacy Transaction Schema (do not alter, thousands of existing docs depend on it)
 */
const TransactionSchema = new Schema<ITransaction>({
  name: { type: String, required: true },
  user: { type: String, required: true },
  type: { type: String, required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  outstanding: { type: Number, required: true },
  activity: { type: Number },
  details: { type: String, required: true },
  transaction_number: { type: String, required: true, unique: true },
  session_id: { type: String, required: true },
  status: { type: String, required: true },
  message: { type: String },
  receiver: { type: String, required: true },
  bank: { type: String, required: true },
  account_number: { type: String, required: true },
}, { timestamps: true, collection: getCollectionName('transactions') });

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);

/**
 * New Transfer Schema (v2, structured transfers)
 */
const TransferSchema = new Schema<ITransfer>({
  userId: { type: String, required: true, index: true },
  traceId: { type: String, required: true, index: true },
  fromAccount: { type: String, required: true },
  toAccount: { type: String, required: true },
  amount: { type: Number, required: true },
  transferType: { type: String, enum: ['intra', 'inter'], required: true },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED', 'MANUAL_REVIEW'], required: true, index: true },
  providerRef: { type: String },
  // `beneficiaryName` is the RECEIVING party's name (whoever `toAccount` is) -
  // always, regardless of who is viewing the record. `senderName` is the
  // SENDING party's name (whoever `fromAccount` is). Both are resolved once
  // at write time so a receipt never has to guess a name from "am I the
  // sender" - that guess broke down for the wallet-credit webhook path, which
  // used to store the actual sender's name INTO beneficiaryName (since from
  // its own point of view the beneficiary - the receiving user - was always
  // "me" and didn't need naming), so a receiver reading their own record via
  // beneficiaryName got their own name back instead of the real sender's.
  beneficiaryName: { type: String },
  senderName: { type: String },
  bankCode: { type: String },
  reference: { type: String, required: true, unique: true },
  remark: { type: String },
  naration: { type: String },
  processedAt: { type: Date },
  idempotencyKey: { type: String, unique: true, sparse: true },
  walletBalance: { type: Number },
  meta: { type: Schema.Types.Mixed }
}, { timestamps: true, collection: getCollectionName('transfers_v2') });

TransferSchema.index({ status: 1, createdAt: 1 });
TransferSchema.index({ providerRef: 1 });
TransferSchema.index({ reference: 1 });
TransferSchema.index({ idempotencyKey: 1 });

export const Transfer = mongoose.model<ITransfer>('Transfer', TransferSchema);
