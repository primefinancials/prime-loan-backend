/**
 * Bill Payment Service — Multi-Provider Orchestrator
 *
 * - Uses NormalizedBillProvider (Flutterwave or VFD) based on admin settings
 * - Automatic failover on network errors
 * - Transparent to frontend — unified catalog format
 * - Uses TransferService + VfdProvider for ledger/transfer prefunding
 * - Orchestrates via processTransaction(...) for the debit/refund lifecycle
 *
 * PayBeta has been fully removed. Only Flutterwave and VFD are supported.
 *
 * FIX: The `airtime` case in providerFn now passes `itemCode: req.itemCode`
 * into purchaseAirtime. Previously itemCode was omitted, so Flutterwave's
 * provider had to re-derive it from its hardcoded map — and if the frontend
 * had already resolved the correct item code from the live catalog, that
 * correct code was silently discarded, causing "Invalid Biller or item
 * selected" errors.
 */
import { sha512 } from 'js-sha512';
import NodeCache from 'node-cache';
import { TransferService } from '../transfers/transfer.service';
import { VfdProvider, TransferRequest } from '../../shared/providers/vfd.provider';
import { processTransaction } from '../../shared/transactions/BillPaymentTransactionProcessor';
import User from '../users/user.model';
import { BillPayment } from './bill-payment.model';
import { InitiateBillPaymentRequest } from './bill-payment.interface';
import { getBillProvider, withFailover } from './providers/bill-provider.factory';
import { NormalizedBillProvider, BillCategory, BillBiller, BillProduct } from './providers/bill-provider.interface';
import logger from '../../shared/utils/logger';

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

    // 1️⃣ Handle Referral Discounts / Commissions
    const { InfluencerService } = await import('../influencer/influencer.service');
    const referral = await InfluencerService.resolveReferralCode(req.referralCode || '');

    let debitAmount = req.amount;
    let discountValue = 0;
    let bonusAmount = 0;

    if (referral) {
      const discountResult = InfluencerService.applyReferralDiscount(req.amount, referral.discountConfig);
      debitAmount = discountResult.discountedAmount;
      discountValue = discountResult.discountValue;
      bonusAmount = discountResult.bonusAmount;
      logger.info(
        { userId, original: req.amount, discounted: debitAmount, referralCode: req.referralCode },
        'Applied referral discount to bill payment'
      );
    }

    const result = await processTransaction({
      userId: req.userId,
      amount: debitAmount,
      serviceType: req.serviceType,
      serviceId: req.serviceId,
      customerReference: req.customerReference,
      idempotencyKey,
      referralCode: req.referralCode,

      providerFn: async () => {
        // The bill provider always receives the ORIGINAL requested amount —
        // discounts are absorbed by us, not passed to the provider.
        return await withFailover(async (provider) => {
          switch (req.serviceType) {
            case 'airtime':
              return await provider.purchaseAirtime({
                phone: req.customerReference,
                amount: req.amount,
                network: req.serviceId,
                reference: idempotencyKey,
                // FIX: forward the item code resolved from the live catalog by
                // the frontend. Without this, Flutterwave re-derives the item
                // code from a hardcoded map, which can diverge from what the
                // FW catalog actually returns and causes 400 errors.
                itemCode: req.itemCode,
              });

            case 'data':
              return await provider.purchaseData({
                phone: req.customerReference,
                amount: req.amount,
                bundleCode: req.itemCode,
                network: req.serviceId,
                reference: idempotencyKey,
              });

            case 'tv':
              return await provider.purchaseTV({
                smartcardNo: req.customerReference,
                amount: req.amount,
                bouquetCode: req.itemCode,
                provider: req.serviceId,
                reference: idempotencyKey,
              });

            case 'power':
              return await provider.purchasePower({
                meterNo: req.customerReference,
                amount: req.amount,
                meterType: req.meterType || 'prepaid',
                provider: req.serviceId,
                reference: idempotencyKey,
              });

            case 'betting':
              return await provider.purchaseBetting({
                customerId: req.customerReference,
                amount: req.amount,
                provider: req.serviceId,
                reference: idempotencyKey,
              });

            default:
              throw new Error(`Unsupported serviceType: ${req.serviceType}`);
          }
        }, `bill-payment-${req.serviceType}`);
      },

      txnProvider: async () => {
        // Both TransferService.initiateTransfer and vfdProvider.transfer use
        // `debitAmount` (the discounted amount the user is actually charged).
        const transferRecord = await TransferService.initiateTransfer({
          fromAccount: from.accountNo,
          userId,
          toAccount: to.accountNo,
          beneficiaryName: to.client,
          amount: debitAmount,
          transferType: 'intra',
          bankCode: '999999',
          remark: `${req.serviceType} purchase`,
          walletBalance: String(from.accountBalance),
          idempotencyKey,
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
          amount: debitAmount,
          remark: `${req.serviceType} purchase`,
          transferType: 'intra',
          reference: transferRecord.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);
        return { ...vfdResult, reference: transferRecord.reference };
      },

      refundProvider: async () => {
        const refundKey = `refund_${idempotencyKey}`;
        const transferRecord = await TransferService.initiateTransfer({
          fromAccount: to.accountNo,
          userId,
          toAccount: from.accountNo,
          beneficiaryName: from.client,
          amount: debitAmount,
          transferType: 'intra',
          bankCode: '999999',
          remark: `${req.serviceType} purchase refund`,
          walletBalance: String(to.accountBalance),
          idempotencyKey: refundKey,
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
          amount: debitAmount,
          remark: `${req.serviceType} purchase refund`,
          transferType: 'intra',
          reference: transferRecord.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);
        return { ...vfdResult, reference: transferRecord.reference };
      },
    });

    // Record commission only for successful transactions (fire-and-forget).
    if (result.status === 'COMPLETED') {
      InfluencerService.recordCommissionForUser(
        req.userId,
        'bill-payment',
        debitAmount,
        undefined,
        req.referralCode
      ).catch(err =>
        logger.warn(
          { err: err.message, userId: req.userId, referralCode: req.referralCode },
          'Bill payment commission recording failed (non-fatal)'
        )
      );
    }

    return result;
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

  static async getBillItems(billerCode: string, categoryId?: string) {
    const provider = await getBillProvider();
    const cacheKey = `${provider.providerName}_items_${billerCode}_${categoryId || 'all'}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const data = await provider.getProducts(billerCode, categoryId);
    billCache.set(cacheKey, data);
    return data;
  }

  static async validateServiceAccount(
    itemCode: string,
    customerReference: string | number,
    serviceType?: string,
    providerName?: string
  ) {
    const activeProvider = await getBillProvider();

    // Validation is optional/skippable for airtime and data on both providers
    const isAirtime = serviceType === 'airtime' || itemCode?.startsWith('AT');
    const isData = serviceType === 'data';

    if (isAirtime || isData) {
      return { name: 'Verified', valid: true, meta: { message: 'Validation skipped for airtime/data' } };
    }

    return await withFailover(async (P) => {
      return await P.validateAccount({
        serviceType: (serviceType || 'tv') as any,
        customerRef: String(customerReference),
        itemCode,
        provider: providerName,
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
      balance,
    };
  }

  /* ─────────────────────────────────────────────
   * DOWNTIME CHECK
   * ───────────────────────────────────────────── */

  static async checkServiceDowntime(billerCode: string): Promise<boolean> {
    const bill = await BillPayment.findOne({ serviceId: billerCode }).lean();
    return !!bill;
  }

  /* ─────────────────────────────────────────────
   * USER / ADMIN BILL PAYMENT QUERIES
   * ───────────────────────────────────────────── */

  static async getUserBillPayments(
    userId: string,
    page = 1,
    limit = 20,
    status?: string,
    type?: string,
    search?: string
  ) {
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

  static async getBillPayments(
    page = 1,
    limit = 20,
    status?: string,
    type?: string,
    search?: string
  ) {
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