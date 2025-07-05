import cron from 'node-cron';
import { Container } from '../di/Container';
import { ProcessOverdueLoansUseCase } from '../../core/use-cases/loan/ProcessOverdueLoansUseCase';
import { SendLoanRemindersUseCase } from '../../core/use-cases/loan/SendLoanRemindersUseCase';

export class LoanScheduler {
  private container: Container;
  private processOverdueLoansUseCase: ProcessOverdueLoansUseCase;
  private sendLoanRemindersUseCase: SendLoanRemindersUseCase;

  constructor() {
    this.container = Container.getInstance();
    this.setupUseCases();
    this.setupSchedules();
  }

  private setupUseCases() {
    this.processOverdueLoansUseCase = new ProcessOverdueLoansUseCase(
      this.container.get('loanRepository'),
      this.container.get('userRepository'),
      this.container.get('walletService'),
      this.container.get('transactionRepository'),
      this.container.get('emailService')
    );

    this.sendLoanRemindersUseCase = new SendLoanRemindersUseCase(
      this.container.get('loanRepository'),
      this.container.get('userRepository'),
      this.container.get('emailService')
    );
  }

  private setupSchedules() {
    // Process overdue loans every 9 minutes
    cron.schedule('*/9 * * * *', async () => {
      console.log('Running overdue loan processing...');
      await this.processOverdueLoansUseCase.execute();
    });

    // Send loan reminders once daily
    cron.schedule('0 9 * * *', async () => {
      console.log('Sending loan reminders...');
      await this.sendLoanRemindersUseCase.execute();
    });
  }
}