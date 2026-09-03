/**
 * Admin Auto-Debit Controller
 * ---------------------------
 * First-class admin surface for the auto-debit mandate (Issue C). Replaces the
 * opaque `POST /backoffice/test-integrations/auto-debit` button with:
 *
 *   GET  /backoffice/users/:userId/payment-methods        list + live Mono status
 *   GET  /backoffice/loans/:loanId/auto-debit/preview     what would be charged
 *   POST /backoffice/loans/:loanId/auto-debit/charge      real debit (logged + reconciled)
 *   POST /backoffice/loans/:loanId/auto-debit/refresh-mandate  force a Mono re-sync
 *   POST /backoffice/users/:userId/payment-methods/:id/cancel  admin disconnect (both ends)
 *   GET  /backoffice/loans/:loanId/bank-balance           user bank balance via Mono
 *
 * Everything routes through AutoDebitService so admin, cron and webhook share
 * one implementation and one Mono-status interpretation.
 */
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { AutoDebit } from './auto-debit.model';
import { AutoDebitService } from './auto-debit.service';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { RedisService } from '../../shared/cache/redis.service';
import { WorkerLogService } from '../worker-logs/worker-log.service';
import { checkPermission } from '../../shared/utils/checkPermission';

const logger = pino({ name: 'admin-auto-debit-controller' });

function adminId(req: Request): string {
  return String((req as any).admin?._id || (req as any).admin?.id || (req as any).user?._id || 'admin-system');
}

function requireView(req: Request) {
  checkPermission((req as any).admin, ['view_loans', 'manage_loans'], { throwOnFail: true });
}
function requireManage(req: Request) {
  checkPermission((req as any).admin, ['manage_loans'], { throwOnFail: true });
}

