/**
 * AutoDebitService — the single entry point for everything that touches a
 * user's linked auto-debit methods and for actually charging a loan.
 *
 * Used by:
 *   - the repayment cron (workers/loans/penaltiesCron.ts)
 *   - the admin auto-debit controller (manual "charge now" / disconnect)
 *   - the user link/unlink controller (auto-debit.controller.ts)
 *   - the reconciliation cron (workers/loans/monoReconcileCron.ts)
 *
 * Design goals:
 *   1. ONE interpretation of Mono mandate status (via mapMonoMandateStatus).
 *   2. Every debit attempt is written to AutoDebitLog BEFORE the provider call,
 *      as `pending`. Only a provider webhook / the reconcile cron moves it to
 *      `successful` (→ loan reconciliation) or `failed`. Synchronous providers
 *      (Flutterwave card) settle inline.
 *   3. Cancelling / disconnecting always propagates to the provider (Mono
 *      `cancelMandate`) as well as the local row.
 */
import pino from 'pino';
import mongoose from 'mongoose';
import { AutoDebit, IAutoDebit } from './auto-debit.model';
import { AutoDebitLog } from './auto-debit-log.model';
import { LoanService } from './loan.service';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { mapMonoMandateStatus, LocalMandateStatus } from '../../shared/providers/mono.status';
import { WorkerLogService } from '../worker-logs/worker-log.service';

const logger = pino({ name: 'auto-debit-service' });

export type ChargeSource = 'cron' | 'admin' | 'user' | 'webhook' | 'reconcile';

export interface ChargeLoanParams {
  loanId: string;
  userId: string;
  amount?: number;              // Naira; defaults to full outstanding
  methodId?: string;            // force a specific AutoDebit row
  source: ChargeSource;
  actorId?: string;             // admin id when source === 'admin'
}

export interface ChargeAttemptResult {
  method: 'card' | 'bank' | 'wallet' | null;
  provider?: string;
  status: 'settled' | 'pending' | 'failed' | 'skipped';
  reference?: string;
  message: string;
  data?: any;
}

export interface ChargeLoanResult {
  ok: boolean;
  loanId: string;
  amount: number;
  attempts: ChargeAttemptResult[];
  /** true if any attempt settled (card) or is pending confirmation (bank/wallet) */
  accepted: boolean;
}

const MONO_RETRYABLE_MONO_STATUSES: LocalMandateStatus[] = ['pending', 'approved', 'initiating'];

export class AutoDebitService {
  /* ------------------------------------------------------------------ */
  /*  Mandate sync / cancel                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Refresh a Mono mandate row against Mono and persist the mapped status.
   * Returns the mapped status. Non-Mono rows are returned unchanged.
   */
  static async syncMonoMandate(row: IAutoDebit): Promise<{ local: LocalMandateStatus; readyToDebit: boolean; raw?: any }> {
    if (row.provider !== 'mono' || !row.token) {
      return { local: row.status as LocalMandateStatus, readyToDebit: row.status === 'active' };
    }
    try {
      const res = await new MonoProvider().getMandateStatus(row.token);
      const mapped = mapMonoMandateStatus(res);
      const acctId = res?.data?.account?._id || res?.data?.account?.id || res?.data?.account_id;

      // Never downgrade a terminal local state that a webhook already set,
      // but always accept forward progress and terminal states from Mono.
      row.providerStatusRaw = mapped.raw;
      row.lastSyncedAt = new Date();
      if (acctId) row.providerAccountId = acctId;

      const localTerminal = ['revoked', 'cancelled', 'rejected', 'expired', 'failed'].includes(row.status);
      if (!localTerminal || mapped.terminal) {
        row.status = mapped.local === 'active' ? 'active' : mapped.local;
      }
      await row.save();
      return { local: row.status as LocalMandateStatus, readyToDebit: mapped.readyToDebit, raw: res };
    } catch (err: any) {
      if (err?.notFound) {
        row.status = 'cancelled';
        row.providerStatusRaw = 'not_found';
        row.lastError = 'Mandate not found on Mono';
        row.lastSyncedAt = new Date();
        await row.save();
        return { local: 'cancelled', readyToDebit: false };
      }
      logger.warn({ mandateId: row.token, error: err.message }, 'syncMonoMandate failed');
      return { local: row.status as LocalMandateStatus, readyToDebit: row.status === 'active' };
    }
  }

