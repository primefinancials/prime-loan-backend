import nodemailer from "nodemailer";
import twilio from "twilio";
import { Resend } from "resend";
import pino from "pino";
import { User } from "../users/user.interface";
import { SettingsService } from "../admin/settings.service";
import { getVoiceProvider } from "../../shared/providers/voice-call.provider";

const emailLogger = pino({ name: "email" });

/* ----------- Providers Initialization ----------- */
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// Primary transport: Resend (HTTPS API - no SMTP ports, works from Elastic
// Beanstalk without egress config). The sender domain must be verified in the
// Resend dashboard. Falls back to SMTP/nodemailer when RESEND_API_KEY is unset.
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const EMAIL_FROM = process.env.EMAIL_FROM || "Prime Finance <info@primefinance.live>";

const smtpTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT_NUMBER) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

export class NotificationService {
  private static async sendEmail(to: string, subject: string, html: string) {
    if (resendClient) {
      const { error } = await resendClient.emails.send({ from: EMAIL_FROM, to, subject, html });
      if (error) {
        emailLogger.error({ to, subject, error: error.message || error }, "Resend send failed");
        throw new Error(`Resend: ${error.message || JSON.stringify(error)}`);
      }
      return;
    }
    await smtpTransporter.sendMail({ from: EMAIL_FROM, to, subject, html });
  }

  /* ----------- Broadcasting Providers ----------- */
  static async sendActionSms(to: string, message: string) {
    try {
      const provider = await getVoiceProvider();
      if (provider.sendRecoverySms) {
        await provider.sendRecoverySms(to, message);
      } else {
        console.warn(`Provider ${provider.providerName} does not support SMS broadcasting directly in the abstraction`);
      }
    } catch (error) {
      console.error("SMS Broadcast Error:", error);
    }
  }

  static async sendVoiceCall(to: string, message: string) {
    try {
      const provider = await getVoiceProvider();
      await provider.makeCall(to, message);
    } catch (error) {
      console.error("Voice Call Broadcast Error:", error);
    }
  }

  static async sendBulkEmail(toAddresses: string[], subject: string, message: string) {
    const html = this.template(subject, `<p>${message}</p>`);
    const recipients = [...new Set(toAddresses.filter(Boolean))];

    // Resend: use the batch endpoint (up to 100 per call) so a large broadcast
    // doesn't trip the per-second rate limit with a burst of single sends.
    if (resendClient) {
      for (let i = 0; i < recipients.length; i += 100) {
        const chunk = recipients.slice(i, i + 100).map((to) => ({ from: EMAIL_FROM, to, subject, html }));
        try {
          const { error } = await resendClient.batch.send(chunk);
          if (error) emailLogger.error({ error: error.message || error, count: chunk.length }, "Resend batch send failed");
        } catch (err: any) {
          emailLogger.error({ err: err.message, count: chunk.length }, "Resend batch send threw");
        }
      }
      return;
    }

    const results = await Promise.allSettled(
      recipients.map((email) => this.sendEmail(email, subject, html))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) emailLogger.warn({ failed, total: recipients.length }, "Bulk email: some sends failed");
  }

  /* ----------- Shared Template Wrapper ----------- */
  private static template(title: string, body: string) {
    return `
    <div style="font-family: Arial, sans-serif; background:#f4f4f4; padding:20px;">
      <div style="max-width:600px; margin:0 auto; background:#fff; border-radius:8px; padding:20px; border:1px solid #ddd;">
        <h1 style="color:#0d6efd; font-size:22px; text-align:center; margin-bottom:20px;">${title}</h1>
        <div style="font-size:15px; line-height:1.6; color:#333;">
          ${body}
        </div>
        <hr style="margin:20px 0; border:none; border-top:1px solid #eee;" />
        <p style="font-size:12px; text-align:center; color:#777;">
          © ${new Date().getFullYear()} Prime Loan. All rights reserved.
        </p>
      </div>
    </div>
    `;
  }

