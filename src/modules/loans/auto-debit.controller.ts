/**
 * Auto-Debit Controller — Handles Flutterwave card/bank linking and querying
 */
import { Request, Response, NextFunction } from 'express';
import { AutoDebit } from './auto-debit.model';
import { FlutterwaveDebitProvider } from '../../shared/providers/flutterwave-debit.provider';
import { LoanEligibilityService } from './loan-eligibility';
import { UserService } from '../users/user.service';
import pino from 'pino';
import { BadRequestError } from '../../exceptions';

const logger = pino({ name: 'auto-debit-controller' });

export class AutoDebitController {

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
         await AutoDebit.updateMany(
           { userId: String(userId), type: 'card', status: 'active' },
           { $set: { status: 'revoked' } }
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
   * POST /api/loans/link-bank
   * Extracts token from Flutterwave txRef after the widget handles the charge.
   */
  static async linkBank(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { txRef } = req.body;

      if (!txRef) {
        return res.status(400).json({ status: 'failed', message: 'txRef is required' });
      }

      const provider = new FlutterwaveDebitProvider();
      const txData = await provider.verifyTransaction(txRef);
      
      // We assume the charge was successful if verifyTransaction passes.
      // Bank mandate token is often the tx_ref or flw_ref
      const token = txData.flw_ref || txRef;

      await AutoDebit.updateMany(
         { userId: String(userId), type: "bank", status: "active" },
         { $set: { status: "revoked" } }
      );

      const autoDebit = await AutoDebit.create({
         userId: String(userId),
         type: "bank",
         token: token,
         email: txData.customer?.email || "",
         bankName: txData.account?.bank_name || 'Bank',
         bankCode: txData.account?.bank_code || '000',
         accountNumber: txData.account?.account_number || '0000000000',
         accountName: txData.customer?.name || 'Prime User',
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
   * POST /api/loans/verify-link
   * Deprecated for Flutterwave Widget approach, but kept for compatibility
   */
  static async verifyLink(req: Request, res: Response, next: NextFunction) {
      return res.status(200).json({ status: 'success', message: 'Legacy endpoint. Use standard link flow.' });
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
      const methods = await AutoDebit.find({ userId: String(userId), status: 'active' })
        .select('-token')
        .sort({ createdAt: -1 })
        .lean();

      const card = methods.find((m) => m.type === 'card') || null;
      const bank = methods.find((m) => m.type === 'bank') || null;

      return res.status(200).json({
        status: 'success',
        data: {
          card,
          bank,
          hasCard: !!card,
          hasBank: !!bank,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * DELETE /api/loans/linked-methods/:id
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