  /**
   * Cancel/disconnect a linked method. For Mono this cancels the mandate on
   * Mono's side too, so a "disconnect" here is a disconnect everywhere.
   */
  static async cancelMethod(
    row: IAutoDebit,
    opts: { reason?: string; localStatus?: 'revoked' | 'cancelled' } = {}
  ): Promise<{ ok: boolean; providerCancelled: boolean; message: string }> {
    let providerCancelled = false;
    let message = 'Method removed';

    if (row.provider === 'mono' && row.token) {
      try {
        const res = await new MonoProvider().cancelMandate(row.token);
        providerCancelled = res.ok;
        message = 'Mandate cancelled on Mono and removed';
      } catch (err: any) {
        message = `Removed locally; Mono cancellation failed: ${err.message}`;
        logger.error({ mandateId: row.token, error: err.message }, 'Mono cancelMandate failed during disconnect');
        await WorkerLogService.log('auto-debit', 'error', `Mono cancel failed for mandate ${row.token}: ${err.message}`, {
          userId: row.userId,
        });
      }
    } else if (row.provider === 'monnify' && row.token) {
      // Monnify has no cancel API wired; local revoke only.
      message = 'Method removed (Monnify mandate must be cancelled by the customer at their bank)';
    }

    row.status = opts.localStatus || 'revoked';
    row.lastError = opts.reason;
    row.lastSyncedAt = new Date();
    await row.save();

    return { ok: true, providerCancelled, message };
  }

  /* ------------------------------------------------------------------ */
  /*  Charging a loan                                                    */
  /* ------------------------------------------------------------------ */

  private static pickMethods(rows: IAutoDebit[], methodId?: string) {
    if (methodId) {
      const only = rows.find((r) => String(r._id) === String(methodId));
      return { card: only?.type === 'card' ? only : undefined, bank: only?.type === 'bank' ? only : undefined, wallet: only?.type === 'wallet' ? only : undefined };
    }
    return {
      card: rows.find((r) => r.type === 'card' && r.status === 'active'),
      bank: rows.find((r) => r.type === 'bank'),
      wallet: rows.find((r) => r.type === 'wallet' && r.status === 'active'),
    };
  }

