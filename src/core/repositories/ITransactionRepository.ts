import { TransactionEntity } from '../entities/Transaction';

export interface ITransactionRepository {
  create(transaction: Omit<TransactionEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<TransactionEntity>;
  findById(id: string): Promise<TransactionEntity | null>;
  update(id: string, updates: Partial<TransactionEntity>): Promise<TransactionEntity>;
  delete(id: string): Promise<void>;
  findMany(filters?: Partial<TransactionEntity>): Promise<TransactionEntity[]>;
  findByUserId(userId: string): Promise<TransactionEntity[]>;
  count(filters?: Partial<TransactionEntity>): Promise<number>;
}