/**
 * Bill Payment Service — Multi-Provider Orchestrator
 *
 * - Uses NormalizedBillProvider (Flutterwave or PayBeta) based on admin settings
 * - Automatic failover on network errors
 * - Transparent to frontend — unified catalog format
 * - Uses TransferService + VfdProvider for ledger/transfer prefunding
 * - Orchestrates via processTransaction(...) for the debit/refund lifecycle
 */
import { sha512 } from 'js-sha512';
import NodeCache from 'node-cache';
import { TransferService } from '../transfers/transfer.service';
import { VfdProvider, TransferRequest } from '../../shared/providers/vfd.provider';
import { processTransaction } from '../../shared/transactions/BillPaymentTransactionProcessor';
import User from '../users/user.model';
import { BillPayment } from './bill-payment.model';
import { InitiateBillPaymentRequest, ServiceType } from './bill-payment.interface';
import {
  getBillProvider, withFailover
} from './providers/bill-provider.factory';
import { NormalizedBillProvider, BillCategory, BillBiller, BillProduct } from './providers/bill-provider.interface';

const billCache = new NodeCache({ stdTTL: 24 * 60 * 60 }); // 24 hours

function cryptoRandom(): string {
  try {
    const { randomUUID } = require('crypto');
    return randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export default class BillPaymentService {

  /* ─────────────────────────────────────────────
   * PURCHASE ORCHESTRATION
   * ───────────────────────────────────────────── */

  static async initiateBillPayment(req: InitiateBillPaymentRequest) {
    const vfdProvider = new VfdProvider();
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const from = (await vfdProvider.getAccountInfo(user.user_metadata?.accountNo || 'trx-user')).data;
    const to = (await vfdProvider.getPrimeAccountInfo()).data;

    const idempotencyKey = req.idempotencyKey || cryptoRandom();

    return await processTransaction({
      userId: req.userId,
      amount: req.amount,
      serviceType: req.serviceType,
      serviceId: req.serviceId,
      customerReference: req.customerReference,
      idempotencyKey,
      providerFn: async () => {
        // Route to provider via normalizer — with automatic failover
        return await withFailover(async (provider) => {
          switch (req.serviceType) {
            case 'airtime':
              return await provider.purchaseAirtime({
                phone: req.customerReference,
                amount: req.amount,
                network: req.serviceId,
                reference: idempotencyKey
              });

            case 'data':
              return await provider.purchaseData({
                phone: req.customerReference,
                amount: req.amount,
                bundleCode: req.itemCode,
                network: req.serviceId,
                reference: idempotencyKey
              });

            case 'tv':
              return await provider.purchaseTV({
                smartcardNo: req.customerReference,
                amount: req.amount,
                bouquetCode: req.itemCode,
                provider: req.serviceId,
                reference: idempotencyKey
              });

            case 'power':
              return await provider.purchasePower({
                meterNo: req.customerReference,
                amount: req.amount,
                meterType: req.meterType || 'prepaid',
                provider: req.serviceId,
                reference: idempotencyKey
              });

            case 'betting':
              // Use airtime route as generic — providers handle gaming differently
              return await provider.purchaseAirtime({
                phone: req.customerReference,
                amount: req.amount,
                network: req.serviceId,
                reference: idempotencyKey
              });

            default:
              throw new Error(`Unsupported serviceType: ${req.serviceType}`);
          }
        }, `bill-payment-${req.serviceType}`);
      },
      txnProvider: async () => {
        const result = await TransferService.initiateTransfer({
          fromAccount: from.accountNo,
          userId,
          toAccount: to.accountNo,
          beneficiaryName: to.client,
          amount: req.amount,
          transferType: 'intra',
          bankCode: '999999',
          remark: `${req.serviceType} purchase`,
          walletBalance: String(from.accountBalance),
          idempotencyKey
        }, 'bill-payment');

        const transferReq: TransferRequest = {
          uniqueSenderAccountId: from.accountId,
          fromAccount: from.accountNo,
          fromClientId: from.clientId,
          fromClient: from.client,
          fromSavingsId: from.accountId,
          toAccount: to.accountNo,
          toClient: to.client,
          toSession: to.accountId,
          toClientId: to.clientId,
          toSavingsId: to.accountId,
          toBank: '999999',
          signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
          amount: req.amount,
          remark: `${req.serviceType} purchase`,
          transferType: 'intra',
          reference: result.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);
        return { ...vfdResult, reference: result.reference };
      },
      refundProvider: async () => {
        const result = await TransferService.initiateTransfer({
          fromAccount: to.accountNo,
          userId,
          toAccount: from.accountNo,
          beneficiaryName: from.client,
          amount: req.amount,
          transferType: 'intra',
          bankCode: '999999',
          remark: `${req.serviceType} purchase refund`,
          walletBalance: String(to.accountBalance),
          idempotencyKey
        }, 'bill-payment');

        const transferReq: TransferRequest = {
          uniqueSenderAccountId: '',
          fromAccount: to.accountNo,
          fromClientId: to.clientId,
          fromClient: to.client,
          fromSavingsId: to.accountId,
          toAccount: from.accountNo,
          toClient: from.client,
          toSession: from.accountId,
          toClientId: from.clientId,
          toSavingsId: from.accountId,
          toBank: '999999',
          signature: sha512.hex(`${to.accountNo}${from.accountNo}`),
          amount: req.amount,
          remark: `${req.serviceType} purchase refund`,
          transferType: 'intra',
          reference: result.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);
        return { ...vfdResult, reference: result.reference };
      }
    });
  }

  /* ─────────────────────────────────────────────
   * CATALOG DISCOVERY (unified format)
   * ───────────────────────────────────────────── */

  static async getSupportedCategories(country = 'NG') {
    const provider = await getBillProvider();
    const cacheKey = `${provider.providerName}_categories_${country}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const data = await provider.getCategories();
    billCache.set(cacheKey, data);
    return data;
  }

  static async getBillersByCategory(categoryCode: string, country = 'NG') {
    const provider = await getBillProvider();
    const cacheKey = `${provider.providerName}_billers_${categoryCode}_${country}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const data = await provider.getBillers(categoryCode);
    billCache.set(cacheKey, data);
    return data;
  }

  static async getBillItems(billerCode: string) {
    const provider = await getBillProvider();
    const cacheKey = `${provider.providerName}_items_${billerCode}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const data = await provider.getProducts(billerCode);
    billCache.set(cacheKey, data);
    return data;
  }

  static async validateServiceAccount(itemCode: string, customerReference: string | number, serviceType: string = 'tv', provider?: string) {
    return await withFailover(async (P) => {
      return await P.validateAccount({
        serviceType: serviceType as any,
        customerRef: String(customerReference),
        itemCode,
        provider
      });
    }, 'validate-account');
  }

  /* ─────────────────────────────────────────────
   * PROVIDER STATUS
   * ───────────────────────────────────────────── */

  static async getActiveProviderInfo() {
    const provider = await getBillProvider();
    const healthy = await provider.healthCheck().catch(() => false);
    let balance: number | null = null;
    try {
      const bal = await provider.getBalance();
      balance = bal.balance;
    } catch { /* ignore */ }

    return {
      provider: provider.providerName,
      healthy,
      balance
    };
  }

  /* ─────────────────────────────────────────────
   * DOWNTIME CHECK
   * ───────────────────────────────────────────── */

  static async checkServiceDowntime(billerCode: string): Promise<boolean> {
    const bill = await BillPayment.findOne({ serviceId: billerCode }).lean();
    if (!bill) return false;
    return true;
  }

  /* ─────────────────────────────────────────────
   * USER / ADMIN BILL PAYMENT QUERIES
   * ───────────────────────────────────────────── */

  static async getUserBillPayments(userId: string, page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;
    const query: any = { userId };
    if (status) query.status = status;
    if (type) query.serviceType = type;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { traceId: regex },
        { providerRef: regex },
        { customerReference: regex },
      ];
    }

    const billPayments = await BillPayment.find(query)
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await BillPayment.countDocuments(query);
    return { billPayments, page, pages: Math.ceil(total / limit), total };
  }

  static async getBillPayments(page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;
    const query: any = {};
    if (status) query.status = status;
    if (type) query.serviceType = type;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { traceId: regex },
        { providerRef: regex },
        { customerReference: regex },
      ];
    }

    const billPayments = await BillPayment.find(query)
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await BillPayment.countDocuments(query);
    return { billPayments, page, pages: Math.ceil(total / limit), total };
  }
}
