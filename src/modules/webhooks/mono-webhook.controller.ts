import { Request, Response } from 'express';
import pino from 'pino';
import { AutoDebit } from '../loans/auto-debit.model';
import { AutoDebitLog } from '../loans/auto-debit-log.model';
import { LoanService } from '../loans/loan.service';
import { WorkerLogService } from '../worker-logs/worker-log.service';

const logger = pino({ name: 'mono-webhook-controller' });

export class MonoWebhookController {
  /**
   * Middleware to verify Mono webhook signature.
   * Mono uses `mono-webhook-secret` header.
   */
  static verifySignature(req: Request, res: Response, next: Function) {
    const providedSecret = req.headers['mono-webhook-secret'];
    const secret = process.env.MONO_WEBHOOK_SECRET || process.env.MONO_SECRET_KEY;
    
    if (!secret || providedSecret !== secret) {
      logger.warn('Missing or invalid Mono webhook secret');
      return res.status(401).json({ status: 'failed', message: 'Unauthorized request' });
    }

    next();
  }

  static async handleWebhook(req: Request, res: Response) {
    try {
      const event = req.body;
      logger.info({ event: event.event }, 'Received Mono Webhook');

      switch (event.event) {
        case 'events.mandates.ready':
        case 'events.mandates.approved':
        case 'events.mandates.active': {
          // Mandate approved
          const mandateId = event.data?.mandate_id || event.data?.id;
          if (mandateId) {
            await AutoDebit.updateMany(
              { token: mandateId, type: 'bank', provider: 'mono' },
              { $set: { status: 'active' } }
            );
            logger.info({ mandateId }, 'Mono mandate activated');
          }
          break;
        }

        case 'events.mandates.debit.successful': {
          const reference = event.data?.reference;
          const amount = event.data?.amount ? event.data.amount / 100 : 0; // Convert kobo to naira

          if (reference) {
            const log = await AutoDebitLog.findOne({ reference });
            if (log && log.status !== 'successful') {
              log.status = 'successful';
              log.providerResponse = event.data;
              await log.save();

              try {
                await LoanService.repayLoan({
                  loanId: log.loanId as string,
                  userId: log.userId,
                  amount: log.amount,
                  idempotencyKey: `webhook-mono-${reference}`,
                  skipBalanceCheck: true,
                  autoDeduct: true,
                  internalOnly: true,
                });
                logger.info({ reference, amount }, 'Mono debit successful, loan reconciled');
              } catch (err: any) {
                logger.error({ reference, error: err.message }, 'Mono webhook reconciliation failed');
              }
            }
          }
          break;
        }

        case 'events.mandates.debit.failed': {
          const reference = event.data?.reference;
          if (reference) {
            await AutoDebitLog.updateMany(
              { reference },
              { $set: { status: 'failed', providerResponse: event.data } }
            );
            logger.info({ reference }, 'Mono debit failed updated');
          }
          break;
        }

        default:
          logger.info({ eventType: event.event }, 'Unhandled Mono event');
      }

      res.status(200).send('OK');
    } catch (err: any) {
      logger.error({ error: err.message }, 'Mono Webhook Error');
      res.status(500).send('Server Error');
    }
  }
}
