import { Request, Response } from 'express';
import crypto from 'crypto';
import pino from 'pino';
import { AutoDebit } from '../loans/auto-debit.model';
import { AutoDebitLog } from '../loans/auto-debit-log.model';
import { LoanService } from '../loans/loan.service';
import { WorkerLogService } from '../worker-logs/worker-log.service';
import { NotificationService } from '../notifications/notification.service';
import { alreadyProcessedWebhook, markWebhookProcessed } from '../../shared/webhooks/webhook-event.model';
import {
  classifyMonoWebhook,
  extractMandateId,
  extractDebitReferences,
  mapMonoMandateStatus,
} from '../../shared/providers/mono.status';
import { MonoProvider } from '../../shared/providers/mono.provider';

const logger = pino({ name: 'mono-webhook-controller' });
const WK = 'mono-webhook';

/** constant-time string compare that never throws on length mismatch */
function safeEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export class MonoWebhookController {
  /**
   * Verify Mono webhook authenticity.
   * Mono (Direct Debit) sends the dashboard "webhook secret" in the
   * `mono-webhook-secret` header. There is NO HMAC / body signature.
   *
   * FIX: previously this fell back to `MONO_SECRET_KEY` when
   * `MONO_WEBHOOK_SECRET` was unset — a value Mono never sends — so every
   * webhook 401'd in that misconfiguration and mandates never activated /
   * debits never reconciled. We now require the dedicated secret and use a
   * constant-time compare.
   */
  static verifySignature(req: Request, res: Response, next: Function) {
    const provided = String(req.headers['mono-webhook-secret'] || '');
    const secret = process.env.MONO_WEBHOOK_SECRET || '';

    if (!secret) {
      logger.error('MONO_WEBHOOK_SECRET is not configured — rejecting Mono webhook');
      WorkerLogService.log(WK, 'error', 'MONO_WEBHOOK_SECRET not configured — webhook rejected').catch(() => {});
      return res.status(401).json({ status: 'failed', message: 'Webhook not configured' });
    }

    if (!safeEqual(provided, secret)) {
      logger.warn('Invalid Mono webhook secret');
      return res.status(401).json({ status: 'failed', message: 'Unauthorized request' });
    }

    next();
  }

  static async handleWebhook(req: Request, res: Response) {
    const body = req.body || {};
    const event: string = body.event || body.type || '';
    const data = body.data || {};
    const eventId: string | undefined = body.event_id || body.id || undefined;
    const intent = classifyMonoWebhook(event);

    // ── Dedupe (Mono retries up to 25× over 48h with the same event_id) ──
    try {
      if (eventId && (await alreadyProcessedWebhook('mono', eventId))) {
        logger.info({ event, eventId }, 'Duplicate Mono webhook ignored');
        return res.status(200).send('OK (duplicate)');
      }
    } catch {
      /* fall through — per-operation idempotency still applies */
    }

    logger.info({ event, intent, eventId, mandate: extractMandateId(data) }, 'Mono webhook received');
    WorkerLogService.log(WK, 'info', `Mono webhook: ${event || 'unknown'}`, { intent, eventId }).catch(() => {});

    try {
      switch (intent) {
        case 'mandate.created':
          await MonoWebhookController.onMandateCreated(data);
          break;
        case 'mandate.approved':
          await MonoWebhookController.onMandateApproved(data);
          break;
        case 'mandate.ready':
        case 'mandate.reinstated':
          await MonoWebhookController.onMandateReady(data);
          break;
        case 'mandate.rejected':
          await MonoWebhookController.onMandateTerminal(data, 'rejected');
          break;
        case 'mandate.cancelled':
          await MonoWebhookController.onMandateTerminal(data, 'cancelled');
          break;
        case 'mandate.expired':
          await MonoWebhookController.onMandateTerminal(data, 'expired');
          break;
        case 'mandate.paused':
          await MonoWebhookController.onMandatePaused(data);
          break;
        case 'debit.processing':
          await MonoWebhookController.onDebitProcessing(data);
          break;
        case 'debit.successful':
          await MonoWebhookController.onDebitSuccessful(data);
          break;
        case 'debit.failed':
          await MonoWebhookController.onDebitFailed(data);
          break;
        default:
          logger.info({ event }, 'Unhandled Mono event');
      }

      await markWebhookProcessed('mono', eventId, event, body);
      return res.status(200).send('OK');
    } catch (err: any) {
      logger.error({ event, eventId, error: err.message, stack: err.stack }, 'Mono webhook processing failed');
      WorkerLogService.log(WK, 'error', `Mono webhook failed: ${event} — ${err.message}`, { eventId }).catch(() => {});
      // 5xx → Mono retries. The event is NOT marked processed and every
      // downstream operation here is idempotent, so a retry is safe.
      return res.status(500).send('Processing error');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Mandate lifecycle                                                  */
  /* ------------------------------------------------------------------ */

  private static async mandateRows(mandateId?: string) {
    if (!mandateId) return [];
    return AutoDebit.find({ token: mandateId, provider: 'mono' });
  }

  private static async onMandateCreated(data: any) {
    const mandateId = extractMandateId(data);
    if (!mandateId) return;
    const rows = await MonoWebhookController.mandateRows(mandateId);
    for (const row of rows) {
      if (['active', 'approved'].includes(row.status)) continue;
      row.status = 'pending';
      row.providerStatusRaw = String(data.status || 'initiated');
      row.providerAccountId = row.providerAccountId || data.account_id || data.account?._id || data.account?.id;
      row.lastSyncedAt = new Date();
      await row.save();
    }
    logger.info({ mandateId, rows: rows.length }, 'Mono mandate.created');
  }

  /**
   * `approved` means the customer completed the ₦50 NIBSS transfer — it does
   * NOT mean the account is debitable. We set 'approved' and re-check
   * ready-to-debit once (covers the race where `ready` fired first / arrives
   * bundled). The Phase-2 reconcile cron is the safety net.
   */
  private static async onMandateApproved(data: any) {
    const mandateId = extractMandateId(data);
    if (!mandateId) return;
    const rows = await MonoWebhookController.mandateRows(mandateId);

    let readyNow = false;
    let acctId: string | undefined;
    try {
      const status = await new MonoProvider().getMandateStatus(mandateId);
      readyNow = mapMonoMandateStatus(status).readyToDebit;
      acctId = status?.data?.account?._id || status?.data?.account?.id || status?.data?.account_id;
    } catch (e: any) {
      logger.warn({ mandateId, error: e.message }, 'Could not re-check mandate readiness on approved');
    }

    for (const row of rows) {
      if (row.status === 'active') continue;
      row.status = readyNow ? 'active' : 'approved';
      row.providerStatusRaw = readyNow ? 'ready' : 'approved';
      if (acctId) row.providerAccountId = acctId;
      row.lastSyncedAt = new Date();
      row.lastError = undefined;
      await row.save();
    }
    logger.info({ mandateId, readyNow, rows: rows.length }, 'Mono mandate.approved');
  }

  private static async onMandateReady(data: any) {
    const mandateId = extractMandateId(data);
    if (!mandateId) return;
    const rows = await MonoWebhookController.mandateRows(mandateId);
    for (const row of rows) {
      const wasActive = row.status === 'active';
      row.status = 'active';
      row.providerStatusRaw = 'ready';
      row.providerAccountId = row.providerAccountId || data.account_id || data.account?._id || data.account?.id;
      row.lastSyncedAt = new Date();
      row.lastError = undefined;
      await row.save();
      if (!wasActive) {
        await MonoWebhookController.notifyUser(row.userId, 'Your bank account is now linked for automatic loan repayments.');
      }
    }
    logger.info({ mandateId, rows: rows.length }, 'Mono mandate ready-to-debit');
  }

  private static async onMandateTerminal(data: any, localStatus: 'rejected' | 'cancelled' | 'expired') {
    const mandateId = extractMandateId(data);
    if (!mandateId) return;
    const rows = await MonoWebhookController.mandateRows(mandateId);
    for (const row of rows) {
      if (['revoked', 'cancelled', 'rejected', 'expired'].includes(row.status)) continue;
      row.status = localStatus;
      row.providerStatusRaw = localStatus;
      row.lastSyncedAt = new Date();
      await row.save();
      await MonoWebhookController.notifyUser(
        row.userId,
        localStatus === 'rejected'
          ? 'Your bank rejected the auto-debit setup. Please re-link your bank account in the app.'
          : `Your auto-debit mandate has been ${localStatus}. Automatic loan repayments are paused until you re-link your bank.`
      );
    }
    logger.info({ mandateId, localStatus, rows: rows.length }, 'Mono mandate terminal');
  }

  private static async onMandatePaused(data: any) {
    const mandateId = extractMandateId(data);
    if (!mandateId) return;
    await AutoDebit.updateMany(
      { token: mandateId, provider: 'mono', status: { $in: ['active', 'approved'] } },
      { $set: { status: 'pending', providerStatusRaw: 'paused', lastSyncedAt: new Date() } }
    );
    logger.info({ mandateId }, 'Mono mandate paused');
  }

  /* ------------------------------------------------------------------ */
  /*  Debit lifecycle                                                    */
  /* ------------------------------------------------------------------ */

  private static async findDebitLog(data: any) {
    const refs = extractDebitReferences(data);
    if (!refs.length) return null;
    return AutoDebitLog.findOne({
      $or: [
        { reference: { $in: refs } },
        { providerReference: { $in: refs } },
        { sessionId: { $in: refs } },
      ],
    });
  }

  private static async onDebitProcessing(data: any) {
    const log = await MonoWebhookController.findDebitLog(data);
    if (!log) {
      logger.warn({ refs: extractDebitReferences(data) }, 'Mono debit.processing: no matching log');
      return;
    }
    if (log.status === 'pending') {
      log.status = 'processing';
      log.providerReference = log.providerReference || data.reference_number;
      log.sessionId = log.sessionId || data.session_id;
      log.providerResponse = data;
      await log.save();
    }
  }

  private static async onDebitSuccessful(data: any) {
    const log = await MonoWebhookController.findDebitLog(data);
    const refs = extractDebitReferences(data);
    if (!log) {
      logger.warn({ refs }, 'Mono debit.successful: no matching AutoDebitLog — cannot reconcile');
      await WorkerLogService.log(WK, 'warn', 'Mono debit.successful with no matching log', { refs, data });
      return;
    }
    if (log.status === 'successful') {
      logger.info({ ref: log.reference }, 'Mono debit already settled — skip');
      return;
    }

    log.status = 'successful';
    log.providerReference = log.providerReference || data.reference_number;
    log.sessionId = log.sessionId || data.session_id;
    log.providerResponse = data;
    log.settledAt = new Date();
    await log.save();

    if (!log.loanId) {
      logger.warn({ ref: log.reference }, 'Mono debit successful but log has no loanId — nothing to reconcile');
      return;
    }

    try {
      await LoanService.repayLoan({
        loanId: String(log.loanId),
        userId: log.userId,
        amount: log.amount,
        idempotencyKey: `webhook-mono-${log.reference}`,
        skipBalanceCheck: true,
        autoDeduct: true,
        internalOnly: true,
      });
      logger.info({ ref: log.reference, amount: log.amount, loanId: log.loanId }, 'Mono debit reconciled to loan');
      await WorkerLogService.log(WK, 'info', `Mono debit settled: ₦${log.amount} on loan ${log.loanId}`, {
        reference: log.reference,
      });
      await MonoWebhookController.notifyUser(
        log.userId,
        `₦${log.amount.toLocaleString()} was automatically debited from your linked bank account for your loan repayment.`
      );
    } catch (err: any) {
      logger.error({ ref: log.reference, error: err.message }, 'Mono debit reconciliation failed');
      await WorkerLogService.log(WK, 'error', `Mono debit reconciliation failed: ${err.message}`, {
        reference: log.reference,
      });
      throw err; // let Mono retry
    }
  }

  private static async onDebitFailed(data: any) {
    const log = await MonoWebhookController.findDebitLog(data);
    if (!log) {
      logger.warn({ refs: extractDebitReferences(data) }, 'Mono debit.failed: no matching log');
      return;
    }

    // Legacy: rows written by the old cron were created as 'successful' and
    // repayLoan already ran optimistically. Detect that and reverse.
    const needsReversal = log.status === 'successful' && !log.settledAt && !!log.loanId && !log.reversedAt;

    log.status = 'failed';
    log.providerResponse = data;
    log.errorMessage = data.message || data.reason || `Mono debit failed (response_code ${data.response_code || 'n/a'})`;
    log.settledAt = new Date();
    await log.save();

    if (needsReversal) {
      try {
        await LoanService.reverseRepayment({
          loanId: String(log.loanId),
          userId: String(log.userId),
          amount: log.amount,
          reference: log.reference,
        });
        log.reversedAt = new Date();
        await log.save();
        logger.info({ ref: log.reference }, 'Mono debit failed — optimistic repayment reversed');
        await WorkerLogService.log(WK, 'info', `Mono optimistic repayment reversed: ₦${log.amount}`, {
          reference: log.reference,
        });
      } catch (err: any) {
        logger.error({ ref: log.reference, error: err.message }, 'Mono webhook reversal failed');
        await WorkerLogService.log(WK, 'error', `Mono reversal failed: ${err.message}`, { reference: log.reference });
        throw err;
      }
    } else {
      await WorkerLogService.log(WK, 'warn', `Mono debit failed: ${log.errorMessage}`, {
        reference: log.reference,
        loanId: log.loanId,
      });
      await MonoWebhookController.notifyUser(
        log.userId,
        'An automatic loan repayment from your bank account failed. Please make sure funds are available; we will retry.'
      );
    }
  }

  /* ------------------------------------------------------------------ */

  private static async notifyUser(userId: string, message: string) {
    try {
      const User = (await import('../users/user.model')).default;
      const user = await User.findById(userId).lean();
      const phone = (user as any)?.user_metadata?.phone || (user as any)?.phone;
      if (phone) await NotificationService.sendActionSms(String(phone), message);
    } catch {
      /* best effort */
    }
  }
}
