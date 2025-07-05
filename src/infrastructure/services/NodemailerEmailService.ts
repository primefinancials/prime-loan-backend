import nodemailer from 'nodemailer';
import { IEmailService, SendEmailRequest } from '../../core/services/IEmailService';
import { EMAIL_USERNAME, EMAIL_PASSWORD } from '../../config';

export class NodemailerEmailService implements IEmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransporter({
      host: 'smtp.mailgun.org',
      port: 465,
      secure: true,
      auth: {
        user: EMAIL_USERNAME,
        pass: EMAIL_PASSWORD,
      },
    });
  }

  async sendEmail(request: SendEmailRequest): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: 'primefinance@primefinance.live',
        to: request.to,
        subject: request.subject,
        text: request.text,
        html: request.html,
      });
    } catch (error: any) {
      console.error('Email sending failed:', error.message);
      throw new Error('Failed to send email');
    }
  }
}