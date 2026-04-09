/**
 * Mono Account Controller — Handles Mono account linking and max-borrowable queries
 */
import { Request, Response, NextFunction } from 'express';
import { MonoProvider } from '../../shared/providers/mono.provider';
import { UserService } from '../users/user.service';
import { LoanEligibilityService } from './loan-eligibility';
import UserModel from '../users/user.model';
import pino from 'pino';

const logger = pino({ name: 'mono-account-controller' });

export class MonoAccountController {

  /**
   * POST /api/loans/link-account
   * Exchange a Mono Connect auth code for an account ID and save to user profile
   */
  static async linkAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ status: 'failed', message: 'Mono auth code is required' });
      }

      const mono = new MonoProvider();

      // Exchange auth code for account details
      const accountDetails = await mono.exchangeToken(code);

      // Save to user profile
      await UserModel.updateOne(
        { _id: userId },
        {
          $set: {
            'mono_account.accountId': accountDetails.id,
            'mono_account.institution': accountDetails.institution?.name || '',
            'mono_account.accountNumber': accountDetails.accountNumber || '',
            'mono_account.accountName': accountDetails.name || '',
            'mono_account.linkedAt': new Date(),
            'mono_account.mandateStatus': 'pending'
          }
        }
      );

      logger.info({ userId, accountId: accountDetails.id }, 'Mono account linked');

      return res.status(200).json({
        status: 'success',
        data: {
          accountId: accountDetails.id,
          institution: accountDetails.institution?.name,
          accountNumber: accountDetails.accountNumber,
          accountName: accountDetails.name
        }
      });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/loans/linked-account
   * Get user's linked Mono account status
   */
  static async getLinkedAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const user = await UserModel.findById(userId).select('mono_account');

      if (!user || !(user as any).mono_account?.accountId) {
        return res.status(200).json({ status: 'success', data: { linked: false } });
      }

      const monoAccount = (user as any).mono_account;
      return res.status(200).json({
        status: 'success',
        data: {
          linked: true,
          institution: monoAccount.institution,
          accountNumber: monoAccount.accountNumber,
          accountName: monoAccount.accountName,
          linkedAt: monoAccount.linkedAt,
          mandateStatus: monoAccount.mandateStatus
        }
      });
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

      // Use a very high amount to get the effective max from eligibility service
      const result = await LoanEligibilityService.calculateEligibility(user, Number.MAX_SAFE_INTEGER);

      return res.status(200).json({
        status: 'success',
        data: {
          maxAmount: result.maxAmount,
          ladderIndex: result.ladderIndex,
          creditScore: result.creditScore,
          hasLinkedAccount: !!(user as any).mono_account?.accountId
        }
      });
    } catch (err) { next(err); }
  }
}