  static async chargeLoan(params: ChargeLoanParams): Promise<ChargeLoanResult> {
    const Loan = (await import('./loan.model')).default;
    const loan = await Loan.findById(params.loanId);
    if (!loan) throw new Error('Loan not found');

    const outstanding = Number(loan.outstanding || 0);
    if (loan.loan_payment_status === 'complete' || outstanding <= 0) {
      return { ok: true, loanId: params.loanId, amount: 0, attempts: [{ method: null, status: 'skipped', message: 'Loan already fully repaid' }], accepted: false };
    }
    if (!['accepted', 'processing'].includes(String(loan.status))) {
      return { ok: false, loanId: params.loanId, amount: 0, attempts: [{ method: null, status: 'skipped', message: `Loan status is ${loan.status}` }], accepted: false };
    }

    const amount = Math.min(Number(params.amount) > 0 ? Number(params.amount) : outstanding, outstanding);

    const rows = await AutoDebit.find({
      userId: String(params.userId),
      status: { $in: ['active', 'approved', 'pending'] },
    });
    if (!rows.length) {
      return { ok: false, loanId: params.loanId, amount, attempts: [{ method: null, status: 'skipped', message: 'User has no linked auto-debit method' }], accepted: false };
    }

    let { card, bank, wallet } = AutoDebitService.pickMethods(rows, params.methodId);

    // Bank (Mono/Monnify) must be confirmed debitable. Sync once if not active.
    if (bank && bank.status !== 'active') {
      if (bank.provider === 'mono') {
        const synced = await AutoDebitService.syncMonoMandate(bank);
        if (!synced.readyToDebit) {
          const attempt: ChargeAttemptResult = {
            method: 'bank', provider: 'mono', status: 'skipped',
            message: `Mono mandate not ready to debit (status: ${synced.local})`,
          };
          bank = undefined;
          if (!card && !wallet) {
            return { ok: false, loanId: params.loanId, amount, attempts: [attempt], accepted: false };
          }
        }
      } else {
        bank = undefined;
      }
    }

    const firstName = 'Prime';
    const lastName = 'User';
    const attempts: ChargeAttemptResult[] = [];
    let accepted = false;

    const baseRef = `AD${params.source.slice(0, 2).toUpperCase()}${Date.now()}${String(loan._id).slice(-4)}`;

    // ── 1. Card (Flutterwave) — synchronous ──
    if (!accepted && card && card.token) {
      const ref = `${baseRef}C`;
      const log = await AutoDebitLog.create({
        userId: String(params.userId), loanId: String(loan._id), type: 'card', amount, reference: ref,
        token: card.token, provider: card.provider || 'flutterwave', source: params.source, actorId: params.actorId,
        narration: 'Prime Loan auto-debit (card)', status: 'pending',
      });
      try {
        const { FlutterwaveDebitProvider } = await import('../../shared/providers/flutterwave-debit.provider');
        const result: any = await new FlutterwaveDebitProvider().chargeToken({
          token: card.token, email: card.email || '', amount, txRef: ref, firstName, lastName,
          redirectUrl: 'https://primefinance.live',
        });
        const ok = result?.data?.status === 'successful';
        log.providerResponse = result;
        if (ok) {
          log.status = 'successful';
          log.settledAt = new Date();
          await log.save();
          await AutoDebitService.reconcile(log._id as any);
          accepted = true;
          attempts.push({ method: 'card', provider: 'flutterwave', status: 'settled', reference: ref, message: `₦${amount} debited from card`, data: result });
        } else {
          log.status = 'failed';
          log.errorMessage = result?.data?.processor_response || result?.message || 'Card charge not successful';
          log.settledAt = new Date();
          await log.save();
          attempts.push({ method: 'card', provider: 'flutterwave', status: 'failed', reference: ref, message: log.errorMessage as string, data: result });
        }
      } catch (err: any) {
        log.status = 'failed';
        log.errorMessage = err.message;
        log.settledAt = new Date();
        await log.save();
        attempts.push({ method: 'card', provider: 'flutterwave', status: 'failed', reference: ref, message: err.message });
      }
    }

    // ── 2. Bank (Mono / Monnify) — asynchronous: log stays pending, webhook settles ──
    if (!accepted && bank && bank.token) {
      const ref = `${baseRef}B`;
      const log = await AutoDebitLog.create({
        userId: String(params.userId), loanId: String(loan._id), type: 'bank', amount, reference: ref,
        token: bank.token, mandateId: bank.token, provider: bank.provider || 'mono',
        source: params.source, actorId: params.actorId, narration: `Prime Loan repayment ${loan._id}`, status: 'pending',
      });
      try {
        if (bank.provider === 'mono') {
          const res = await new MonoProvider().chargeAccount({
            accountId: bank.token, amount, reference: ref, narration: `Prime Loan repayment ${loan._id}`,
          });
          log.providerReference = res.providerReference;
          log.sessionId = res.sessionId;
          log.providerResponse = res.raw;
          if (res.accepted) {
            await log.save();
            accepted = true;
            attempts.push({ method: 'bank', provider: 'mono', status: 'pending', reference: ref, message: 'Mono debit accepted — awaiting confirmation webhook', data: res.raw });
          } else {
            log.status = 'failed';
            log.errorMessage = 'Mono did not accept the debit';
            log.settledAt = new Date();
            await log.save();
            attempts.push({ method: 'bank', provider: 'mono', status: 'failed', reference: ref, message: log.errorMessage as string, data: res.raw });
          }
        } else if (bank.provider === 'monnify') {
          const { MonnifyProvider } = await import('../../shared/providers/monnify.provider');
          const result: any = await new MonnifyProvider().debitMandate({
            mandateCode: bank.token, amount, reference: ref, narration: `Prime Loan repayment ${loan._id}`,
          });
          log.providerResponse = result;
          const ok = result?.requestSuccessful === true || result?.responseCode === '0' || result?.responseBody?.transactionStatus === 'PAID';
          if (ok) {
            // Monnify settlement confirmation arrives via its webhook; keep pending.
            await log.save();
            accepted = true;
            attempts.push({ method: 'bank', provider: 'monnify', status: 'pending', reference: ref, message: 'Monnify debit accepted — awaiting confirmation', data: result });
          } else {
            log.status = 'failed';
            log.errorMessage = result?.responseMessage || 'Monnify debit failed';
            log.settledAt = new Date();
            await log.save();
            attempts.push({ method: 'bank', provider: 'monnify', status: 'failed', reference: ref, message: log.errorMessage as string, data: result });
          }
        } else {
          log.status = 'failed';
          log.errorMessage = `Unsupported bank provider: ${bank.provider}`;
          await log.save();
          attempts.push({ method: 'bank', provider: bank.provider, status: 'failed', reference: ref, message: log.errorMessage as string });
        }
      } catch (err: any) {
        log.status = 'failed';
        log.errorMessage = err.message;
        log.settledAt = new Date();
        await log.save();
        if (bank) { bank.lastError = err.message; await bank.save(); }
        attempts.push({ method: 'bank', provider: bank?.provider, status: 'failed', reference: ref, message: err.message });
      }
    }

    // ── 3. Fintech wallet (OPay / Monnify) — asynchronous ──
    if (!accepted && wallet && wallet.token) {
      const ref = `${baseRef}W`;
      const log = await AutoDebitLog.create({
        userId: String(params.userId), loanId: String(loan._id), type: 'wallet', amount, reference: ref,
        token: wallet.token, provider: wallet.provider || 'opay', source: params.source, actorId: params.actorId,
        narration: `Prime Loan repayment ${loan._id}`, status: 'pending',
      });
      try {
        let result: any;
        if (wallet.provider === 'opay') {
          const { OPayProvider } = await import('../../shared/providers/opay.provider');
          result = await new OPayProvider().chargeWallet({ token: wallet.token, amount, reference: ref, phone: (wallet as any).walletPhone });
        } else if (wallet.provider === 'monnify') {
          const { MonnifyProvider } = await import('../../shared/providers/monnify.provider');
          result = await new MonnifyProvider().debitMandate({ mandateCode: wallet.token, amount, reference: ref, narration: `Prime Loan repayment ${loan._id}` });
        }
        log.providerResponse = result;
        const ok = result?.status === 'successful' || result?.data?.status === 'successful' || result?.responseCode === '0' || result?.status === 'SUCCESS';
        if (ok) {
          await log.save();
          accepted = true;
          attempts.push({ method: 'wallet', provider: wallet.provider, status: 'pending', reference: ref, message: 'Wallet debit accepted — awaiting confirmation', data: result });
        } else {
          log.status = 'failed';
          log.errorMessage = result?.message || 'Wallet debit failed';
          log.settledAt = new Date();
          await log.save();
          attempts.push({ method: 'wallet', provider: wallet.provider, status: 'failed', reference: ref, message: log.errorMessage as string, data: result });
        }
      } catch (err: any) {
        log.status = 'failed';
        log.errorMessage = err.message;
        log.settledAt = new Date();
        await log.save();
        attempts.push({ method: 'wallet', provider: wallet?.provider, status: 'failed', reference: ref, message: err.message });
      }
    }

    if (!attempts.length) {
      attempts.push({ method: null, status: 'skipped', message: 'No usable payment method (card inactive, bank mandate not ready, no wallet)' });
    }

    return { ok: accepted, loanId: params.loanId, amount, attempts, accepted };
  }

