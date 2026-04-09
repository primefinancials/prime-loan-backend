/**
 * Mono Webhook Controller
 * Handles real-time payment status updates from Mono DirectPay.
 * 
 * Events:
 * - direct_debit.payment_successful → mark debit log as successful → repay loan
 * - direct_debit.payment_failed → mark debit log as failed
 * - mono.events.account_connected → update user's mono account
 *
 * Security: Validates `mono-webhook-secret` header against MONO_WEBHOOK_SECRET env var.
 * Returns 200 immediately — processes asynchronously where possible.
 */
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

const logger = pino({ name: 'mono-webhook' });

export class MonoWebhookController {

  /**
   * Verify webhook signature middleware
   */
  static verifySignature(req: Request, res: Response, next: NextFunction) {
    const secret = process.env.MONO_WEBHOOK_SECRET;
    if (!secret) {
      logger.warn('MONO_WEBHOOK_SECRET not configured — skipping verification');
      return next();
    }

    const headerSecret = req.headers['mono-webhook-secret'];
    if (headerSecret !== secret) {
      logger.warn({ received: headerSecret }, 'Invalid mono-webhook-secret');
      return res.status(401).json({ message: 'Unauthorized request' });
    }

    next();
  }

  /**
   * POST /webhooks/mono
   * Main webhook handler
   */
  static async handleWebhook(req: Request, res: Response) {
    // Always return 200 immediately (Mono expects fast response)
    res.status(200).json({ received: true });

    const { event, data } = req.body;
    if (!event) {
      logger.warn('Webhook received without event type');
      return;
    }

    logger.info({ event }, 'Mono webhook received');

    try {
      switch (event) {
        case 'direct_debit.payment_successful':
          await MonoWebhookController.handlePaymentSuccess(data);
          break;

        case 'direct_debit.payment_failed':
          await MonoWebhookController.handlePaymentFailed(data);
          break;

        case 'mono.events.account_connected':
          await MonoWebhookController.handleAccountConnected(data);
          break;

        default:
          logger.info({ event }, 'Unhandled webhook event type');
      }
    } catch (error: any) {
      logger.error({ event, error: error.message }, 'Webhook processing failed');
    }
  }

  /**
   * Handle successful debit payment
   */
  private static async handlePaymentSuccess(data: any) {
    const object = data?.object || data;
    const reference = object?.reference || object?.id;
    const amount = object?.amount;
    const status = object?.status;

    if (!reference) {
      logger.warn({ data }, 'Payment success webhook missing reference');
      return;
    }

    logger.info({ reference, amount, status }, 'Processing successful debit');

    // Lazy import to avoid circular deps
    const { MonoDebitLog } = await import('../loans/mono-debit-log.model');

    // Idempotency check — skip if already processed
    const existingLog = await MonoDebitLog.findOne({ reference });
    if (!existingLog) {
      logger.warn({ reference }, 'MonoDebitLog not found for reference');
      return;
    }

    if (existingLog.status === 'successful') {
      logger.info({ reference }, 'Debit already marked successful — skipping');
      return;
    }

    // Update status
    existingLog.status = 'successful';
    (existingLog as any).providerResponse = data;
    (existingLog as any).processedAt = new Date();
    await existingLog.save();

    // Trigger loan repayment
    if (existingLog.loanId) {
      try {
        const { LoanService } = await import('../loans/loan.service');
        await LoanService.repayLoan({
          loanId: existingLog.loanId as any,
          userId: existingLog.userId,
          amount: existingLog.amount,
          idempotencyKey: `mono_webhook_${reference}`
        });
        logger.info({ reference, loanId: existingLog.loanId, amount: existingLog.amount }, 'Loan repayment triggered via webhook');
      } catch (err: any) {
        logger.error({ reference, loanId: existingLog.loanId, error: err.message }, 'Loan repayment via webhook failed');
      }
    }
  }

  /**
   * Handle failed debit payment
   */
  private static async handlePaymentFailed(data: any) {
    const object = data?.object || data;
    const reference = object?.reference || object?.id;
    const message = object?.message || 'Payment failed';

    if (!reference) {
      logger.warn({ data }, 'Payment failed webhook missing reference');
      return;
    }

    logger.info({ reference, message }, 'Processing failed debit');

    const { MonoDebitLog } = await import('../loans/mono-debit-log.model');
    const log = await MonoDebitLog.findOne({ reference });
    if (!log) {
      logger.warn({ reference }, 'MonoDebitLog not found for failed payment');
      return;
    }

    if (log.status === 'failed' || log.status === 'successful') {
      logger.info({ reference, status: log.status }, 'Debit already in terminal state — skipping');
      return;
    }

    log.status = 'failed';
    log.failureReason = message;
    (log as any).providerResponse = data;
    (log as any).processedAt = new Date();
    await log.save();

    logger.info({ reference, loanId: log.loanId }, 'Debit marked as failed');
  }

  /**
   * Handle account connected event
   */
  private static async handleAccountConnected(data: any) {
    const accountId = data?.id;
    if (!accountId) {
      logger.warn({ data }, 'Account connected webhook missing account ID');
      return;
    }

    logger.info({ accountId }, 'Processing account connected event');

    // Try to find a mono account record that needs this ID
    try {
      const User = (await import('../users/user.model')).default;
      // Find a user whose mono_account was recently linking with this account ID
      const user = await User.findOne({
        $or: [
          { 'mono_account.accountId': accountId },
          { 'mono_account.status': 'linking' }
        ]
      });

      if (user && (user as any).mono_account) {
        if (!(user as any).mono_account.accountId) {
          (user as any).mono_account.accountId = accountId;
          (user as any).mono_account.status = 'active';
          await user.save();
          logger.info({ userId: user._id, accountId }, 'Mono account linked via webhook');
        }
      }
    } catch (err: any) {
      logger.warn({ accountId, error: err.message }, 'Account connected processing failed');
    }
  }
}