  /* ----------- Loan Reminder Helper ----------- */
  private static async sendLoanReminder(
    user: User,
    loan: any,
    subject: string,
    message: string
  ) {
    const body = `
      <p>Dear <strong>${user.user_metadata.first_name}</strong>,</p>
      <p>${message}</p>
      <p><strong>Outstanding:</strong> ₦${loan.outstanding}</p>
      <p><strong>Repayment Date:</strong> ${loan.repayment_date}</p>
      <p style="color:#d97706; font-weight:bold;">
        Please make the payment immediately to avoid further late fees and penalties.
      </p>
    `;
    return this.sendEmail(
      user.email,
      subject,
      this.template("Loan Reminder", body)
    );
  }

  static async sendLoanOverdue(user: User, loan: any) {
    const settings = await SettingsService.getSettings();
    const msg = settings.loan?.reminders?.overdue || `Your loan payment of ₦${loan.outstanding} was due on ${loan.repayment_date}.`;
    return this.sendLoanReminder(
      user,
      loan,
      "Your Loan is Overdue",
      msg
    );
  }

  static async sendLoanDueToday(user: User, loan: any) {
    const settings = await SettingsService.getSettings();
    const msg = settings.loan?.reminders?.dueToday || `Your loan payment of ₦${loan.outstanding} is due <strong>today</strong>.`;
    return this.sendLoanReminder(
      user,
      loan,
      "Your Loan is Due Today",
      msg
    );
  }

  static async sendLoanDueTomorrow(user: User, loan: any) {
    const settings = await SettingsService.getSettings();
    const msg = settings.loan?.reminders?.dueTomorrow || `Your loan payment of ₦${loan.outstanding} will be due <strong>tomorrow</strong>.`;
    return this.sendLoanReminder(
      user,
      loan,
      "Your Loan Will Be Due Tomorrow",
      msg
    );
  }

  /* ----------- Loan Emails ----------- */

  static async sendLoanApplicationUser(user: User, loan: any) {
    const body = `
      <p>Hi <strong>${user.user_metadata.first_name}</strong>,</p>
      <p>Your loan application for <strong>₦${loan.amount}</strong> has been received.</p>
      <p>We will review it and notify you shortly.</p>
      <p style="color:#0d6efd; font-weight:bold;">Thank you for choosing Prime Loan.</p>
    `;
    return this.sendEmail(
      user.email,
      "Loan Application Received",
      this.template("Loan Application", body)
    );
  }

  /* ----------- KYC / Tier Upgrade ----------- */
  static async sendKycSubmitted(user: User, targetTier: number) {
    const name = user?.user_metadata?.first_name || "there";
    const body = `
      <p>Hi <strong>${name}</strong>,</p>
      <p>We've received your request to upgrade to <strong>Tier ${targetTier}</strong> and your documents are now under review.</p>
      <p>This usually takes a few hours. We'll email you as soon as it's been processed.</p>`;
    return this.sendEmail(user.email, "KYC Upgrade Received – Prime Finance", this.template("KYC Upgrade Received", body));
  }

  static async sendKycApproved(user: User, newTier: number) {
    const name = user?.user_metadata?.first_name || "there";
    const body = `
      <p>Hi <strong>${name}</strong>,</p>
      <p>Good news — your account has been upgraded to <strong>Tier ${newTier}</strong>. Your new transaction and loan limits are active immediately.</p>
      <p>Thank you for verifying your identity with Prime Finance.</p>`;
    return this.sendEmail(user.email, "Your KYC Upgrade Was Approved – Prime Finance", this.template("KYC Upgrade Approved", body));
  }

  static async sendKycRejected(user: User, reason: string) {
    const name = user?.user_metadata?.first_name || "there";
    const body = `
      <p>Hi <strong>${name}</strong>,</p>
      <p>We couldn't approve your recent KYC upgrade request for the following reason:</p>
      <p style="padding:12px;background:#fef2f2;border-left:3px solid #dc2626;color:#991b1b;">${reason}</p>
      <p>You can submit a new request with corrected details at any time from the app.</p>`;
    return this.sendEmail(user.email, "Action Needed: KYC Upgrade – Prime Finance", this.template("KYC Upgrade Update", body));
  }

