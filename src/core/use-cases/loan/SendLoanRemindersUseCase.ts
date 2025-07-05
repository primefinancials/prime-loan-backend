import { ILoanRepository } from '../../repositories/ILoanRepository';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IEmailService } from '../../services/IEmailService';

export class SendLoanRemindersUseCase {
  constructor(
    private loanRepository: ILoanRepository,
    private userRepository: IUserRepository,
    private emailService: IEmailService
  ) {}

  async execute(): Promise<void> {
    try {
      // Send reminders for loans due today
      await this.sendDueTodayReminders();

      // Send reminders for loans due tomorrow
      await this.sendDueTomorrowReminders();
    } catch (error) {
      console.error('Error sending loan reminders:', error);
    }
  }

  private async sendDueTodayReminders(): Promise<void> {
    const loansDueToday = await this.loanRepository.findLoansDueToday();

    for (const loan of loansDueToday) {
      try {
        const user = await this.userRepository.findById(loan.userId);
        if (!user) continue;

        await this.emailService.sendEmail({
          to: user.email,
          subject: 'Your Loan is Due Today',
          text: `Dear ${user.userMetadata.firstName}, Your loan payment of ${loan.outstanding} is due today. Please make the payment immediately to avoid any further late fees and penalties.`,
        });
      } catch (error) {
        console.error(`Error sending reminder for loan ${loan.id}:`, error);
      }
    }
  }

  private async sendDueTomorrowReminders(): Promise<void> {
    const loansDueTomorrow = await this.loanRepository.findLoansDueTomorrow();

    for (const loan of loansDueTomorrow) {
      try {
        const user = await this.userRepository.findById(loan.userId);
        if (!user) continue;

        await this.emailService.sendEmail({
          to: user.email,
          subject: 'Your Loan will be Due Tomorrow',
          text: `Dear ${user.userMetadata.firstName}, Your loan payment of ${loan.outstanding} will be due tomorrow. Please make the payment immediately to avoid any further late fees and penalties.`,
        });
      } catch (error) {
        console.error(`Error sending reminder for loan ${loan.id}:`, error);
      }
    }
  }
}