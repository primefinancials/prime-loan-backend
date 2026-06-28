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
   * body: { fromAccount, toAccount, amount, remark, beneficiaryName }
   * Tests actual VFD transfer - RESTRICTED TO INTRABANK ONLY (Prime Bank)
   */
  static async testTransfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { fromAccount, toAccount, amount, remark, beneficiaryName } = req.body;
      const numAmount = Number(amount);
      const adminId = (req as any).admin?._id || (req as any).admin?.id || 'admin-system';

      // ENFORCE INTRABANK (Prime Bank)
      const bankCode = '999999';
      const transferType = 'intra';

      if (!toAccount || !numAmount) {
        return res.status(400).json({ 
          status: 'failed', 
          message: 'toAccount and amount (positive number) are required',
          received: { toAccount, amount }
        });
      }

      const vfdProvider = new VfdProvider();

      // 1. Validate both accounts exist on platform (except Prime/Company account)
      const UserModel = (await import('../../modules/users/user.model')).default;
      const [fromUser, toUser] = await Promise.all([
        UserModel.findOne({ "user_metadata.accountNo": fromAccount }),
        UserModel.findOne({ "user_metadata.accountNo": toAccount })
      ]);

      if (!fromAccount && !fromUser) {
        // Defaults to Prime Account in getAccountInfo if fromAccount is undefined
      } else if (fromAccount && !fromUser) {
        return res.status(404).json({ status: 'failed', message: 'Source account not found in platform database' });
      }

      if (!toUser) {
        return res.status(404).json({ status: 'failed', message: 'Destination account not found in platform database' });
      }

      // 2. Get From Account Info to verify it exists on VFD and get balances
      const accountRes = await vfdProvider.getAccountInfo((fromAccount && fromAccount !== '') ? fromAccount : undefined);
      if (!accountRes.data) return res.status(404).json({ status: 'failed', message: 'Source account not found on VFD' });

      const fromData = accountRes.data;

      // 3. Get Beneficiary Info (Mandatory for VFD transfers)
      const beneRes = await vfdProvider.getBeneficiary(toAccount, bankCode, transferType);
      if (!beneRes.data) return res.status(404).json({ status: 'failed', message: 'Beneficiary account not found on VFD' });
      const beneData = beneRes.data;

      // 4. Initiate Transfer (RECORD TO DB)
      const initResult = await TransferService.initiateTransfer({
        fromAccount: fromData.accountNo,
        toAccount,
        amount: numAmount,
        bankCode,
        beneficiaryName: beneficiaryName || beneData.name || "Admin Test",
        remark: remark || "Admin Intrabank Test",
        transferType,
        walletBalance: String(fromData.accountBalance),
        userId: String(adminId),
        skipBalanceCheck: true,
        skipDbRecord: false // ALWAYS RECORD
      }, 'transfer');

      // 5. Execute VFD Transfer
      const transferReq = {
        fromAccount: fromData.accountNo,
        uniqueSenderAccountId: fromAccount ? fromData.accountId : "", 
        fromClientId: fromData.clientId,
        fromClient: fromData.client,
        fromSavingsId: fromData.accountId,
        toAccount,
        toClient: beneData.name,
        toClientId: beneData.clientId,
        toSavingsId: beneData.account?.id || "",
        toSession: beneData.account?.id || "",
        toBank: bankCode,
        signature: sha512.hex(`${fromData.accountNo}${toAccount}`),
        amount: numAmount,
        remark: remark || "Admin UI Test",
        transferType: transferType as "intra" | "inter",
        reference: initResult.reference || randomUUID(),
      };

      const vfdResponse = await vfdProvider.transfer(transferReq);
      logger.info({ traceId: initResult.traceId, vfdStatus: vfdResponse.status }, 'VFD transfer completed');

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
      logger.error({ error: err.message, stack: err.stack }, 'Test transfer failed');
      
      // Handle Axios errors from VFD
      if (err.isAxiosError && err.response) {
        return res.status(err.response.status || 400).json({
          status: 'failed',
          message: err.response.data?.message || err.message,
          data: err.response.data
        });
      }

      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * GET /backoffice/test-integrations/paybeta/wallet
   * Retrieves PayBeta wallet balance
   */
  static async getPaybetaWallet(req: Request, res: Response) {
    try {
      const { PayBetaProvider } = await import('../../shared/providers/paybeta.provider');
      const provider = new PayBetaProvider();
      const balance = await provider.getWalletBalance();
      return res.status(200).json({
        status: 'success',
        data: balance.data,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'PayBeta wallet query failed');
      return res.status(err.status || 500).json({
        status: 'failed',
        message: err.message,
      });
    }
  }

  /**
   * GET /backoffice/test-integrations/paybeta/providers
   * query: { type: 'airtime' | 'data' }
   */
  static async getPaybetaProviders(req: Request, res: Response) {
    try {
      const { type } = req.query;
      const { PayBetaProvider } = await import('../../shared/providers/paybeta.provider');
      const provider = new PayBetaProvider();
      let result;
      if (type === 'data') {
        result = await provider.getDataProviders();
      } else {
        result = await provider.getAirtimeProviders();
      }
      return res.status(200).json({
        status: 'success',
        data: result.data,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'PayBeta providers query failed');
      return res.status(err.status || 500).json({
        status: 'failed',
        message: err.message,
      });
    }
  }

  /**
   * GET /backoffice/test-integrations/paybeta/data-bundles
   * query: { service: string }
   */
  static async getPaybetaDataBundles(req: Request, res: Response) {
    try {
      const { service } = req.query;
      if (!service) {
        return res.status(400).json({ status: 'failed', message: 'service parameter is required' });
      }
      const { PayBetaProvider } = await import('../../shared/providers/paybeta.provider');
      const provider = new PayBetaProvider();
      const result = await provider.getDataBundles(String(service));
      return res.status(200).json({
        status: 'success',
        data: result.data || result,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'PayBeta data bundles query failed');
      return res.status(err.status || 500).json({
        status: 'failed',
        message: err.message,
      });
    }
  }

  /**
   * POST /backoffice/test-integrations/paybeta/airtime
   * body: { service, phoneNumber, amount }
   */
  static async buyPaybetaAirtime(req: Request, res: Response) {
    try {
      const { service, phoneNumber, amount } = req.body;
      if (!service || !phoneNumber || !amount) {
        return res.status(400).json({
          status: 'failed',
          message: 'service, phoneNumber, and amount are required',
        });
      }
      const { PayBetaProvider } = await import('../../shared/providers/paybeta.provider');
      const provider = new PayBetaProvider();
      // Generate a numeric reference to be absolutely safe with PayBeta validation
      const reference = `${Date.now()}`;

      logger.info({ service, phoneNumber, amount, reference }, 'Admin PayBeta console airtime purchase initiated');
      const result = await provider.buyAirtime({
        service: String(service),
        phoneNumber: String(phoneNumber),
        amount: Number(amount),
        reference,
      });

      return res.status(200).json({
        status: 'success',
        data: {
          ...result,
          consoleReference: reference,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'PayBeta console airtime purchase failed');
      return res.status(err.status || 500).json({
        status: 'failed',
        message: err.message,
      });
    }
  }

  /**
   * POST /backoffice/test-integrations/paybeta/data
   * body: { service, code, phoneNumber, amount }
   */
  static async buyPaybetaData(req: Request, res: Response) {
    try {
      const { service, code, phoneNumber, amount } = req.body;
      if (!service || !code || !phoneNumber || !amount) {
        return res.status(400).json({
          status: 'failed',
          message: 'service, code, phoneNumber, and amount are required',
        });
      }
      const { PayBetaProvider } = await import('../../shared/providers/paybeta.provider');
      const provider = new PayBetaProvider();
      const reference = `${Date.now()}`;

      logger.info({ service, code, phoneNumber, amount, reference }, 'Admin PayBeta console data bundle purchase initiated');
      const result = await provider.buyData({
        service: String(service),
        code: String(code),
        phoneNumber: String(phoneNumber),
        amount: Number(amount),
        reference,
      });

      return res.status(200).json({
        status: 'success',
        data: {
          ...result,
          consoleReference: reference,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'PayBeta console data bundle purchase failed');
      return res.status(err.status || 500).json({
        status: 'failed',
        message: err.message,
      });
    }
  }
  /**
   * POST /backoffice/test-integrations/flutterwave/transfer
   * body: { bankCode, accountNumber, amount, narration, beneficiaryName }
   * Tests actual Flutterwave transfer (withdrawal) without logging to DB
   */
  static async testFlutterwaveTransfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { bankCode, accountNumber, amount, narration, beneficiaryName } = req.body;
      const numAmount = Number(amount);

      if (!bankCode || !accountNumber || !numAmount) {
        return res.status(400).json({ 
          status: 'failed', 
          message: 'bankCode, accountNumber, and amount (positive number) are required',
        });
      }

      const { FlutterwavePayoutProvider } = await import('../../shared/providers/flutterwave-payout.provider');
      const provider = new FlutterwavePayoutProvider();

      const reference = `admin-payout-${Date.now()}`;
      
      logger.info({ bankCode, accountNumber, amount: numAmount, reference }, 'Admin Flutterwave transfer initiated');
      
      const result = await provider.createTransfer({
        bankCode,
        accountNumber,
        amount: numAmount,
        reference,
        narration: narration || 'Admin Manual Withdrawal',
        beneficiaryName
      });

      return res.status(200).json({
        status: 'success',
        data: {
          ...result,
          timestamp: new Date().toISOString(),
        }
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin Flutterwave transfer failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * POST /backoffice/test-integrations/flutterwave/bill
   * body: { type, billerName, customer, amount }
   * Tests actual Flutterwave bill payment (airtime/data) without logging to DB
   */
  static async testFlutterwaveBillPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, billerName, customer, amount } = req.body;

      if (!type || !billerName || !customer || !amount) {
        return res.status(400).json({ 
          status: 'failed', 
          message: 'type, billerName, customer, and amount are required',
        });
      }

      // We'll dynamically construct the API request since we don't have a dedicated FLW Bill provider yet
      const axios = (await import('axios')).default;
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
      
      if (!secretKey) {
        throw new Error('FLUTTERWAVE_SECRET_KEY is not configured');
      }

      const reference = `admin-bill-${Date.now()}`;
      
      logger.info({ type, customer, amount, reference }, 'Admin Flutterwave bill payment initiated');

      const paymentType = type === 'AIRTIME' ? 'AIRTIME' : billerName;

      const response = await axios.post(
        'https://api.flutterwave.com/v3/bills',
        {
          country: 'NG',
          customer,
          amount: Number(amount),
          type: paymentType,
          biller_name: billerName,
          reference,
        },
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return res.status(200).json({
        status: 'success',
        data: {
          reference,
          response: response.data,
          timestamp: new Date().toISOString(),
        }
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin Flutterwave bill payment failed');
      if (err.isAxiosError && err.response) {
        return res.status(err.response.status || 400).json({
          status: 'failed',
          message: err.response.data?.message || err.message,
          data: err.response.data
        });
      }
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * GET /backoffice/test-integrations/flutterwave/bill-categories
   * query: { airtime: boolean, data: boolean }
   * Fetches active bill categories from Flutterwave for dynamic selection
   */
  static async testFlutterwaveBillCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { airtime, data } = req.query;
      const axios = (await import('axios')).default;
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
      
      if (!secretKey) {
        throw new Error('FLUTTERWAVE_SECRET_KEY is not configured');
      }

      // We add airtime=1 or data_bundle=1 parameter to filter if requested
      const params: any = { country: 'NG' };
      if (airtime === 'true') params.airtime = 1;
      if (data === 'true') params.data_bundle = 1;

      const response = await axios.get('https://api.flutterwave.com/v3/bill-categories', {
        params,
        headers: {
          Authorization: `Bearer ${secretKey}`
        }
      });

      return res.status(200).json({
        status: 'success',
        data: response.data.data
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin Flutterwave bill categories fetch failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * GET /backoffice/test-integrations/users/:userId/active-loans
   * Fetches active (accepted) loans for a specific user for admin automation
   */
  static async getUserActiveLoans(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const LoanModel = (await import('../../modules/loans/loan.model')).default;
      
      const loans = await LoanModel.find({
        user: userId,
        status: 'accepted'
      }).sort({ createdAt: -1 });

      return res.status(200).json({
        status: 'success',
        data: loans
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Admin fetch user active loans failed');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * GET /backoffice/test-integrations/flutterwave/banks
   */
  static async testFlutterwaveBanks(req: Request, res: Response, next: NextFunction) {
    try {
      const { FlutterwavePayoutProvider } = await import('../../shared/providers/flutterwave-payout.provider');
      const provider = new FlutterwavePayoutProvider();
      
      const axios = (await import('axios')).default;
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
      const response = await axios.get('https://api.flutterwave.com/v3/banks/NG', {
        headers: { Authorization: `Bearer ${secretKey}` }
      });

      return res.status(200).json({
        status: 'success',
        data: response.data.data
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to fetch Flutterwave banks');
      return res.status(500).json({ status: 'failed', message: err.message });
    }
  }

  /**
   * GET /backoffice/test-integrations/flutterwave/verify-account
   * query: { accountNumber, bankCode }
   */
  static async testFlutterwaveVerifyAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const { accountNumber, bankCode } = req.query;
      
      if (!accountNumber || !bankCode) {
        return res.status(400).json({ status: 'failed', message: 'accountNumber and bankCode are required' });
      }

      const { FlutterwaveDebitProvider } = await import('../../shared/providers/flutterwave-debit.provider');
      const provider = new FlutterwaveDebitProvider();
      
      const details = await provider.validateBankAccount(String(accountNumber), String(bankCode));
      
      return res.status(200).json({
        status: 'success',
        data: details
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to verify account on Flutterwave');
      return res.status(400).json({ status: 'failed', message: err.message });
    }
  }
}
