import { LoanEntity } from '../../entities/Loan';
import { ILoanRepository } from '../../repositories/ILoanRepository';
import { ICreditCheckService } from '../../services/ICreditCheckService';
import { NotFoundError } from '../../../shared/errors/AppError';

export interface CreateLoanRequest {
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
  amount: number;
  reason: string;
  category: 'personal' | 'working';
  type: 'request' | 'repay';
  duration: number;
  repaymentAmount: number;
  percentage: number;
  loanDate: string;
  repaymentDate: string;
  base64Image: string;
  acknowledgment: boolean;
  debitAccount?: string;
}

export class CreateLoanUseCase {
  constructor(
    private loanRepository: ILoanRepository,
    private creditCheckService: ICreditCheckService
  ) {}

  async execute(request: CreateLoanRequest): Promise<LoanEntity> {
    // Perform credit check
    const creditData = await this.creditCheckService.performCreditCheck(request.bvn);

    // Create loan entity
    const loanData: Omit<LoanEntity, 'id' | 'createdAt' | 'updatedAt'> = {
      userId: request.userId,
      firstName: request.firstName,
      lastName: request.lastName,
      email: request.email,
      phone: request.phone,
      dateOfBirth: request.dateOfBirth,
      bvn: request.bvn,
      nin: request.nin,
      address: request.address,
      company: request.company,
      companyAddress: request.companyAddress,
      annualIncome: request.annualIncome,
      guarantor1Name: request.guarantor1Name,
      guarantor1Phone: request.guarantor1Phone,
      guarantor2Name: request.guarantor2Name,
      guarantor2Phone: request.guarantor2Phone,
      requestedAmount: request.amount,
      amount: request.amount,
      outstanding: request.amount,
      reason: request.reason,
      category: request.category,
      type: request.type,
      status: 'pending',
      duration: request.duration,
      repaymentAmount: request.repaymentAmount,
      percentage: request.percentage,
      loanDate: request.loanDate,
      repaymentDate: request.repaymentDate,
      paymentStatus: 'not-started',
      creditMessage: creditData?.error?.message || 'available',
      creditScore: creditData?.creditScore || undefined,
      repaymentHistory: [],
      debitAccount: request.debitAccount || 'N/A',
      base64Image: request.base64Image,
      acknowledgment: request.acknowledgment,
    };

    return await this.loanRepository.create(loanData);
  }
}