  static async sendWelcomeEmail(to: string, firstName: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; padding:20px;">
        <h2 style="color:#2563eb;">Welcome to Prime Loan 🎉</h2>
        <p>Hi <b>${firstName}</b>,</p>
        <p>We’re excited to have you on board. Your financial journey starts here.</p>
        <p style="margin-top:20px;">Best regards,<br/>Prime Loan Team</p>
      </div>
    `;
    return this.sendEmail(to, "Welcome to Prime Loan", html);
  }

  static async sendAdminNewUserAlert(to: string, firstName: string, lastName: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; padding:20px;">
        <h2 style="color:#2563eb;">New User SignUp 🎉</h2>
        <p>A new user has just signed up: <b>${firstName} ${lastName}</b></p>
        <p style="margin-top:20px;">Best regards,<br/>Prime Loan System</p>
      </div>
    `;
    return this.sendEmail(to, "New User SignUp", html);
  }

  static async sendLoginAlert(to: string, firstName: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; padding:20px;">
        <h2 style="color:#16a34a;">Login Alert ✅</h2>
        <p>Hi <b>${firstName}</b>,</p>
        <p>Your account was just accessed. If this wasn’t you, please reset your password immediately.</p>
        <p style="margin-top:20px;">Stay safe,<br/>Prime Loan Security Team</p>
      </div>
    `;
    return this.sendEmail(to, "Login Alert – Prime Loan", html);
  }

  static async sendOtpEmail(to: string, firstName: string, pin: number) {
    const html = `
      <div style="font-family: Arial, sans-serif; padding:20px;">
        <h2 style="color:#2563eb;">Password Reset Request 🔐</h2>
        <p>Dear <b>${firstName}</b>,</p>
        <p>We received a request to reset your password. Use the One-Time Password (OTP) below to proceed</p>
        <p>🔐 Your One-Time Password (OTP) is:</p>
        <h3 style="background:#f3f4f6; padding:10px; text-align:center; letter-spacing:3px;">${pin}</h3>
        <p>This code is valid for the next 10 minutes. If you did not request a password reset, please ignore this email or contact our support team immediately.</p>
        <br /><br />
        <p>Stay secure,</p>
        <p>Prime Loan Support Team</p>
        <p>support@primefinance.live | primefinance.live</p>
      </div>
    `;
    return this.sendEmail(to, "Reset Your Password – OTP Code", html);
  }

  static async sendLoanApplicationAdmin(
    user: User,
    title: string,
    content: string,
    admins: string,
    loan: any
  ) {
    const body = `
      <p>${content}</p>
      <p><strong>User:</strong> ${user.user_metadata.first_name} ${user.user_metadata.surname}</p>
      <p><strong>Amount:</strong> ₦${loan.amount}</p>
      <p><strong>Category:</strong> ${loan.category || "N/A"}</p>
      <p><strong>Duration:</strong> ${loan.duration || "N/A"} days</p>
      <p><strong>Loan ID:</strong> ${loan._id}</p>
    `;

    return this.sendEmail(
      admins,
      title,
      this.template("Admin Notification", body)
    );
  }

  static async sendLoanApproval(user: User, loan: any) {
    const body = `
      <p>Congratulations <strong>${user.user_metadata.first_name}</strong>!</p>
      <p>Your loan of <strong>₦${loan.amount}</strong> has been disbursed successfully.</p>
      <p>Repayment is due on <strong>${loan.repayment_date}</strong>.</p>
      <p style="color:green; font-weight:bold;">Use your funds wisely and repay on time to grow your loan limit, and get funded higher loan amounts.</p>
    `;

    return this.sendEmail(
      user.email,
      "Loan Approved & Disbursed",
      this.template("Loan Approved", body)
    );
  }

  static async sendLoanRepayment(user: any, repayAmount: number, message: string) {
    const body = `
      <p>Hi <strong>${user.user_metadata.first_name}</strong>,</p>
      <p>Your repayment of <strong>₦${repayAmount}</strong> has been received successfully.</p>
      <p>${message}</p>
      <p>Thank you for your commitment!</p>
    `;
    return this.sendEmail(
      user.email,
      "Loan Repayment Successful",
      this.template("Repayment Confirmation", body)
    );
  }

  static async sendLoanRejection(user: any, amount: number, reason: string) {
    const body = `
      <p>Dear <strong>${user.user_metadata.first_name}</strong>,</p>
      <p>Unfortunately, your loan request for <strong>₦${amount}</strong> has been rejected.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p style="color:red; font-weight:bold;">Please work on improving your eligibility for future requests.</p>
    `;
    return this.sendEmail(
      user.email,
      "Loan Request Rejected",
      this.template("Loan Rejected", body)
    );
  }

  static async sendDebitAlert(user: User, amount: number) {
    const body = `
      <p>Hi <strong>${user.user_metadata.first_name}</strong>,</p>
      <p>Your transfer of <strong>₦${amount}</strong> has been complete.</p>
      <p>Kindly visit your dashboard to view transaction details.</p>
      <p style="color:#0d6efd; font-weight:bold;">Thank you for choosing Prime Loan.</p>
    `;
    return this.sendEmail(
      user.email,
      "Your Transfer Has Been Completed",
      this.template("Transfer Completed", body)
    );
  }

  static async sendCreditAlert(
    user: User,
    amount: number,
    originator_account_name: string,
    reference: string
  ) {
    const body = `
      <p>Hi <strong>${user.user_metadata.first_name}</strong>,</p>
      <p>Your wallet has been credited with ₦${amount} from ${originator_account_name}.</p>
      <p style="color:gray; font-weight:bold;">Reference: ${reference}</p>
      <p>Kindly visit your dashboard to view transaction details.</p>
      <p style="color:#0d6efd; font-weight:bold;">Thank you for choosing Prime Loan.</p>
    `;
    return this.sendEmail(
      user.email,
      "Wallet Alert – Funds Credited",
      this.template("Wallet Credited", body)
    );
  }
  static async sendEscrowInvite(to: string, buyerName: string, amount: number, escrowLink: string) {
    const body = `
      <p>Hi there,</p>
      <p><strong>${buyerName}</strong> has started a secured escrow transaction of <strong>₦${amount}</strong> with you on Prime Loan.</p>
      <p>To view the transaction and accept the funds, please sign up or log in using this email address.</p>
      <p><a href="${escrowLink}" style="background-color:#0d6efd; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">View Transaction</a></p>
      <p>Or copy this link: ${escrowLink}</p>
    `;
    return this.sendEmail(
      to,
      "You have a new Escrow Invitation",
      this.template("Escrow Invite", body)
    );
  }

  static async sendEscrowCreated(to: string, buyerName: string, amount: number, escrowLink: string) {
    const body = `
      <p>Hi,</p>
      <p><strong>${buyerName}</strong> has created a new escrow transaction of <strong>₦${amount}</strong> with you.</p>
      <p>Please log in to your dashboard to review and accept the transaction.</p>
      <p><a href="${escrowLink}" style="background-color:#0d6efd; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">View Transaction</a></p>
    `;
    return this.sendEmail(
      to,
      "New Escrow Transaction Received",
      this.template("New Escrow Request", body)
    );
  }

  static async sendAdminPayoutRequestAlert(influencer: any, amount: number, admins: string) {
    const body = `
      <p>A new influencer payout request has been received.</p>
      <p><strong>Influencer:</strong> ${influencer.name}</p>
      <p><strong>Amount:</strong> ₦${amount.toLocaleString()}</p>
      <p><strong>Influencer ID:</strong> ${influencer._id}</p>
      <p>Please log in to the admin dashboard to review and process this payout.</p>
    `;
    return this.sendEmail(
      admins,
      "New Influencer Payout Request",
      this.template("Payout Request Alert", body)
    );
  }

  static async sendPush(userId: string, message: string) {
    // Placeholder for push notification implementation
    console.log(`Sending push to ${userId}: ${message}`);
    // In a real implementation: find FCM token for user and send
  }
}
