/**
 * Ledger Service - Core financial ledger operations
 * Manages all ledger entries and ensures double-entry bookkeeping principles
 */
import { LedgerEntry, ILedgerEntry } from './LedgerEntry.model';
import { UuidService } from '../../shared/utils/uuid';
import mongoose from 'mongoose';

export interface CreateLedgerEntryParams {
  traceId: string;
  userId?: string;
  account: string;
  entryType: 'DEBIT' | 'CREDIT';
  category: 'bill-payment' | 'transfer' | 'loan' | 'savings' | 'fee' | 'refund' | 'settlement' | 'escrow' | 'profit_distribution';
  subtype?: string;
  amount: number; // in kobo
  currency?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  status?: 'PENDING' | 'COMPLETED' | 'FAILED';
  relatedTo?: string;
  meta?: Record<string, any>;
  idempotencyKey?: string;
}

export class LedgerService {
  /**
   * Create a ledger entry within a session
   */
  static async createEntry(
    params: CreateLedgerEntryParams,
    session?: mongoose.ClientSession
  ): Promise<ILedgerEntry> {
    const entry = {
      ...params,
      currency: params.currency || 'NGN',
      status: params.status || 'PENDING'
    };

    const [ledgerEntry] = await LedgerEntry.create([entry], { session });
    return ledgerEntry;
  }

  /**
   * Create double-entry ledger entries (debit + credit)
   */
  static async createDoubleEntry(
    traceId: string,
    debitAccount: string,
    creditAccount: string,
    amount: number,
    category: CreateLedgerEntryParams['category'],
    options: {
      userId?: string;
      subtype?: string;
      meta?: Record<string, any>;
      idempotencyKey?: string;
      session?: mongoose.ClientSession;
    } = {}
  ): Promise<{ debit: ILedgerEntry; credit: ILedgerEntry }> {
    const { session, ...commonParams } = options;

    const debit = await this.createEntry({
      traceId,
      account: debitAccount,
      entryType: 'DEBIT',
      category,
      amount,
      ...commonParams
    }, session);

    const credit = await this.createEntry({
      traceId,
      account: creditAccount,
      entryType: 'CREDIT',
      category,
      amount,
      ...commonParams
    }, session);

    return { debit, credit };
  }

  /**
   * Get ledger entries by trace ID
   */
  static async getByTraceId(traceId: string): Promise<ILedgerEntry[]> {
    return LedgerEntry.find({ traceId }).sort({ createdAt: 1 });
  }

  /**
   * Update ledger entry status
   */
  static async updateStatus(
    entryId: string,
    status: 'PENDING' | 'COMPLETED' | 'FAILED',
    session?: mongoose.ClientSession
  ): Promise<void> {
    await LedgerEntry.findByIdAndUpdate(
      entryId,
      {
        status,
        processedAt: status !== 'PENDING' ? new Date() : undefined
      },
      { session }
    );
  }

  /**
   * Get user wallet balance from ledger
   */
  /**
   * Get wallet balance for ANY account (user or system)
   */
  static async getWalletBalance(accountName: string): Promise<number> {
    const result = await LedgerEntry.aggregate([
      {
        $match: {
          account: accountName,
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          balance: {
            $sum: {
              $cond: [
                { $eq: ['$entryType', 'CREDIT'] },
                '$amount',
                { $multiply: ['$amount', -1] }
              ]
            }
          }
        }
      }
    ]);

    return result[0]?.balance || 0;
  }

  /**
   * Get user wallet balance from ledger
   */
  static async getUserWalletBalance(userId: string): Promise<number> {
    return this.getWalletBalance(`user_wallet:${userId}`);
  }

  /**
   * Find reconciliation inconsistencies
   */
  static async findInconsistencies(): Promise<any[]> {
    return LedgerEntry.aggregate([
      {
        $match: { status: 'COMPLETED' }
      },
      {
        $group: {
          _id: '$traceId',
          totalDebits: {
            $sum: {
              $cond: [{ $eq: ['$entryType', 'DEBIT'] }, '$amount', 0]
            }
          },
          totalCredits: {
            $sum: {
              $cond: [{ $eq: ['$entryType', 'CREDIT'] }, '$amount', 0]
            }
          },
          entries: { $push: '$$ROOT' }
        }
      },
      {
        $match: {
          $expr: { $ne: ['$totalDebits', '$totalCredits'] }
        }
      }
    ]);
  }
}