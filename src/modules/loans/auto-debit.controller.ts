/**
 * Auto-Debit Controller — Handles Flutterwave card/bank linking and querying
 */
import { Request, Response, NextFunction } from 'express';
import { AutoDebit } from './auto-debit.model';
import { FlutterwaveDebitProvider } from '../../shared/providers/flutterwave-debit.provider';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { MonnifyProvider } from '../../shared/providers/monnify.provider';
import { AutoDebitService } from './auto-debit.service';
import { mapMonoMandateStatus } from '../../shared/providers/mono.status';
import { LoanEligibilityService } from './loan-eligibility';
import { UserService } from '../users/user.service';
import pino from 'pino';
import { BadRequestError } from '../../exceptions';

const logger = pino({ name: 'auto-debit-controller' });

/**
 * Shared bank-account eligibility check used by BOTH `checkAccount` (pre-flight)
 * and `initiateBankMono` (at initiation), so the two can never disagree about
 * whether an account may be linked.
 *
 * Returns `{ allowed: true }` or `{ allowed: false, message }`. When a stale
 * non-active Mono mandate is in the way it is proactively cancelled so the user
 * is never dead-ended (Issue A).
 */
async function evaluateBankLink(params: {
  userId: string;
  accountNumber?: string;
  bvn?: string;
}): Promise<{ allowed: boolean; message?: string; replaceable?: any[] }> {
  const { userId, accountNumber, bvn } = params;
  const replaceable: any[] = [];

  if (accountNumber) {
    const existing = await AutoDebit.find({ accountNumber, type: 'bank' });
    for (const m of existing) {
      if (m.userId !== String(userId)) {
        return { allowed: false, message: 'This account is linked to a different Prime profile.' };
      }
      if (m.status === 'active') {
        return { allowed: false, message: "You've already linked this account. Continue with the existing link." };
      }
      if (['revoked', 'cancelled', 'rejected', 'expired', 'failed', 'initiating'].includes(m.status)) {
        replaceable.push(m);
        continue;
      }
      // status is 'pending' or 'approved' — check the real state on the provider.
      if (m.provider === 'mono' && m.token) {
        try {
          const synced = await AutoDebitService.syncMonoMandate(m);
          if (synced.readyToDebit) {
            return { allowed: false, message: 'This account already has an active auto-debit mandate.' };
          }
          replaceable.push(m); // not ready → user may replace it
        } catch (err: any) {
          logger.warn({ error: err.message }, 'evaluateBankLink: Mono sync failed — allowing replace');
          replaceable.push(m);
        }
      } else {
        replaceable.push(m);
      }
    }
  }

  if (bvn) {
    const User = (await import('../users/user.model')).default;
    const dupUsers = await User.find({ 'user_metadata.bvn': bvn, _id: { $ne: userId } }).select('_id');
    if (dupUsers.length) {
      const dupIds = dupUsers.map((u: any) => String(u._id));
      const dupMandate = await AutoDebit.findOne({
        userId: { $in: dupIds },
        type: 'bank',
        status: { $in: ['active', 'approved', 'pending'] },
      });
      if (dupMandate) {
        return { allowed: false, message: 'This BVN is already linked to an auto-debit mandate on another profile.' };
      }
    }
  }

  return { allowed: true, replaceable };
}

export class AutoDebitController {

  /**
   * POST /api/loans/link-bank/check-account
   * Validates account number and BVN uniqueness before initiating linking
   */
  static async checkAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const { accountNumber } = req.body;
      const user = (req as any).user;
      const userId = user._id || user.id;

      if (!accountNumber) {
        return res.status(400).json({ status: 'failed', message: 'accountNumber is required' });
      }

      const result = await evaluateBankLink({
        userId: String(userId),
        accountNumber,
        bvn: user.user_metadata?.bvn,
      });

      if (!result.allowed) {
        return res.status(400).json({ status: 'failed', message: result.message });
      }

