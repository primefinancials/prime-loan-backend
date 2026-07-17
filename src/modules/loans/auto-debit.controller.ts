/**
 * Auto-Debit Controller — Handles Flutterwave card/bank linking and querying
 */
import { Request, Response, NextFunction } from 'express';
import { AutoDebit } from './auto-debit.model';
import { FlutterwaveDebitProvider } from '../../shared/providers/flutterwave-debit.provider';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { MonnifyProvider } from '../../shared/providers/monnify.provider';
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
      await AutoDebit.updateMany(
         { userId: String(userId), type: "bank", status: "active" },
         { $set: { status: "revoked" } }
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
   * POST /api/loans/link-bank/mono
   * Exchanges Mono code for account ID and saves it.
   */
  static async linkBankMono(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, accountNumber, bankCode, bankName } = req.body;
      const userId = (req as any).user._id || (req as any).user.id;
      const email = (req as any).user.email || 'user@example.com';

      if (!code) {
        return res.status(400).json({ status: 'failed', message: 'Auth code is required' });
      }

      const provider = new MonoProvider();
      const accountData = await provider.exchangeToken(code);

      // Revoke old bank mandates
      await AutoDebit.updateMany(
         { userId: String(userId), type: "bank", status: "active" },
         { $set: { status: "revoked" } }
      );

      const autoDebit = await AutoDebit.create({
         userId: String(userId),
         type: "bank",
         provider: "mono",
         token: accountData.id, // Mono account ID
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
