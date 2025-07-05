import { LoanEntity } from '../../core/entities/Loan';
import { ILoanRepository } from '../../core/repositories/ILoanRepository';
import { LoanModel } from '../database/models/LoanModel';

export class MongoLoanRepository implements ILoanRepository {
  async create(loanData: Omit<LoanEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<LoanEntity> {
    const loan = await LoanModel.create(loanData);
    return this.mapToEntity(loan);
  }

  async findById(id: string): Promise<LoanEntity | null> {
    const loan = await LoanModel.findById(id);
    return loan ? this.mapToEntity(loan) : null;
  }

  async update(id: string, updates: Partial<LoanEntity>): Promise<LoanEntity> {
    const loan = await LoanModel.findByIdAndUpdate(id, updates, { new: true });
    if (!loan) {
      throw new Error('Loan not found');
    }
    return this.mapToEntity(loan);
  }

  async delete(id: string): Promise<void> {
    await LoanModel.findByIdAndDelete(id);
  }

  async findMany(filters?: Partial<LoanEntity>): Promise<LoanEntity[]> {
    const loans = await LoanModel.find(filters || {});
    return loans.map(loan => this.mapToEntity(loan));
  }

  async findOverdueLoans(): Promise<LoanEntity[]> {
    const today = new Date().toISOString();
    const loans = await LoanModel.find({
      outstanding: { $gt: 0 },
      status: 'accepted',
      repaymentDate: { $lt: today }
    });
    return loans.map(loan => this.mapToEntity(loan));
  }

  async findLoansDueToday(): Promise<LoanEntity[]> {
    const today = new Date().toISOString().split('T')[0];
    const loans = await LoanModel.find({
      repaymentDate: { $regex: `^${today}` },
      outstanding: { $gt: 0 },
      status: 'accepted'
    });
    return loans.map(loan => this.mapToEntity(loan));
  }

  async findLoansDueTomorrow(): Promise<LoanEntity[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const loans = await LoanModel.find({
      repaymentDate: { $regex: `^${tomorrowStr}` },
      outstanding: { $gt: 0 },
      status: 'accepted'
    });
    return loans.map(loan => this.mapToEntity(loan));
  }

  async count(filters?: Partial<LoanEntity>): Promise<number> {
    return await LoanModel.countDocuments(filters || {});
  }

  private mapToEntity(loan: any): LoanEntity {
    return {
      id: loan._id.toString(),
      userId: loan.userId,
      firstName: loan.first_name,
      lastName: loan.last_name,
      email: loan.email,
      phone: loan.phone,
      dateOfBirth: loan.dob,
      bvn: loan.bvn,
      nin: loan.nin,
      address: loan.address,
      company: loan.company,
      companyAddress: loan.company_address,
      annualIncome: loan.annual_income,
      guarantor1Name: loan.guarantor_1_name,
      guarantor1Phone: loan.guarantor_1_phone,
      guarantor2Name: loan.guarantor_2_name,
      guarantor2Phone: loan.guarantor_2_phone,
      requestedAmount: Number(loan.requested_amount),
      amount: Number(loan.amount),
      outstanding: Number(loan.outstanding),
      reason: loan.reason,
      category: loan.category,
      type: loan.type,
      status: loan.status,
      duration: Number(loan.duration),
      repaymentAmount: Number(loan.repayment_amount),
      percentage: Number(loan.percentage),
      loanDate: loan.loan_date,
      repaymentDate: loan.repayment_date,
      paymentStatus: loan.loan_payment_status,
      creditMessage: loan.credit_message,
      creditScore: loan.credit_score,
      repaymentHistory: loan.repayment_history || [],
      lastInterestAdded: loan.lastInterestAdded,
      rejectionReason: loan.rejectionReason,
      debitAccount: loan.debit_account,
      base64Image: loan.base64Image,
      acknowledgment: loan.acknowledgment,
      createdAt: loan.createdAt,
      updatedAt: loan.updatedAt,
    };
  }
}