      return res.status(200).json({ status: 'success', message: 'Account checks passed', data: { allowed: true } });
    } catch (err) { next(err); }
  }

  /**
   * POST /api/loans/link-card
   * Extracts token from Flutterwave txRef after the widget handles the charge.
   */
  static async linkCard(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { txRef } = req.body;

      if (!txRef) {
        return res.status(400).json({ status: 'failed', message: 'txRef is required' });
      }

      const provider = new FlutterwaveDebitProvider();
      
      const txData = await provider.verifyTransaction(txRef);
      const card = txData.card;
      
      if (card?.token) {
         await AutoDebit.deleteMany(
           { userId: String(userId), type: 'card' }
         );

         const autoDebit = await AutoDebit.create({
           userId: String(userId),
           type: 'card',
           token: card.token,
           email: txData.customer?.email || '',
           last4: card.last_4digits || card.last4 || '',
           cardBrand: card.type || card.brand || '',
           expMonth: card.expiry?.split('/')[0]?.trim() || '',
           expYear: card.expiry?.split('/')[1]?.trim() || '',
           status: 'active',
         });

         return res.status(201).json({
           status: 'success',
           data: {
             id: autoDebit._id,
             type: 'card',
             last4: autoDebit.last4,
             cardBrand: autoDebit.cardBrand,
             status: 'active',
           },
         });
      }

      return res.status(400).json({ status: 'failed', message: 'No valid card token found in transaction.' });
    } catch (err) { next(err); }
  }

  /**
   * POST /api/loans/link-bank/initiate
   * Step 1: Initiates the Flutterwave E-mandate (debit_ng_account)
   * Body: { accountNumber, bankCode }
   */
  static async linkBankInitiate(req: Request, res: Response, next: NextFunction) {
    try {
      const { accountNumber, bankCode } = req.body;
      const userId = (req as any).user._id || (req as any).user.id;
      const email = (req as any).user.email || 'user@example.com';

      if (!accountNumber || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'accountNumber and bankCode are required' });
      }

      const txRef = `mandate-${userId}-${Date.now()}`;
      const provider = new FlutterwaveDebitProvider();
      
      const frontendUrl = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://prime-loan-web-v2-staging.vercel.app';
      const redirectUrl = `${frontendUrl}/loans/callback`;

      const result = await provider.initiateDirectDebit({
        accountNumber,
        bankCode,
        email,
        amount: 50,
        txRef,
        narration: 'Account Validation for Auto-Debit',
        redirectUrl
      });

      const meta = result?.meta;
      const authorization = meta?.authorization;
      
      if (authorization?.mode === 'redirect' && authorization?.redirect) {
        return res.status(200).json({
          status: 'success',
          message: 'Redirect required for bank login',
          data: {
            mode: 'redirect',
            authUrl: authorization.redirect,
            flwRef: result?.data?.flw_ref || result?.data?.id,
            txRef
          }
        });
      }

      // Default to OTP mode
      return res.status(200).json({
        status: 'success',
        message: 'OTP sent to your registered bank phone number',
        data: {
          mode: 'otp',
          flwRef: result?.data?.flw_ref || result?.data?.id,
          txRef
        }
      });
    } catch (err: any) { 
      if (err.message && err.message.includes('failed')) {
        return res.status(400).json({ status: 'failed', message: err.message });
      }
      next(err); 
    }
  }

  /**
   * POST /api/loans/link-bank/authorize
   * Step 2: Submits OTP to validate the charge and save the mandate
   * Body: { flwRef, otp, txRef }
   */
  static async linkBankAuthorize(req: Request, res: Response, next: NextFunction) {
    try {
      const { flwRef, otp, txRef } = req.body;
      const userId = (req as any).user._id || (req as any).user.id;
      const email = (req as any).user.email || 'user@example.com';

      if (!flwRef || !otp) {
        return res.status(400).json({ status: 'failed', message: 'flwRef and otp are required' });
      }

      const provider = new FlutterwaveDebitProvider();
      const txData = await provider.validateCharge(flwRef, otp);

      // We assume the charge was successful if validateCharge passes.
      // Bank mandate token is often the flw_ref
      const token = txData?.data?.flw_ref || flwRef;

      // Revoke old bank mandates
      await AutoDebit.deleteMany(
         { userId: String(userId), type: "bank" }
      );

      const autoDebit = await AutoDebit.create({
         userId: String(userId),
         type: "bank",
         provider: "flutterwave",
         token: token,
         email: txData?.data?.customer?.email || email,
         bankName: txData?.data?.account?.bank_name || 'Bank',
         bankCode: txData?.data?.account?.bank_code || '000',
         accountNumber: txData?.data?.account?.account_number || '0000000000',
         accountName: txData?.data?.customer?.name || 'Prime User',
         status: "active",
      });

      return res.status(201).json({
         status: "success",
         data: {
           id: autoDebit._id,
           type: autoDebit.type,
           bankName: autoDebit.bankName,
           accountNumber: autoDebit.accountNumber,
           accountName: autoDebit.accountName,
           status: autoDebit.status,
         },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/loans/link-bank/mono/initiate
   * Initiates a Mono mandate AND persists an `initiating` AutoDebit row so the
   * mandate can later be cancelled / reconciled. Cancels any previous
   * non-active Mono mandate for this user first (Issue A).
   */
  static async initiateBankMono(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;
      const userId = String(user._id || user.id);

      const email = req.body.email || user.email || 'user@example.com';
      let name = user.name || user.first_name || 'Prime User';

      let profileName = name;
      if (user.first_name || user.last_name) {
        profileName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
      } else if (user.user_metadata?.first_name || user.user_metadata?.last_name) {
        profileName = `${user.user_metadata.first_name || ''} ${user.user_metadata.last_name || ''}`.trim();
      }

      if (req.body.accountName) {
        name = req.body.accountName;
        // Name-match is enforced everywhere now (not just production) so staging
        // reproduces the real Mono failure mode. Mono itself also rejects on mismatch.
        const profileWords = profileName.toLowerCase().split(/\s+/).filter(Boolean);
        const inputNameLower = name.toLowerCase();
        const isValid = profileWords.every((word: string) => inputNameLower.includes(word));
        if (!isValid && profileWords.length > 0 && process.env.MONO_SKIP_NAME_MATCH !== 'true') {
          return res.status(400).json({
            status: 'failed',
            message: `The account name must contain your registered profile name (${profileName}).`,
          });
        }
      } else if (req.body.first_name) {
        name = `${req.body.first_name} ${req.body.last_name || ''}`.trim();
      }

      const phone = req.body.phone || user.phone || user.user_metadata?.phone;
      const address = req.body.address || user.user_metadata?.address;
      const bvn = req.body.bvn !== undefined ? req.body.bvn : user.user_metadata?.bvn;
      const nin = req.body.nin || user.user_metadata?.nin;
      const accountNumber: string | undefined = req.body.accountNumber;

      // Eligibility (shared with checkAccount).
      const eligibility = await evaluateBankLink({ userId, accountNumber, bvn });
      if (!eligibility.allowed) {
        return res.status(400).json({ status: 'failed', message: eligibility.message });
      }

      // Cancel/replace any previous non-active Mono mandate for this user so we
      // never accumulate orphaned mandates on Mono and the user is never blocked.
      const stale = await AutoDebit.find({
        userId,
        type: 'bank',
        provider: 'mono',
        status: { $in: ['initiating', 'pending', 'approved', 'rejected', 'expired', 'failed'] },
      });
      for (const s of stale) {
        try {
          await AutoDebitService.cancelMethod(s, { reason: 'Superseded by a new mandate initiation', localStatus: 'cancelled' });
        } catch (e: any) {
          logger.warn({ mandateId: s.token, error: e.message }, 'Could not cancel stale mandate before re-initiate');
          s.status = 'cancelled';
          await s.save();
        }
      }

      const reference = `MN${userId.slice(-6)}${Date.now()}`;
      // Mandate max = generous ceiling so multiple / future loans + penalties fit
      // without re-linking. Overridable via settings, else a safe default.
      const { SettingsService } = await import('../admin/settings.service');
      const settings = await SettingsService.getSettings().catch(() => null as any);
      const configuredMax = Number(settings?.autoDebit?.mandateMaxAmount) || 0;
      const amount = configuredMax > 0 ? configuredMax : 5_000_000;

      const provider = new MonoProvider();
      const { mandateId, monoUrl } = await provider.initiateMandate({
        amount, email, name, phone, address, bvn, nin, reference,
        description: 'Prime Loan Auto-Debit Mandate',
      });

      const row = await AutoDebit.create({
        userId,
        type: 'bank',
        provider: 'mono',
        token: mandateId,
        email,
        bankName: req.body.bankName || 'Bank',
        bankCode: req.body.bankCode || '000',
        accountNumber: accountNumber || undefined,
        accountName: name,
        providerReference: reference,
        monoUrl,
        status: 'initiating',
        providerStatusRaw: 'initiated',
        lastSyncedAt: new Date(),
      });

      return res.status(200).json({
        status: 'success',
        data: { autoDebitId: row._id, mandateId, paymentId: mandateId, monoUrl },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/loans/link-bank/mono
   * Confirm a Mono mandate. VERIFIES the real state with Mono before persisting
   * anything — never blind-inserts `pending` (Issue B). Updates the existing
   * `initiating` row in place; returns the TRUE status.
   *
   *   data.status === 'active'  → mandate is ready to debit (HTTP 201)
   *   data.status === 'pending' → still awaiting Mono confirmation (HTTP 202)
   *   otherwise                 → failed / rejected / cancelled (HTTP 400)
   */
  static async linkBankMono(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, accountNumber, bankCode, bankName } = req.body;
      const userId = String((req as any).user._id || (req as any).user.id);
      const email = (req as any).user.email || 'user@example.com';

      if (!code || code === 'success' || code === 'mono-mandate') {
        return res.status(400).json({
          status: 'failed',
          message: 'A valid Mono mandate id is required. Please restart the bank linking.',
        });
      }

      // Find the row we created at initiation (preferred), else any bank row for this user.
      let row = await AutoDebit.findOne({ userId, provider: 'mono', token: code });
      if (!row) {
        row = await AutoDebit.findOne({ userId, type: 'bank', provider: 'mono', status: { $in: ['initiating', 'pending', 'approved'] } });
      }

      // Verify with Mono.
      let mapped: ReturnType<typeof mapMonoMandateStatus>;
      let acctId: string | undefined;
      let acctNo: string | undefined;
      let acctBank: string | undefined;
      try {
        const monoRes = await new MonoProvider().getMandateStatus(code);
        mapped = mapMonoMandateStatus(monoRes);
        acctId = monoRes?.data?.account?._id || monoRes?.data?.account?.id || monoRes?.data?.account_id;
        acctNo = monoRes?.data?.account?.account_number || monoRes?.data?.account_number;
        acctBank = monoRes?.data?.account?.institution?.name || monoRes?.data?.bank;
      } catch (err: any) {
        if (err?.notFound) {
          if (row) { row.status = 'failed'; row.lastError = 'Mandate not found on Mono'; await row.save(); }
          return res.status(400).json({ status: 'failed', message: 'That mandate could not be found on Mono. Please restart the bank linking.' });
        }
        throw err;
      }

      // Retire other bank methods only once we have a real, non-failed result.
      if (!mapped.terminal) {
        await AutoDebit.updateMany(
          { userId, type: 'bank', _id: { $ne: row?._id }, status: { $in: ['active', 'approved', 'pending', 'initiating'] } },
          { $set: { status: 'revoked' } }
        );
      }

      if (!row) {
        row = await AutoDebit.create({
          userId, type: 'bank', provider: 'mono', token: code, email,
          bankName: acctBank || bankName || 'Bank', bankCode: bankCode || '000',
          accountNumber: acctNo || accountNumber || undefined,
          status: 'initiating',
        });
      }

      row.status = mapped.local === 'active' ? 'active' : mapped.local;
      row.providerStatusRaw = mapped.raw;
      row.lastSyncedAt = new Date();
      if (acctId) row.providerAccountId = acctId;
      if (acctNo) row.accountNumber = acctNo;
      if (acctBank) row.bankName = acctBank;
      row.lastError = mapped.terminal ? `Mono status: ${mapped.raw}` : undefined;
      await row.save();

      const payload = {
        id: row._id,
        type: row.type,
        bankName: row.bankName,
        accountNumber: row.accountNumber,
        status: row.status,
        providerStatus: mapped.raw,
      };

      if (mapped.readyToDebit) {
        return res.status(201).json({ status: 'success', data: payload });
      }
      if (mapped.terminal) {
        return res.status(400).json({
          status: 'failed',
          message:
            mapped.local === 'rejected'
              ? 'Your bank rejected the mandate. Please try a different account.'
              : `The mandate is ${mapped.local}. Please restart the bank linking.`,
          data: payload,
        });
      }
      // pending / approved-but-not-ready
      return res.status(202).json({
        status: 'success',
        message: 'Your bank is confirming the mandate. This can take a few minutes.',
        data: { ...payload, status: 'pending' },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/loans/link-bank/mono/status?code=<mandateId>
   * Lightweight polling endpoint for the wizard while a mandate is `pending`.
   */
  static async getMonoLinkStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String((req as any).user._id || (req as any).user.id);
      const code = String(req.query.code || req.query.mandateId || '');
      const row = code
        ? await AutoDebit.findOne({ userId, provider: 'mono', token: code })
        : await AutoDebit.findOne({ userId, type: 'bank', provider: 'mono' }).sort({ createdAt: -1 });

      if (!row) return res.status(404).json({ status: 'failed', message: 'No Mono mandate found' });

      let readyToDebit = row.status === 'active';
      if (['initiating', 'pending', 'approved'].includes(row.status)) {
        const synced = await AutoDebitService.syncMonoMandate(row);
        readyToDebit = synced.readyToDebit;
      }

      return res.status(200).json({
        status: 'success',
        data: {
          id: row._id,
          status: readyToDebit ? 'active' : row.status,
          providerStatus: row.providerStatusRaw,
          readyToDebit,
          needsAction: ['initiating', 'pending', 'approved'].includes(row.status),
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /api/loans/link-bank/mono/cancel   body: { autoDebitId? }
   * User-initiated "Cancel setup" — cancels the mandate on Mono AND locally so
   * the user can immediately restart (Issue A).
   */
  static async cancelMonoMandate(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String((req as any).user._id || (req as any).user.id);
      const { autoDebitId } = req.body || {};

      const query: any = autoDebitId
        ? { _id: autoDebitId, userId }
        : { userId, type: 'bank', provider: 'mono', status: { $in: ['initiating', 'pending', 'approved', 'active'] } };

      const rows = await AutoDebit.find(query).sort({ createdAt: -1 });
      if (!rows.length) {
        return res.status(200).json({ status: 'success', message: 'Nothing to cancel' });
      }

      const results = [];
      for (const row of rows) {
        const r = await AutoDebitService.cancelMethod(row, { reason: 'User cancelled bank linking', localStatus: 'cancelled' });
        results.push({ id: row._id, ...r });
      }

      return res.status(200).json({ status: 'success', message: 'Bank linking cancelled', data: results });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/loans/link-bank/monnify
   * Saves Monnify mandate code after frontend widget completes.
   */
  static async linkBankMonnify(req: Request, res: Response, next: NextFunction) {
    try {
      const { mandateCode, accountNumber, bankCode, bankName } = req.body;
      const userId = (req as any).user._id || (req as any).user.id;
      const email = (req as any).user.email || 'user@example.com';

      if (!mandateCode) {
        return res.status(400).json({ status: 'failed', message: 'Mandate Code is required' });
      }

      // Revoke old bank mandates
      await AutoDebit.updateMany(
         { userId: String(userId), type: "bank", status: "active" },
         { $set: { status: "revoked" } }
      );

      const autoDebit = await AutoDebit.create({
         userId: String(userId),
         type: "bank",
         provider: "monnify",
         token: mandateCode, // Monnify mandate code
         email: email,
         bankName: bankName || 'Bank',
         bankCode: bankCode || '000',
         accountNumber: accountNumber || '0000000000',
         status: "active",
      });

      return res.status(201).json({
         status: "success",
         data: {
           id: autoDebit._id,
           type: autoDebit.type,
           bankName: autoDebit.bankName,
           accountNumber: autoDebit.accountNumber,
           status: autoDebit.status,
         },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/loans/validate-account
   */
  static async validateAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const { accountNumber, bankCode } = req.body;

      if (!accountNumber || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'accountNumber and bankCode are required' });
      }

      const provider = new FlutterwaveDebitProvider();
      const details = await provider.validateBankAccount(accountNumber, bankCode);

      return res.status(200).json({
        status: 'success',
        data: {
          accountName: details?.account_name || '',
          accountNumber: details?.account_number || accountNumber,
        },
      });
    } catch (err: any) {
      return res.status(422).json({ status: 'failed', message: err.message || 'Account validation failed' });
    }
  }

  /**
   * GET /api/loans/linked-methods
   */
  static async getLinkedMethods(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;

      // Include in-progress bank mandates so the wizard / account page can show
      // "setup incomplete — finish or cancel" instead of silently claiming linked.
      const methods = await AutoDebit.find({
        userId: String(userId),
        status: { $in: ['active', 'approved', 'pending', 'initiating'] },
      })
        .select('-token')
        .sort({ createdAt: -1 })
        .lean();

      const pickActive = (t: string) => methods.find((m) => m.type === t && m.status === 'active') || null;
      const pickAny = (t: string) => methods.find((m) => m.type === t) || null;

      const card = pickActive('card');
      const bankActive = pickActive('bank');
      const bankAny = pickAny('bank');
      const walletActive = pickActive('wallet');

      const shape = (m: any) =>
        m && {
          ...m,
          needsAction: ['approved', 'pending', 'initiating'].includes(m.status),
          providerStatus: m.providerStatusRaw,
        };

      return res.status(200).json({
        status: 'success',
        data: {
          card: shape(card),
          bank: shape(bankActive || bankAny),
          wallet: shape(walletActive),
          hasCard: !!card,
          hasBank: !!bankActive,
          hasWallet: !!walletActive,
          bankNeedsAction: !!bankAny && bankAny.status !== 'active',
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * DELETE /api/loans/linked-methods/:id
   * Disconnect a linked method. For a Mono bank mandate this ALSO cancels the
   * mandate on Mono, so "disconnect" means disconnect everywhere.
   */
  static async unlinkMethod(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const method = await AutoDebit.findOne({ _id: req.params.id, userId: String(userId) });

      if (!method) {
        return res.status(404).json({ status: 'failed', message: 'Payment method not found' });
      }

      const result = await AutoDebitService.cancelMethod(method, { reason: 'User disconnected the method', localStatus: 'revoked' });

      logger.info({ userId, methodId: req.params.id, providerCancelled: result.providerCancelled }, 'Payment method unlinked');
      return res.status(200).json({ status: 'success', message: result.message, data: { providerCancelled: result.providerCancelled } });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/loans/max-borrowable
   */
  static async getMaxBorrowable(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const user = await UserService.getUser(userId);
      if (!user || Array.isArray(user)) {
        return res.status(404).json({ status: 'failed', message: 'User not found' });
      }

      const capacities = await LoanEligibilityService.getMaxBorrowableAmount(user as any);

      // Check linked payment methods
      const linkedMethods = await AutoDebit.countDocuments({ userId: String(userId), status: 'active' });

      // Check active loans
      const LoanModel = (await import('./loan.model')).default;
      const hasActiveLoan = await LoanModel.exists({
        userId: (user as any)._id,
        loan_payment_status: { $in: ['in-progress', 'not-started'] },
        status: { $in: ['pending', 'processing', 'accepted'] },
      });

      return res.status(200).json({
        status: 'success',
        data: {
          maxAmount: capacities.maxAmount,
          savingsBasedMax: capacities.savingsBasedMax,
          ladderMax: capacities.ladderMax,
          ladderIndex: capacities.ladderIndex,
          hasLinkedPaymentMethod: linkedMethods > 0,
          hasActiveLoan: !!hasActiveLoan,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/loans/banks
   */
  static async getBanks(req: Request, res: Response, next: NextFunction) {
    try {
      const provider = new FlutterwaveDebitProvider();
      const banks = await provider.getBanks();
      return res.status(200).json({ status: 'success', data: banks });
    } catch (err) { next(err); }
  }
}
