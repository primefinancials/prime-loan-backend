import { ILoanRepository } from '../../repositories/ILoanRepository';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWalletService } from '../../services/IWalletService';
import { ITransactionRepository } from '../../repositories/ITransactionRepository';
import { IEmailService } from '../../services/IEmailService';
import { LoanEntity } from '../../entities/Loan';

export class ProcessOverdueLoansUseCase {
  constructor(
    private loanRepository: ILoanRepository,
    private userRepository: IUserRepository,
    private walletService: IWalletService,
    private transactionRepository: ITransactionRepository,
    private emailService: IEmailService
  ) {}

  async execute(): Promise<void> {
    try {
      const overdueLoans = await this.loanRepository.findOverdueLoans();

      if (!overdueLoans || overdueLoans.length === 0) {
        console.log('No overdue loans found');
        return;
      }

      for (const loan of overdueLoans) {
        try {
          await this.processOverdueLoan(loan);
        } catch (error) {
          console.error(`Error processing loan ${loan.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error processing overdue loans:', error);
    }
  }

  private async processOverdueLoan(loan: LoanEntity): Promise<void> {
    // Add overdue fee
    await this.addOverdueFee(loan);

    // Get user
    const user = await this.userRepository.findById(loan.userId);
    if (!user) {
      throw new Error(`User not found for loan ${loan.id}`);
    }

    // Get user balance
    const userBalance = await this.walletService.getAccountBalance(user.userMetadata.accountNo);

    // Calculate deduction amount
    const deductionAmount = Math.min(userBalance, loan.outstanding);

    if (deductionAmount > 0) {
      // Transfer funds
      const transferResult = await this.walletService.transferFunds({
        fromAccountType: 'user',
        fromAccountNumber: user.userMetadata.accountNo!,
        toAccountNumber: '', // Admin account
        amount: deductionAmount,
        reference: `Prime-Finance-${Date.now()}`,
        remark: 'Loan Repayment',
      });

      // Update loan
      const remainingOutstanding = loan.outstanding - deductionAmount;
      await this.loanRepository.update(loan.id, {
        paymentStatus: remainingOutstanding <= 0 ? 'complete' : 'in-progress',
        outstanding: remainingOutstanding,
        repaymentHistory: [
          ...loan.repaymentHistory,
          {
            amount: deductionAmount,
            outstanding: remainingOutstanding,
            action: 'repayment',
            date: new Date().toISOString(),
          },
        ],
      });

      // Create transaction record
      await this.transactionRepository.create({
        name: 'Loan Repayment',
        userId: user.id,
        type: 'loan',
        category: 'debit',
        amount: deductionAmount,
        outstanding: remainingOutstanding,
        details: 'Loan mandatory repayment',
        transactionNumber: transferResult.txnId,
        sessionId: transferResult.sessionId,
        status: 'success',
        receiver: 'Prime Finance',
        bank: 'Prime Finance - VFD',
        accountNumber: user.userMetadata.accountNo!,
      });
    }

    // Send overdue notification email
    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Your Loan is Overdue',
      text: `Dear ${user.userMetadata.firstName}, Your loan payment of ${loan.outstanding} was due on ${loan.repaymentDate}. Please make the payment immediately to avoid any further late fees and penalties.`,
    });
  }

  private async addOverdueFee(loan: LoanEntity): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const lastInterestDate = loan.lastInterestAdded ? loan.lastInterestAdded.split('T')[0] : null;

    // Only add fee once per day
    if (lastInterestDate === today) {
      return;
    }

    const overdueFee = loan.amount * 0.01; // 1% overdue fee
    const newOutstanding = loan.outstanding + overdueFee;

    await this.loanRepository.update(loan.id, {
      outstanding: newOutstanding,
      lastInterestAdded: today,
      repaymentHistory: [
        ...loan.repaymentHistory,
        {
          amount: overdueFee,
          outstanding: newOutstanding,
          action: 'overdue_fee',
          date: new Date().toISOString(),
        },
      ],
    });
  }
}