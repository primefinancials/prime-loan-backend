/**
 * Test Integrations Controller — Admin-facing endpoints to verify integrations
 */
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import {
  TermiiVoiceProvider,
  AfricasTalkingVoiceProvider,
  getVoiceProvider,
} from '../../shared/providers/voice-call.provider';

const logger = pino({ name: 'test-integrations' });

export class TestIntegrationsController {

  /**
   * POST /backoffice/test-integrations/voice-call
   * body: { phone, message, provider?: 'termii' | 'africastalking' }
   */
  static async testVoiceCall(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, message, provider: providerName } = req.body;
      if (!phone) return res.status(400).json({ status: 'failed', message: 'Phone number is required' });

      const testMessage = message || 'This is a test call from Prime Finance admin panel.';

      let voiceProvider;
      if (providerName === 'termii') {
        voiceProvider = new TermiiVoiceProvider();
      } else if (providerName === 'africastalking') {
        voiceProvider = new AfricasTalkingVoiceProvider();
      } else {
        voiceProvider = await getVoiceProvider();
      }

      logger.info({ phone, provider: voiceProvider.providerName }, 'Admin test voice call initiated');
      const callId = await voiceProvider.makeCall(phone, testMessage);

      return res.status(200).json({
        status: 'success',
        data: {
          callId,
          provider: voiceProvider.providerName,
          phone,
          message: testMessage,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Test voice call failed');
      return res.status(500).json({
        status: 'failed',
        message: err.message,
        data: { error: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined },
      });
    }
  }

  /**
   * POST /backoffice/test-integrations/sms
   * body: { phone, message }
   */
  static async testSms(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, message } = req.body;
      if (!phone) return res.status(400).json({ status: 'failed', message: 'Phone number is required' });

      const testMessage = message || 'This is a test SMS from Prime Finance admin panel.';
      const provider = new TermiiVoiceProvider();

      logger.info({ phone }, 'Admin test SMS initiated');
      await provider.sendRecoverySms!(phone, testMessage);

      return res.status(200).json({
        status: 'success',
        data: {
          provider: 'termii',
          phone,
          message: testMessage,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Test SMS failed');
      return res.status(500).json({
        status: 'failed',
        message: err.message,
        data: { error: err.message },
      });
    }
  }

  /**
   * POST /backoffice/test-integrations/penalty
   * body: { loanId }
   * Applies 1% penalty to a specific loan (test only)
   */
  static async testPenalty(req: Request, res: Response, next: NextFunction) {
    try {
      const { loanId } = req.body;
      if (!loanId) return res.status(400).json({ status: 'failed', message: 'Loan ID is required' });

      const LoanModel = (await import('../../modules/loans/loan.model')).default;
      const loan = await LoanModel.findById(loanId);
      if (!loan) return res.status(404).json({ status: 'failed', message: 'Loan not found' });

      const penaltyRate = 0.01; // 1%
      const penaltyAmount = Math.floor(Number(loan.amount) * penaltyRate);
      const previousOutstanding = Number(loan.outstanding);

      // Apply penalty
      loan.outstanding = previousOutstanding + penaltyAmount;
      loan.lastInterestAdded = new Date().toISOString();
      loan.repayment_history = [
        ...(loan.repayment_history || []),
        {
          amount: penaltyAmount,
          outstanding: loan.outstanding,
          action: 'penalty',
          date: new Date().toISOString(),
        },
      ];
      await loan.save();

      logger.info({ loanId, penaltyAmount, newOutstanding: loan.outstanding }, 'Admin test penalty applied');

      return res.status(200).json({
        status: 'success',
        data: {
          loanId,
          loanAmount: loan.amount,
          penaltyRate: '1%',
          penaltyAmount,
          previousOutstanding,
          newOutstanding: loan.outstanding,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Test penalty failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * POST /backoffice/test-integrations/auto-debit
   * body: { userId }
   * Tests auto-debit charge on a user's linked payment method
   */
  static async testAutoDebit(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, amount } = req.body;
      if (!userId) return res.status(400).json({ status: 'failed', message: 'User ID is required' });

      const { AutoDebit } = await import('../../modules/loans/auto-debit.model');
      const { FlutterwaveDebitProvider } = await import('../../shared/providers/flutterwave-debit.provider');

      const methods = await AutoDebit.find({ userId: String(userId), status: 'active' }).lean();
      if (!methods.length) {
        return res.status(404).json({ status: 'failed', message: 'No active payment methods found for this user' });
      }

      const testAmount = amount || 100; // Minimum test amount
      const method = methods[0] as any; // Use first active method
      const provider = new FlutterwaveDebitProvider();

      let result: any;
      if (method.type === 'card' && method.token) {
        result = await provider.chargeToken({
          token: method.token,
          email: method.email || '',
          amount: testAmount,
          txRef: `test-${Date.now()}`,
        });
      } else if (method.type === 'bank') {
        result = { message: 'Bank e-mandate charge requires full flow — token found', token: method.token };
      } else {
        result = { message: 'Unknown method type', method };
      }

      logger.info({ userId, amount: testAmount }, 'Admin test auto-debit initiated');

      return res.status(200).json({
        status: 'success',
        data: {
          userId,
          methodType: method.type,
          testAmount,
          result,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Test auto-debit failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * POST /backoffice/test-integrations/wallet-deduction
   * body: { userId, amount }
   * Tests wallet deduction for a user
   */
  static async testWalletDeduction(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, amount } = req.body;
      if (!userId || !amount) return res.status(400).json({ status: 'failed', message: 'userId and amount are required' });

      const UserModel = (await import('../../modules/users/user.model')).default;
      const user = await UserModel.findById(userId);
      if (!user) return res.status(404).json({ status: 'failed', message: 'User not found' });

      const currentBalance = Number(user.user_metadata?.wallet || 0);
      if (currentBalance < amount) {
        return res.status(400).json({
          status: 'failed',
          message: `Insufficient wallet balance. Current: ₦${currentBalance.toLocaleString()}, Requested: ₦${Number(amount).toLocaleString()}`,
        });
      }

      // Apply deduction
      user.user_metadata.wallet = String(currentBalance - Number(amount));
      await user.save();

      logger.info({ userId, amount, previousBalance: currentBalance, newBalance: user.user_metadata.wallet }, 'Admin test wallet deduction');

      return res.status(200).json({
        status: 'success',
        data: {
          userId,
          deductedAmount: Number(amount),
          previousBalance: currentBalance,
          newBalance: user.user_metadata.wallet,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Test wallet deduction failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }
}
