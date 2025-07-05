export interface SendEmailRequest {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IEmailService {
  sendEmail(request: SendEmailRequest): Promise<void>;
}