  /**
   * Move a settled AutoDebitLog into the loan ledger. THE single place this
   * happens — called from the card path (inline), the Mono webhook and the
   * reconcile cron. Idempotent two ways: `log.reconciledAt` is checked first
   * (so a genuine duplicate never even calls repayLoan), and repayLoan itself
   * dedupes on `ext-debit-${reference}`.
   */
  static async reconcile(logId: string | mongoose.Types.ObjectId): Promise<void> {
    const log = await AutoDebitLog.findById(logId);
    if (!log || log.status !== 'successful' || !log.loanId) return;
    if (log.reconciledAt) {
      logger.info({ reference: log.reference }, 'AutoDebit already reconciled — skip');
      return;
    }
    try {
      await LoanService.repayLoan({
        loanId: String(log.loanId),
        userId: log.userId,
        amount: log.amount,
        idempotencyKey: `ext-debit-${log.reference}`,
        skipBalanceCheck: true,
        autoDeduct: true,
        internalOnly: true,
      });
      log.reconciledAt = new Date();
      await log.save();
      logger.info({ reference: log.reference, amount: log.amount, loanId: log.loanId }, 'AutoDebit reconciled to loan');
    } catch (err: any) {
      logger.error({ reference: log.reference, error: err.message }, 'AutoDebit reconcile failed');
      await WorkerLogService.log('auto-debit', 'error', `Reconcile failed for ${log.reference}: ${err.message}`, { loanId: log.loanId });
      throw err;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Read helpers (admin panel)                                         */
  /* ------------------------------------------------------------------ */

  static async listUserMethods(userId: string, opts: { withLiveStatus?: boolean } = {}) {
    const rows = await AutoDebit.find({ userId: String(userId) }).sort({ createdAt: -1 });
    const out: any[] = [];
    for (const row of rows) {
      const base: any = {
        id: row._id,
        type: row.type,
        provider: row.provider,
        status: row.status,
        bankName: row.bankName,
        accountNumber: row.accountNumber ? `****${String(row.accountNumber).slice(-4)}` : undefined,
        last4: row.last4,
        cardBrand: row.cardBrand,
        providerStatusRaw: row.providerStatusRaw,
        lastSyncedAt: row.lastSyncedAt,
        lastError: row.lastError,
        createdAt: row.createdAt,
      };
      if (opts.withLiveStatus && row.provider === 'mono' && row.token && !['revoked', 'cancelled', 'rejected', 'expired'].includes(row.status)) {
        try {
          const synced = await AutoDebitService.syncMonoMandate(row);
          base.status = synced.local;
          base.readyToDebit = synced.readyToDebit;
          base.liveStatus = synced.raw?.data?.status || synced.local;
        } catch {
          base.liveStatus = 'unavailable';
        }
      }
      out.push(base);
    }
    const recentLogs = await AutoDebitLog.find({ userId: String(userId) }).sort({ createdAt: -1 }).limit(10).lean();
    return { methods: out, recentAttempts: recentLogs };
  }
}
