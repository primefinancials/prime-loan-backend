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

  /** POST /backoffice/loans/:loanId/auto-debit/charge   body: { amount?, methodId? } */
  static async charge(req: Request, res: Response, next: NextFunction) {
    try {
      requireManage(req);
      const { loanId } = req.params;
      const { amount, methodId } = req.body || {};

      const Loan = (await import('./loan.model')).default;
      const loan = await Loan.findById(loanId).lean();
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

      const result = await AutoDebitService.chargeLoan({
        loanId,
        userId: String((loan as any).userId),
        amount: amount ? Number(amount) : undefined,
        methodId,
        source: 'admin',
        actorId: adminId(req),
      });

      await WorkerLogService.log('auto-debit', result.accepted ? 'info' : 'warn',
        `Admin auto-debit on loan ${loanId}: ${result.accepted ? 'accepted' : 'no charge'} — ${result.attempts.map((a) => `${a.method}:${a.status}`).join(', ')}`,
        { adminId: adminId(req), loanId, amount: result.amount });

      // 200 with the state machine; the UI renders per-attempt, not red/green.
      return res.status(200).json({
        status: 'completed',
        message: result.accepted
          ? result.attempts.some((a) => a.status === 'settled')
            ? 'Debit completed'
            : 'Debit accepted — awaiting bank confirmation'
          : 'No charge could be made',
        data: result,
        results: result.attempts, // back-compat with the old admin UI shape
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
   * GET /backoffice/loans/:loanId/bank-balance   (Part 2 feature)
   * Real-time bank balance for the user's active Mono mandate. Mono charges a
   * per-call fee, so the result is cached 60s and every call is logged.
   */
  static async bankBalance(req: Request, res: Response, next: NextFunction) {
    try {
      requireView(req);
      const { loanId } = req.params;
      const Loan = (await import('./loan.model')).default;
      const loan = await Loan.findById(loanId).lean();
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

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

      const cacheKey = `mono:balance:${mandate.token}`;
      try {
        const cached = await RedisService.get<any>(cacheKey);
        if (cached) {
          return res.status(200).json({ status: 'success', data: { ...cached, cached: true } });
        }
      } catch {
        /* cache optional */
      }

      const provider = new MonoProvider();
      const bal = await provider.getMandateBalance(mandate.token);

      const payload = {
        balance: bal.balance,
        currency: bal.currency || 'NGN',
        accountName: mandate.accountName,
        accountNumber: mandate.accountNumber ? `****${String(mandate.accountNumber).slice(-4)}` : undefined,
        bankName: mandate.bankName,
        mandateId: mandate.token,
        asOf: new Date().toISOString(),
        source: 'mono',
        note: bal.balance === 0 ? 'Mono returns ₦0 when the real balance is below ₦1,000.' : undefined,
      };

      try {
        await RedisService.set(cacheKey, payload, 60);
      } catch {
        /* cache optional */
      }

      await WorkerLogService.log('auto-debit', 'info', `Admin viewed bank balance for user ${userId} (loan ${loanId})`, {
        adminId: adminId(req),
        mandateId: mandate.token,
      });

      return res.status(200).json({ status: 'success', data: payload });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin bank balance check failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }
}
