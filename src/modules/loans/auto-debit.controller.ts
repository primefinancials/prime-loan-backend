/**
 * Auto-Debit Controller — Handles Flutterwave card/bank linking and querying
 * Replaces MonoAccountController
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
   * Verify a Flutterwave card tokenization transaction and store the card token
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

      // Save the linked card
      const autoDebit = await AutoDebit.create({
        userId: String(userId),
        type: 'card',
        token: card.token,
        email: email || txData.customer?.email || '',
        last4: card.last_4digits || card.last4 || '',
        cardBrand: card.type || card.brand || '',
        expMonth: card.expiry?.split('/')[0] || '',
        expYear: card.expiry?.split('/')[1] || '',
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
   * Link a bank account via Flutterwave e-mandate (stores validated bank details)
   */
  static async linkBank(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { accountNumber, bankCode, email, txRef } = req.body;

      if (!accountNumber || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'accountNumber and bankCode are required' });
      }

      const provider = new FlutterwaveDebitProvider();

      // Validate the bank account first
      const bankDetails = await provider.validateBankAccount(accountNumber, bankCode);

      // If txRef provided, verify the mandate transaction
      let mandateToken = `mandate-${userId}-${Date.now()}`;
      if (txRef) {
        const txData = await provider.verifyTransaction(txRef);
        if (txData?.status === 'successful') {
          mandateToken = txData.flw_ref || txData.tx_ref || mandateToken;
        }
      }

      const autoDebit = await AutoDebit.create({
        userId: String(userId),
        type: 'bank',
        token: mandateToken,
        email: email || '',
        bankName: bankDetails?.account_name ? bankCode : bankCode,
        accountNumber,
        accountName: bankDetails?.account_name || '',
        status: 'active',
      });

      logger.info({ userId, accountNumber: accountNumber.slice(-4) }, 'Bank account linked via Flutterwave');

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
   * GET /api/loans/linked-methods
   * Returns all linked payment methods (cards + banks)
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
   * Removes (revokes) a linked payment method
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
   * Returns the user's max borrowable amount (considering both ladder and savings)
   */
  static async getMaxBorrowable(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const user = await UserService.getUser(userId);
      if (!user || Array.isArray(user)) {
        return res.status(404).json({ status: 'failed', message: 'User not found' });
      }

      // Important: Use the centralized LoanEligibilityService
      const LoanEligibilityService = (await import('./loan-eligibility')).LoanEligibilityService;
      const capacities = await LoanEligibilityService.getMaxBorrowableAmount(user as any);
      
      const maxAmount = capacities.maxAmount;
      const borrowableFromSavings = capacities.savingsBasedMax;
      const ladderAmount = capacities.ladderMax;
      const ladderIndex = capacities.ladderIndex;

      // Check linked payment methods
      const linkedMethods = await AutoDebit.countDocuments({ userId: String(userId), status: 'active' });

      // Check active loans
      const LoanModel = (await import('./loan.model')).default;
      const hasActiveLoan = await LoanModel.exists({
        userId: user._id,
        loan_payment_status: { $in: ['in-progress', 'not-started'] },
        status: { $in: ['pending', 'processing', 'accepted', 'active'] }
      });

      return res.status(200).json({
        status: 'success',
        data: {
          maxAmount,
          savingsBasedMax: borrowableFromSavings,
          ladderMax: ladderAmount,
          ladderIndex,
          hasLinkedPaymentMethod: linkedMethods > 0,
          hasActiveLoan: !!hasActiveLoan,
        },
      });
    } catch (err) { next(err); }
  }
}
