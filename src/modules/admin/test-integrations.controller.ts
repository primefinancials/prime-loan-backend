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
import { TransferService } from '../../modules/transfers/transfer.service';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { sha512 } from 'js-sha512';
import { randomUUID } from 'crypto';

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

      const testMessage = message || 'This is a test call from Prime Loan admin panel.';

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

      const testMessage = message || 'This is a test SMS from Prime Loan admin panel.';
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

  /**
   * GET /backoffice/test-integrations/banks
   * Lists available banks for transfers
   */
  static async getBanks(req: Request, res: Response) {
    try {
      const vfdProvider = new VfdProvider();
      const banks = await vfdProvider.getBanks();
      return res.status(200).json({ status: 'success', data: banks.data });
    } catch (err: any) {
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * GET /backoffice/test-integrations/verify-beneficiary
   * query: { bankCode, accountNo }
   */
  static async nameEnquiry(req: Request, res: Response) {
    try {
      const { bankCode, accountNo } = req.query;
      if (!bankCode || !accountNo) return res.status(400).json({ status: 'failed', message: 'bankCode and accountNo are required' });

      const vfdProvider = new VfdProvider();

      // Use getBeneficiary directly as requested
      // bankCode '999999' is intra-bank (VFD to VFD)
      const transferType = String(bankCode) === "999999" ? "intra" : "inter";
      const result = await vfdProvider.getBeneficiary(String(accountNo), String(bankCode), transferType);

      if (result.status === 'success' || result.data || (result as any).status === 'Success') {
        const d = result.data as any;
        const resolvedName = d.accountName || d.name || d.client || d.account_name ||
          (d.firstname && d.lastname ? `${d.firstname} ${d.lastname}` : null);

        return res.status(200).json({
          status: 'success',
          data: { ...result.data, accountName: resolvedName }
        });
      } else {
        return res.status(400).json({
          status: 'failed',
          message: result.message || 'Verification failed',
          data: result.data
        });
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Name enquiry failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }


  /**
   * POST /backoffice/test-integrations/transfer
   * body: { fromAccount, toAccount, bankCode, amount, remark, beneficiaryName }
   * Tests actual VFD transfer but optionally skips local DB recording
   */
  static async testTransfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { fromAccount, toAccount, bankCode, amount, remark, beneficiaryName } = req.body;
      if (!toAccount || !amount || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'toAccount, amount, and bankCode are required' });
      }

      const vfdProvider = new VfdProvider();

      // 1. Get From Account Info to verify it exists and get balances
      const accountRes = await vfdProvider.getAccountInfo(fromAccount || undefined);
      if (!accountRes.data) return res.status(404).json({ status: 'failed', message: 'From account not found on VFD' });

      const fromData = accountRes.data;
      const transferType = (bankCode === '999999' || bankCode === 'vfd') ? 'intra' : 'inter';

      // 2. Initiate Transfer (Skip DB if it's just a "test" transfer as per user request)
      // We still call initiateTransfer but with skipDbRecord: true
      const initResult = await TransferService.initiateTransfer({
        fromAccount: fromData.accountNo,
        toAccount,
        amount,
        bankCode,
        beneficiaryName: beneficiaryName || "Test Transfer",
        remark: remark || "Admin UI Test",
        transferType,
        walletBalance: String(fromData.accountBalance),
        userId: 'admin-test',
        skipBalanceCheck: true,
        skipDbRecord: true
      }, 'transfer');

      // 3. Execute VFD Transfer
      const transferReq = {
        fromAccount: fromData.accountNo,
        uniqueSenderAccountId: fromData.accountId,
        fromClientId: fromData.clientId,
        fromClient: fromData.client,
        fromSavingsId: fromData.accountId,
        toAccount,
        toBank: bankCode,
        signature: sha512.hex(`${fromData.accountNo}${toAccount}`),
        amount: amount,
        remark: remark || "Admin UI Test",
        transferType: transferType as "intra" | "inter",
        reference: initResult.reference || randomUUID(),
      };

      const vfdResponse = await vfdProvider.transfer(transferReq);

      return res.status(200).json({
        status: vfdResponse.status === '00' ? 'success' : 'failed',
        message: vfdResponse.message,
        data: {
          traceId: initResult.traceId,
          reference: initResult.reference,
          vfdResponse: vfdResponse.data,
          vfdRaw: vfdResponse
        }
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Test transfer failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }
}
