import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { AutoDebit } from './auto-debit.model';
import { OPayProvider } from '../../shared/providers/opay.provider';
import { MonnifyProvider } from '../../shared/providers/monnify.provider';

const logger = pino({ name: 'fintech-wallet-controller' });

export class FintechWalletController {
  
  /**
   * POST /api/loans/link-wallet/opay/initiate
   * Body: { phone }
   */
  static async initiateOpayBinding(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone } = req.body;
      const userId = (req as any).user?._id;

      if (!phone) {
        return res.status(400).json({ status: 'failed', message: 'Phone number is required' });
      }

      const reference = `opay-bind-${userId}-${Date.now()}`;
      const provider = new OPayProvider();
      
      const result = await provider.initiateBinding(phone, reference);

      return res.status(200).json({
        status: 'success',
        message: 'OTP sent to OPay wallet',
        data: { reference, ...result }
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'OPay binding initiation failed');
      return res.status(400).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * POST /api/loans/link-wallet/opay/verify
   * Body: { phone, otp, reference }
   */
  static async verifyOpayBinding(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, otp, reference } = req.body;
      const userId = (req as any).user?._id;
      const email = (req as any).user?.email || 'user@example.com';

      if (!phone || !otp || !reference) {
        return res.status(400).json({ status: 'failed', message: 'Phone, OTP, and reference are required' });
      }

      const provider = new OPayProvider();
      const result = await provider.verifyBinding(phone, otp, reference);

      if (result.token) {
        // Revoke any existing OPay wallets for this user
        await AutoDebit.updateMany(
          { userId: String(userId), type: 'wallet', provider: 'opay', status: 'active' },
          { $set: { status: 'revoked' } }
        );

        // Save new token
        await AutoDebit.create({
          userId: String(userId),
          type: 'wallet',
          provider: 'opay',
          walletPhone: phone,
          token: result.token,
          email,
          status: 'active'
        });

        return res.status(200).json({ status: 'success', message: 'OPay wallet linked successfully' });
      } else {
        return res.status(400).json({ status: 'failed', message: 'Failed to retrieve OPay token' });
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'OPay binding verification failed');
      return res.status(400).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * POST /api/loans/link-wallet/monnify/mandate
   * Body: { accountNumber, bankCode, accountName }
   * Creates a mandate and returns the auth URL
   */
  static async createMonnifyMandate(req: Request, res: Response, next: NextFunction) {
    try {
      const { accountNumber, bankCode, accountName } = req.body;
      const userId = (req as any).user?._id;
      const email = (req as any).user?.email || 'user@example.com';

      if (!accountNumber || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'Account number and bank code are required' });
      }

      const provider = new MonnifyProvider();
      
      // We set a max amount for the variable mandate, e.g., 1,000,000 NGN
      const result = await provider.createMandate({
        accountNumber,
        bankCode,
        accountName: accountName || 'Customer',
        email,
        amount: 1000000 
      });

      // Save as pending in DB
      await AutoDebit.create({
        userId: String(userId),
        type: 'wallet', // Or bank, depending on UI intent, but we'll mark it wallet if it's moniepoint
        provider: 'monnify',
        accountNumber,
        bankCode,
        accountName,
        mandateCode: result.mandateCode,
        token: result.mandateCode, // For Monnify, the mandateCode is effectively the token
        email,
        status: 'pending' // Will be activated via webhook
      });

      return res.status(200).json({
        status: 'success',
        message: 'Mandate created. Please authorize.',
        data: {
          mandateCode: result.mandateCode,
          authUrl: result.authUrl
        }
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Monnify mandate creation failed');
      return res.status(400).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * POST /api/webhooks/monnify-mandate
   * Webhook handler for Monnify to notify when a mandate is authorized
   */
  static async handleMonnifyWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body;
      logger.info({ payload }, 'Received Monnify Webhook');

      // Check if it's a mandate activation event
      // Monnify sends EVENT_TYPE like "MANDATE_ACTIVATION"
      if (payload.eventType === 'SUCCESSFUL_MANDATE_ACTIVATION') {
        const mandateCode = payload.eventData?.mandateCode;
        if (mandateCode) {
          await AutoDebit.updateMany(
            { mandateCode, type: 'wallet', provider: 'monnify' },
            { $set: { status: 'active' } }
          );
          logger.info({ mandateCode }, 'Activated Monnify mandate via webhook');
        }
      }

      // Always return 200 OK to webhooks
      return res.status(200).send('OK');
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to process Monnify webhook');
      return res.status(500).send('Error');
    }
  }
}