export class AdminAutoDebitController {
  /** GET /backoffice/users/:userId/payment-methods */
  static async listPaymentMethods(req: Request, res: Response, next: NextFunction) {
    try {
      requireView(req);
      const { userId } = req.params;
      const withLive = req.query.live !== 'false';
      const data = await AutoDebitService.listUserMethods(userId, { withLiveStatus: withLive });
      return res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  /** GET /backoffice/loans/:loanId/auto-debit/preview */
  static async preview(req: Request, res: Response, next: NextFunction) {
    try {
      requireView(req);
      const { loanId } = req.params;
      const Loan = (await import('./loan.model')).default;
      const loan = await Loan.findById(loanId).lean();
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

      const methods = await AutoDebit.find({ userId: String((loan as any).userId) });
      const usable = methods.filter((m) => ['active', 'approved', 'pending'].includes(m.status));

      // Pick the method the charge would actually use (card → bank → wallet).
      const card = usable.find((m) => m.type === 'card' && m.status === 'active');
      const bank = usable.find((m) => m.type === 'bank');
      const wallet = usable.find((m) => m.type === 'wallet' && m.status === 'active');
      let target = card || (bank && bank.status === 'active' ? bank : undefined) || wallet || bank || null;

      let bankReady: boolean | undefined;
      if (bank && bank.provider === 'mono') {
        try {
          const synced = await AutoDebitService.syncMonoMandate(bank);
          bankReady = synced.readyToDebit;
        } catch {
          bankReady = undefined;
        }
      }

      return res.status(200).json({
        status: 'success',
        data: {
          loanId,
          outstanding: Number((loan as any).outstanding || 0),
          loanStatus: (loan as any).status,
          paymentStatus: (loan as any).loan_payment_status,
          canCharge:
            ['accepted', 'processing'].includes(String((loan as any).status)) &&
            (loan as any).loan_payment_status !== 'complete' &&
            Number((loan as any).outstanding || 0) > 0 &&
            !!target,
          target: target && {
            id: target._id,
            type: target.type,
            provider: target.provider,
            status: target.status,
            bankName: target.bankName,
            accountNumber: target.accountNumber ? `****${String(target.accountNumber).slice(-4)}` : undefined,
            last4: target.last4,
            readyToDebit: target.type === 'bank' ? bankReady ?? target.status === 'active' : target.status === 'active',
            lastError: target.lastError,
          },
          methodCount: methods.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /** POST /backoffice/loans/:loanId/auto-debit/charge   body: { amount?, methodId? }
   *
   * A Mono direct debit can take 30-60s to return. That is longer than the
   * Vercel proxy timeout, so the admin used to get a 504 even though the debit
   * went through and reconciled via webhook. Now: a short foreground window for
   * fast outcomes (mandate-not-ready, sync failures, a quick settle), then hand
   * off to the background and return 202 - the `events.mandates.debit.*` webhook
   * settles the loan and the admin refreshes to see it. A per-loan lock + a
   * recent-pending-log check stop a double debit from an impatient second click.
   */
  static async charge(req: Request, res: Response, next: NextFunction) {
    try {
      requireManage(req);
      const { loanId } = req.params;
      const { amount, methodId } = req.body || {};

      const Loan = (await import('./loan.model')).default;
      const loan = await Loan.findById(loanId).lean();
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

      const { AutoDebitLog } = await import('./auto-debit-log.model');
      const recentPending = await AutoDebitLog.findOne({
        loanId, status: 'pending', createdAt: { $gte: new Date(Date.now() - 6 * 60 * 1000) },
      }).lean();
      if (recentPending) {
        return res.status(409).json({
          status: 'failed',
          message: `A debit for this loan is already in progress (ref ${recentPending.reference}). Wait for it to confirm before trying again.`,
        });
      }

      const lockKey = `mono:charge:lock:${loanId}`;
      try { if (await RedisService.get<any>(lockKey)) {
        return res.status(409).json({ status: 'failed', message: 'A debit for this loan is already being processed.' });
      } } catch { /* lock optional */ }
      try { await RedisService.set(lockKey, { at: Date.now() }, 150); } catch { /* noop */ }

      const chargePromise = AutoDebitService.chargeLoan({
        loanId,
        userId: String((loan as any).userId),
        amount: amount ? Number(amount) : undefined,
        methodId,
        source: 'admin',
        actorId: adminId(req),
      })
        .then(async (result) => {
          await WorkerLogService.log('auto-debit', result.accepted ? 'info' : 'warn',
            `Admin auto-debit on loan ${loanId}: ${result.accepted ? 'accepted' : 'no charge'} - ${result.attempts.map((a) => `${a.method}:${a.status}`).join(', ')}`,
            { adminId: adminId(req), loanId, amount: result.amount });
          return result;
        })
        .catch((e: any) => {
          logger.error({ error: e.message, loanId }, 'Admin auto-debit charge failed (background)');
          return { __error: e.message };
        })
        .finally(() => { RedisService.del(lockKey).catch(() => {}); });

      const winner: any = await Promise.race([
        chargePromise,
        new Promise((r) => setTimeout(() => r('__TIMEOUT__'), 5000)),
      ]);

      if (winner === '__TIMEOUT__') {
        return res.status(202).json({
          status: 'pending',
          message: 'Debit initiated. It confirms via Mono webhook, usually within a minute - refresh the loan shortly to see the result.',
        });
      }
      if (winner?.__error) {
        return res.status(502).json({ status: 'failed', message: winner.__error });
      }

      const result = winner;
      return res.status(200).json({
        status: 'completed',
        message: result.accepted
          ? (result.attempts.some((a: any) => a.status === 'settled')
            ? 'Debit completed'
            : 'Debit accepted, confirming with the bank')
          : (result.attempts[0]?.message || 'No charge could be made'),
        data: result,
        results: result.attempts,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin auto-debit charge failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /** POST /backoffice/loans/:loanId/auto-debit/refresh-mandate */
  static async refreshMandate(req: Request, res: Response, next: NextFunction) {
    try {
      requireManage(req);
      const { loanId } = req.params;
      const Loan = (await import('./loan.model')).default;
      const loan = await Loan.findById(loanId).lean();
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

      const rows = await AutoDebit.find({ userId: String((loan as any).userId), type: 'bank', provider: 'mono' });
      const out = [];
      for (const row of rows) {
        const synced = await AutoDebitService.syncMonoMandate(row);
        out.push({ id: row._id, status: synced.local, readyToDebit: synced.readyToDebit, providerStatus: row.providerStatusRaw });
      }
      return res.status(200).json({ status: 'success', data: out });
    } catch (err) {
      next(err);
    }
  }

  /** POST /backoffice/users/:userId/payment-methods/:id/cancel */
  static async cancelMethod(req: Request, res: Response, next: NextFunction) {
    try {
      requireManage(req);
      const { userId, id } = req.params;
      const row = await AutoDebit.findOne({ _id: id, userId: String(userId) });
      if (!row) return res.status(404).json({ status: 'failed', message: 'Payment method not found' });

      const result = await AutoDebitService.cancelMethod(row, {
        reason: `Admin disconnect (${adminId(req)})`,
        localStatus: 'revoked',
      });

      await WorkerLogService.log('auto-debit', 'info', `Admin disconnected ${row.provider} ${row.type} for user ${userId}`, {
        adminId: adminId(req),
        providerCancelled: result.providerCancelled,
      });

      return res.status(200).json({ status: 'success', message: result.message, data: { providerCancelled: result.providerCancelled } });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /backoffice/loans/:loanId/bank-balance?amount=<naira>   (Part 2 feature)
   *
   * Mono's balance endpoint (`/v3/payments/mandates/{id}/balance-inquiry`) is a
   * *sufficiency check* - it REQUIRES an amount and answers "can this account
   * cover ₦X?" (it may also echo the real balance). We test against `?amount=`
   * if given, otherwise the loan's current outstanding. Mono bills a small fee
   * per call, so the result is cached 60s and every call is logged.
   */
  static async bankBalance(req: Request, res: Response, next: NextFunction) {
    try {
      requireView(req);
      const { loanId } = req.params;
      const Loan = (await import('./loan.model')).default;
      const loan = await Loan.findById(loanId).lean();
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

      const outstanding = Number((loan as any).outstanding || 0);
      const testAmount = Math.max(1000, Number(req.query.amount) || outstanding || 1000);

      const userId = String((loan as any).userId);
      const mandate = await AutoDebit.findOne({
        userId,
        type: 'bank',
        provider: 'mono',
        status: { $in: ['active', 'approved'] },
      }).sort({ createdAt: -1 });

      if (!mandate) {
        return res.status(404).json({
          status: 'failed',
          message: 'This user has no active Mono mandate. A bank balance check needs an active bank link.',
        });
      }

      const mandateToken = mandate.token as string;
      const cacheKey = `mono:balance:${mandateToken}:${testAmount}`;
      const jobKey = `mono:balance:job:${mandateToken}:${testAmount}`;

      const buildPayload = (bal: any) => ({
        balance: bal.balance,
        sufficient: bal.sufficient,
        testedAmount: bal.testedAmount ?? testAmount,
        currency: bal.currency || 'NGN',
        accountName: mandate.accountName,
        accountNumber: mandate.accountNumber && mandate.accountNumber !== 'mono-mandate'
          ? `****${String(mandate.accountNumber).slice(-4)}` : undefined,
        bankName: mandate.bankName,
        mandateId: mandateToken,
        asOf: new Date().toISOString(),
        source: 'mono',
        note: bal.balance === null
          ? `Mono reported ${bal.sufficient ? 'sufficient' : 'insufficient'} funds for ₦${testAmount.toLocaleString()} — it did not return an exact figure.`
          : bal.balance === 0 ? 'Mono returns ₦0 when the real balance is below the NGN 1,000 NIBSS floor.' : undefined,
      });

      // 1. Cached result?
      try {
        const cached = await RedisService.get<any>(cacheKey);
        if (cached) return res.status(200).json({ status: 'success', data: { ...cached, cached: true } });
      } catch { /* cache optional */ }

      // 2. A background inquiry may already be running from a previous click.
      let jobRunning = false;
      try { jobRunning = !!(await RedisService.get<any>(jobKey)); } catch { /* noop */ }

      if (!jobRunning) {
        // 3. Kick off the (slow, billed) inquiry in the BACKGROUND. NIBSS checks
        //    can take >60s, which exceeds the Vercel proxy timeout, so we never
        //    block the request on it. The result lands in cache; the admin UI
        //    re-requests and gets the cached answer.
        try { await RedisService.set(jobKey, { startedAt: Date.now() }, 130); } catch { /* noop */ }
        void (async () => {
          try {
            const bal = await new MonoProvider().getMandateBalance(mandateToken, testAmount);
            await RedisService.set(cacheKey, buildPayload(bal), 300).catch(() => {});
            await WorkerLogService.log('auto-debit', 'info',
              `Bank balance inquiry completed for user ${userId} (loan ${loanId})`,
              { adminId: adminId(req), mandateId: mandateToken, balance: bal.balance, sufficient: bal.sufficient });
          } catch (e: any) {
            await RedisService.set(cacheKey, {
              error: true, message: e.timedOut
                ? 'The bank did not respond to the balance check in time. Try again in a moment.'
                : (e.message || 'Balance inquiry failed'),
              mandateId: mandateToken, asOf: new Date().toISOString(),
            }, 60).catch(() => {});
          } finally {
            await RedisService.del(jobKey).catch(() => {});
          }
        })();
      }

      // 4. Very short head start only (the Vercel proxy times out ~10s). If the
      //    cache is not populated by then, return 202 and let the admin UI
      //    re-request for the cached answer.
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const done = await RedisService.get<any>(cacheKey);
          if (done) {
            if (done.error) return res.status(502).json({ status: 'failed', message: done.message });
            return res.status(200).json({ status: 'success', data: done });
          }
        } catch { /* noop */ }
      }

      return res.status(202).json({
        status: 'pending',
        message: 'Checking the balance with the bank. This can take up to two minutes - click again shortly.',
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin bank balance check failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }
}
