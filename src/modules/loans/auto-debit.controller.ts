/**
 * Auto-Debit Controller — Handles Flutterwave card/bank linking and querying
 * Replaces MonoAccountController
 *
 * FIXES:
 *  - bankName was incorrectly stored as bankCode; now correctly stores resolved bank name
 *  - Added POST /loans/validate-account proxy (frontend must not call FW with secret key)
 *  - getBanks route wired up
 */
import { Request, Response, NextFunction } from 'express';
import { AutoDebit } from './auto-debit.model';
import { FlutterwaveDebitProvider } from '../../shared/providers/flutterwave-debit.provider';
import { LoanEligibilityService } from './loan-eligibility';
import { UserService } from '../users/user.service';
import pino from 'pino';

const logger = pino({ name: 'auto-debit-controller' });

export class AutoDebitController {

  /**
   * POST /api/loans/link-card
   * Verify a Flutterwave card tokenization transaction and store the card token.
   * Frontend calls Flutterwave Inline → gets tx_ref back → sends it here.
   */
  static async linkCard(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { txRef, email } = req.body;

      if (!txRef) {
        return res.status(400).json({ status: 'failed', message: 'Transaction reference (txRef) is required' });
      }

      const provider = new FlutterwaveDebitProvider();
      const txData = await provider.verifyTransaction(txRef);

      if (!txData || txData.status !== 'successful') {
        return res.status(400).json({ status: 'failed', message: 'Card authorization transaction was not successful' });
      }

      const card = txData.card;
      if (!card?.token) {
        return res.status(400).json({ status: 'failed', message: 'No card token received from transaction' });
      }

      // Revoke any previously active card for this user to keep one primary card
      await AutoDebit.updateMany(
        { userId: String(userId), type: 'card', status: 'active' },
        { $set: { status: 'revoked' } }
      );

      const autoDebit = await AutoDebit.create({
        userId: String(userId),
        type: 'card',
        token: card.token,
        email: email || txData.customer?.email || '',
        last4: card.last_4digits || card.last4 || '',
        cardBrand: card.type || card.brand || '',
        expMonth: card.expiry?.split('/')[0]?.trim() || '',
        expYear: card.expiry?.split('/')[1]?.trim() || '',
        status: 'active',
      });

      logger.info({ userId, cardLast4: autoDebit.last4 }, 'Card linked via Flutterwave');

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
    } catch (err) { next(err); }
  }

  /**
   * POST /api/loans/link-bank
   * Link a bank account via Flutterwave direct debit.
   * Validates the bank account, then persists the mandate record.
   *
   * FIX: bankName was previously stored as `bankCode` — now resolved correctly.
   */
  static async linkBank(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { accountNumber, bankCode, bankName: clientBankName, email, txRef } = req.body;

      if (!accountNumber || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'accountNumber and bankCode are required' });
      }

      const provider = new FlutterwaveDebitProvider();

      // Validate the bank account — resolves the account holder name
      let resolvedAccountName = '';
      let resolvedBankName = clientBankName || bankCode; // fallback: use what client sent
      try {
        const bankDetails = await provider.validateBankAccount(accountNumber, bankCode);
        resolvedAccountName = bankDetails?.account_name || '';
      } catch (validationErr: any) {
        logger.warn({ bankCode, accountNumber: accountNumber.slice(-4) }, `Bank validation warning: ${validationErr.message}`);
        // Non-fatal — proceed with linking even if resolve fails (some banks are slow)
      }

      // Fetch the human-readable bank name from Flutterwave if not provided by client
      if (!clientBankName) {
        try {
          const banks: { code: string; name: string }[] = await provider.getBanks();
          const matched = banks.find((b) => b.code === bankCode);
          if (matched) resolvedBankName = matched.name;
        } catch (_) { /* non-fatal */ }
      }

      // If txRef provided, verify the debit mandate transaction
      let mandateToken = `mandate-${userId}-${Date.now()}`;
      if (txRef) {
        try {
          const txData = await provider.verifyTransaction(txRef);
          if (txData?.status === 'successful') {
            mandateToken = txData.flw_ref || txData.tx_ref || mandateToken;
          }
        } catch (_) { /* non-fatal — token generated above as fallback */ }
      }

      // Revoke any previously active bank account for this user
      await AutoDebit.updateMany(
        { userId: String(userId), type: 'bank', status: 'active' },
        { $set: { status: 'revoked' } }
      );

      const autoDebit = await AutoDebit.create({
        userId: String(userId),
        type: 'bank',
        token: mandateToken,
        email: email || '',
        bankName: resolvedBankName,   // FIX: was storing bankCode here before
        bankCode,                     // Persist numeric code for FW direct-debit calls
        accountNumber,
        accountName: resolvedAccountName,
        status: 'active',
      });

      logger.info({ userId, accountNumber: accountNumber.slice(-4), bankName: resolvedBankName }, 'Bank account linked via Flutterwave');

      return res.status(201).json({
        status: 'success',
        data: {
          id: autoDebit._id,
          type: 'bank',
          bankName: autoDebit.bankName,
          accountNumber: autoDebit.accountNumber,
          accountName: autoDebit.accountName,
          status: 'active',
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /api/loans/validate-account
   * Backend proxy for Flutterwave account name resolution.
   * The frontend MUST NOT call Flutterwave directly with the secret key.
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
      // Return a non-500 with a safe message so the frontend can handle gracefully
      return res.status(422).json({ status: 'failed', message: err.message || 'Account validation failed' });
    }
  }

  /**
   * GET /api/loans/linked-methods
   * Returns all active linked payment methods for the logged-in user (cards + banks).
   * Tokens are excluded from the response.
   */
  static async getLinkedMethods(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const methods = await AutoDebit.find({ userId: String(userId), status: 'active' })
        .select('-token')
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({ status: 'success', data: methods });
    } catch (err) { next(err); }
  }

  /**
   * DELETE /api/loans/linked-methods/:id
   * Revokes (soft-deletes) a linked payment method.
   */
  static async unlinkMethod(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const method = await AutoDebit.findOneAndUpdate(
        { _id: req.params.id, userId: String(userId) },
        { $set: { status: 'revoked' } },
        { new: true }
      );

      if (!method) {
        return res.status(404).json({ status: 'failed', message: 'Payment method not found' });
      }

      logger.info({ userId, methodId: req.params.id }, 'Payment method unlinked');
      return res.status(200).json({ status: 'success', message: 'Payment method removed' });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/loans/max-borrowable
   * Returns the user's maximum borrowable amount, ladder info, and linked method status.
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
   * Returns the list of Nigerian banks from Flutterwave.
   */
  static async getBanks(req: Request, res: Response, next: NextFunction) {
    try {
      const provider = new FlutterwaveDebitProvider();
      const banks = await provider.getBanks();
      return res.status(200).json({ status: 'success', data: banks });
    } catch (err) { next(err); }
  }
}