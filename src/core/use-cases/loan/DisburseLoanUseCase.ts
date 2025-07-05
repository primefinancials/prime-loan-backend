import { LoanEntity } from '../../entities/Loan';
import { UserEntity } from '../../entities/User';
import { ILoanRepository } from '../../repositories/ILoanRepository';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWalletService } from '../../services/IWalletService';
import { NotFoundError, BadRequestError } from '../../../shared/errors/AppError';

export interface DisburseLoanRequest {
  loanId: string;
  userId: string;
  amount: number;
  duration: number;
}

export interface DisburseLoanResponse {
  loan: LoanEntity;
  transferData: any;
}

export class DisburseLoanUseCase {
  constructor(
    private loanRepository: ILoanRepository,
    private userRepository: IUserRepository,
    private walletService: IWalletService
  ) {}

  async execute(request: DisburseLoanRequest): Promise<DisburseLoanResponse> {
    // Find loan
    const loan = await this.loanRepository.findById(request.loanId);
    if (!loan) {
      throw new NotFoundError('Loan not found');
    }

    // Check if loan is already accepted
    if (loan.status === 'accepted') {
      throw new BadRequestError('Loan already accepted');
    }

    // Find user
    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Calculate amounts
    const processingFee = (request.amount * 3) / 100;
    const totalAmount = loan.category === 'working' ? request.amount - processingFee : request.amount;

    // Transfer funds
    const transferData = await this.walletService.transferFunds({
      fromAccountType: 'admin',
      toAccountNumber: user.userMetadata.accountNo!,
      amount: totalAmount,
      reference: `Prime-Finance-${Date.now()}`,
      remark: 'Loan Disbursement',
    });

    // Calculate loan details
    const fee = 500;
    const loanPercentage = loan.category === 'working' ? 4 : 10;
    const percentage = request.duration / 30 >= 1
      ? ((request.amount * loanPercentage) / 100) * (request.duration / 30)
      : (request.amount * loanPercentage) / 100;
    const totalOutstanding = request.amount + fee + percentage;

    // Calculate dates
    const loanDate = new Date();
    const repaymentDate = new Date(loanDate);
    repaymentDate.setDate(loanDate.getDate() + request.duration);

    // Update loan
    const updatedLoan = await this.loanRepository.update(request.loanId, {
      duration: request.duration,
      amount: request.amount,
      outstanding: totalOutstanding,
      status: 'accepted',
      loanDate: loanDate.toISOString(),
      repaymentDate: repaymentDate.toISOString(),
    });

    return {
      loan: updatedLoan,
      transferData,
    };
  }
}