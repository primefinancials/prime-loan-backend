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
import { BadRequestError } from '../../exceptions';

const logger = pino({ name: 'auto-debit-controller' });

export class AutoDebitController {

  /**
   * POST /api/loans/link-card
   * Initiate a server-to-server card charge for ₦200 to tokenize the card.
   */
  static async linkCard(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { cardNumber, cvv, expiryMonth, expiryYear, email, fullname } = req.body;

      if (!cardNumber || !cvv || !expiryMonth || !expiryYear) {
        return res.status(400).json({ status: 'failed', message: 'Card details are required' });
      }

      const provider = new FlutterwaveDebitProvider();
      const txRef = `card-link-${userId}-${Date.now()}`;
      
      const chargeResult = await provider.chargeCard({
        cardNumber: String(cardNumber),
        cvv: String(cvv),
        expiryMonth: String(expiryMonth),
        expiryYear: String(expiryYear),
        email: email || 'user@primefinance.live',
        fullname: fullname || 'Prime User',
        amount: 200, // 200 NGN minimum for tokenization
        txRef
      });

      // If Flutterwave requires OTP/PIN validation
      if (chargeResult?.meta?.authorization?.mode === 'otp' || chargeResult?.meta?.authorization?.mode === 'pin') {
         return res.status(200).json({
           status: 'success',
           message: 'OTP or PIN required',
           data: {
             flwRef: chargeResult.data?.flw_ref,
             authMode: chargeResult.meta.authorization.mode,
             type: 'card'
           }
         });
      }

      // If successful without OTP
      if (chargeResult?.status === 'success' || chargeResult?.data?.status === 'successful') {
         // AutoDebit record is normally created in verifyLink, but if it's already successful here:
         const card = chargeResult.data?.card;
         if (card?.token) {
           await AutoDebit.updateMany(
             { userId: String(userId), type: 'card', status: 'active' },
             { $set: { status: 'revoked' } }
           );

           const autoDebit = await AutoDebit.create({
             userId: String(userId),
             type: 'card',
             token: card.token,
             email: email || chargeResult.data?.customer?.email || '',
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
      }

      return res.status(400).json({ status: 'failed', message: 'Card charge failed or requires unsupported auth mode' });
    } catch (err) { next(err); }
  }

  /**
   * POST /api/loans/link-bank
   * Link a bank account (or wallet) via Flutterwave direct debit.
   */
  static async linkBank(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { accountNumber, bankCode, bankName: clientBankName, email } = req.body;

      if (!accountNumber || !bankCode) {
        throw new BadRequestError("accountNumber and bankCode are required");
      }

      const provider = new FlutterwaveDebitProvider();
      
      let accountName = "";
      try {
        const account = await provider.validateBankAccount(accountNumber, bankCode);
        accountName = account?.account_name ?? "";
      } catch (error: any) {
        logger.warn({ bankCode, accountNumber: accountNumber.slice(-4) }, `Bank validation failed: ${error.response?.data?.message || error.message}`);
        // For wallets like PalmPay/OPay, validation might fail or not be supported. We proceed with the charge.
        accountName = "Wallet User";
      }

      let bankName = clientBankName?.trim();
      if (!bankName) {
        try {
          const banks: { code: string; name: string }[] = await provider.getBanks();
          bankName = banks.find((bank) => bank.code === bankCode)?.name ?? bankCode;
        } catch (error: any) {
          throw new BadRequestError(`Failed to resolve bank name: ${error.response?.data?.message || error.message}`);
        }
      }

      const txRef = `bank-link-${userId}-${Date.now()}`;
      let chargeResult;
      
      try {
        chargeResult = await provider.initiateDirectDebit({
          accountNumber,
          bankCode,
          email: email || 'user@primefinance.live',
          amount: 200, // 200 NGN minimum charge
          txRef
        });
      } catch (err: any) {
         if (err.message && err.message.toLowerCase().includes('wallet')) {
             throw new BadRequestError("Service is currently unavailable from the provider for direct linking. Please try again later.");
         }
         throw err;
      }

      // Check for OTP/Validation
      if (chargeResult?.meta?.authorization?.mode === 'otp') {
         return res.status(200).json({
           status: 'success',
           message: 'OTP required',
           data: {
             flwRef: chargeResult.data?.flw_ref,
             authMode: 'otp',
             type: 'bank',
             bankName,
             bankCode,
             accountNumber,
             accountName
           }
         });
      }

      if (chargeResult?.status === 'success' || chargeResult?.data?.status === 'successful') {
         await AutoDebit.updateMany(
            { userId: String(userId), type: "bank", status: "active" },
            { $set: { status: "revoked" } }
         );

         const mandateToken = chargeResult.data?.flw_ref || chargeResult.data?.tx_ref || txRef;

         const autoDebit = await AutoDebit.create({
            userId: String(userId),
            type: "bank",
            token: mandateToken,
            email: email ?? "",
            bankName,
            bankCode,
            accountNumber,
            accountName,
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
      }

      return res.status(400).json({ status: 'failed', message: 'Bank link failed' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/loans/verify-link
   * Verify an OTP or PIN for card/bank linking.
   */
  static async verifyLink(req: Request, res: Response, next: NextFunction) {
     try {
        const userId = (req as any).user._id || (req as any).user.id;
        const { flwRef, otp, type, email, bankName, bankCode, accountNumber, accountName } = req.body;
        
        if (!flwRef || !otp) {
           return res.status(400).json({ status: 'failed', message: 'flwRef and otp are required' });
        }

        const provider = new FlutterwaveDebitProvider();
        const validateResult = await provider.validateCharge(flwRef, otp);

        if (validateResult?.status === 'success' || validateResult?.data?.status === 'successful') {
           const txData = await provider.verifyTransaction(flwRef);
           
           if (type === 'card') {
              const card = txData.card || validateResult.data?.card;
              if (card?.token) {
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

                 return res.status(201).json({ status: 'success', data: {
                   id: autoDebit._id, type: 'card', last4: autoDebit.last4, cardBrand: autoDebit.cardBrand, status: 'active'
                 }});
              }
           } else {
              // bank
              await AutoDebit.updateMany(
                 { userId: String(userId), type: "bank", status: "active" },
                 { $set: { status: "revoked" } }
              );
     
              const autoDebit = await AutoDebit.create({
                 userId: String(userId),
                 type: "bank",
                 token: flwRef,
                 email: email ?? "",
                 bankName: bankName || 'Bank',
                 bankCode: bankCode || '000',
                 accountNumber: accountNumber || '0000000000',
                 accountName: accountName || 'Prime User',
                 status: "active",
              });
     
              return res.status(201).json({ status: "success", data: {
                   id: autoDebit._id, type: autoDebit.type, bankName: autoDebit.bankName, accountNumber: autoDebit.accountNumber, accountName: autoDebit.accountName, status: autoDebit.status
              }});
           }
        }

        return res.status(400).json({ status: 'failed', message: 'OTP verification failed' });
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
   * Returns the active linked card and/or bank account for the logged-in user.
   * Tokens are excluded from the response.
   *
   * NOTE: Only one active card and one active bank mandate are kept per user —
   * linkCard/linkBank already revoke any previously-active record of the same
   * type, so at most one of each type can ever be 'active' at a time. We surface
   * that directly as `card` / `bank` (each either the linked record or null)
   * so the frontend doesn't need to filter an array.
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