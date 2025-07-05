import { LoanEntity } from '../entities/Loan';

export interface ILoanRepository {
  create(loan: Omit<LoanEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<LoanEntity>;
  findById(id: string): Promise<LoanEntity | null>;
  update(id: string, updates: Partial<LoanEntity>): Promise<LoanEntity>;
  delete(id: string): Promise<void>;
  findMany(filters?: Partial<LoanEntity>): Promise<LoanEntity[]>;
  findOverdueLoans(): Promise<LoanEntity[]>;
  findLoansDueToday(): Promise<LoanEntity[]>;
  findLoansDueTomorrow(): Promise<LoanEntity[]>;
  count(filters?: Partial<LoanEntity>): Promise<number>;
}