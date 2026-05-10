import NodeCache from 'node-cache';
import {
  NormalizedBillProvider,
  AirtimePurchaseParams,
  DataPurchaseParams,
  TVPurchaseParams,
  PowerPurchaseParams,
  BettingPurchaseParams,
  ValidationParams,
  BillValidationResult,
  BillProviderResult,
  BillCategory,
  BillBiller,
  BillProduct
} from './bill-provider.interface';
import { VfdProvider } from '../../../shared/providers/vfd.provider';
import pino from 'pino';

const logger = pino({ name: 'vfd-bill-provider' });

/* ---------- Cached VFD Discovery Types ---------- */

interface VfdBillerEntry {
  billerId: string;
  billerName: string;
  division: string;
  categoryName: string;
  raw: any; // full API response for reference
}

interface VfdProductEntry {
  productId: string;
  paymentItem: string; // paymentCode from API
  productName: string;
  amount: number;
  raw: any;
}

/* ---------- Frontend-to-Network Name Mapping ---------- */

/**
 * Maps Flutterwave frontend IDs to human-readable network/provider names.
 * This is used to fuzzy-match against VFD's billerName.
 */
const FRONTEND_ID_TO_NAME: Record<string, string> = {
  // Airtime (frontend uses these as serviceId)
  'BIL099': 'MTN',
  'BIL100': 'Airtel',
  'BIL102': 'Glo',
  'BIL103': '9mobile',
  // Data (frontend uses these as serviceId)
  'BIL108': 'MTN',
  'BIL109': 'Glo',
  'BIL110': 'Airtel',
  'BIL111': '9mobile',
  // Airtime item codes
  'AT099': 'MTN',
  'AT100': 'Airtel',
  'AT133': 'Glo',
  'AT134': '9mobile',
  // TV
  'BIL121': 'DSTV',
  'BIL122': 'GOTV',
  'BIL123': 'Startimes',
  // Power
  'BIL112': 'Eko Electric',
  'BIL113': 'Ikeja Electric',
  'BIL114': 'Ibadan Electric',
  'BIL115': 'Kaduna Electric',
  'BIL116': 'Port Harcourt Electric',
  'BIL117': 'Jos Electric',
  'BIL118': 'Benin Electric',
  'BIL119': 'Kano Electric',
  'BIL120': 'Enugu Electric',
  'BIL135': 'Abuja Electric',
};

/**
 * Maps internal category names to VFD's expected categoryName values.
 */
const CATEGORY_TO_VFD: Record<string, string> = {
  'airtime': 'Airtime',
  'data': 'Data',
  'tv': 'Cable TV',
  'power': 'Electricity',
  'betting': 'Betting',
  'internet': 'Internet',
};

/* ---------- Provider Implementation ---------- */

const discoveryCache = new NodeCache({ stdTTL: 24 * 60 * 60 }); // 24h

export class VfdBillProvider implements NormalizedBillProvider {
  readonly providerName = 'vfd';
  private vfdApi: VfdProvider;

  constructor() {
    this.vfdApi = new VfdProvider();
  }

  /* ═══════════════════════════════════════════════
   * DISCOVERY: Resolve real VFD IDs from their API
   * ═══════════════════════════════════════════════ */

  /**
   * Fetch and cache the full biller list for a VFD category.
   */
  private async fetchBillers(vfdCategory: string): Promise<VfdBillerEntry[]> {
    const cacheKey = `vfd_billers_${vfdCategory}`;
    const cached = discoveryCache.get<VfdBillerEntry[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await this.vfdApi.getBillerList(vfdCategory);
      const billers: VfdBillerEntry[] = (res.data || []).map((b: any) => ({
        billerId: b.billerId || b.id || b.name,
        billerName: b.billerName || b.name || '',
        division: b.division || b.divisionId || '',
        categoryName: b.categoryName || vfdCategory,
        raw: b,
      }));
      logger.info({ category: vfdCategory, count: billers.length, billers: billers.map(b => ({ id: b.billerId, name: b.billerName, div: b.division })) }, 'VFD biller discovery');
      discoveryCache.set(cacheKey, billers);
      return billers;
    } catch (err: any) {
      logger.error({ category: vfdCategory, error: err.message }, 'VFD biller discovery failed');
      return [];
    }
  }

  /**
   * Fetch and cache products for a specific VFD billerId.
   */
  private async fetchProducts(vfdBillerId: string): Promise<VfdProductEntry[]> {
    const cacheKey = `vfd_products_${vfdBillerId}`;
    const cached = discoveryCache.get<VfdProductEntry[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await this.vfdApi.getBillerItems(vfdBillerId);
      const products: VfdProductEntry[] = (res.data || []).map((p: any) => ({
        productId: p.productId || p.id || p.item_code || '',
        paymentItem: p.paymentCode || p.paymentItem || p.productId || p.id || '',
        productName: p.paymentItem || p.name || p.productName || '',
        amount: Number(p.amount) || 0,
        raw: p,
      }));
      logger.info({ billerId: vfdBillerId, count: products.length, products: products.slice(0, 5).map(p => ({ id: p.productId, name: p.productName, code: p.paymentItem })) }, 'VFD product discovery');
      discoveryCache.set(cacheKey, products);
      return products;
    } catch (err: any) {
      logger.error({ billerId: vfdBillerId, error: err.message }, 'VFD product discovery failed');
      return [];
    }
  }

  /**
   * Resolve a frontend biller ID to the real VFD biller entry.
   * Uses fuzzy matching by network name against VFD's billerName.
   */
  private async resolveBiller(category: string, frontendId: string): Promise<VfdBillerEntry | null> {
    const vfdCategory = CATEGORY_TO_VFD[category] || category;
    const billers = await this.fetchBillers(vfdCategory);

    if (billers.length === 0) {
      logger.warn({ category, frontendId }, 'No billers found from VFD — cannot resolve');
      return null;
    }

    // 1. Exact match on billerId
    const exact = billers.find(b => b.billerId === frontendId);
    if (exact) return exact;

    // 2. Fuzzy match: convert frontend ID to a known name, then match against billerName
    const knownName = FRONTEND_ID_TO_NAME[frontendId] || frontendId;
    const lower = knownName.toLowerCase();

    const fuzzy = billers.find(b => {
      const bName = b.billerName.toLowerCase();
      const bId = b.billerId.toLowerCase();
      return bName.includes(lower) || bId.includes(lower) || lower.includes(bName.split(' ')[0]?.toLowerCase());
    });

    if (fuzzy) {
      logger.info({ frontendId, resolvedTo: fuzzy.billerId, billerName: fuzzy.billerName }, 'Biller resolved via fuzzy match');
      return fuzzy;
    }

    // 3. If only 1 biller in category, use it (e.g. single airtime provider)
    if (billers.length === 1) {
      logger.info({ frontendId, resolvedTo: billers[0].billerId }, 'Single biller in category — using it');
      return billers[0];
    }

    logger.warn({ frontendId, knownName, availableBillers: billers.map(b => b.billerId) }, 'Could not resolve biller');
    return null;
  }

  /**
   * Resolve a frontend item code to a real VFD product.
   */
  private async resolveProduct(vfdBillerId: string, frontendItemCode?: string): Promise<VfdProductEntry | null> {
    const products = await this.fetchProducts(vfdBillerId);

    if (products.length === 0) return null;

    // For airtime, there's typically one product or it doesn't matter
    if (!frontendItemCode) return products[0] || null;

    // Exact match
    const exact = products.find(p => p.productId === frontendItemCode || p.paymentItem === frontendItemCode);
    if (exact) return exact;

    // Fuzzy match by name
    const lower = frontendItemCode.toLowerCase();
    const fuzzy = products.find(p =>
      p.productName.toLowerCase().includes(lower) ||
      p.productId.toLowerCase().includes(lower)
    );
    if (fuzzy) return fuzzy;

    // Return first product as fallback for airtime
    return products[0] || null;
  }

  /* ═══════════════════════════════════════════════
   * PURCHASE METHODS
   * ═══════════════════════════════════════════════ */

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('airtime', params.network || '');
    if (!biller) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD biller for network: ${params.network}` };
    }

    // For airtime, get the first product (airtime is typically a single item)
    const product = await this.resolveProduct(biller.billerId);

    const payload = {
      amount: params.amount,
      customerId: params.phone,
      billerId: biller.billerId,
      productId: product?.productId || biller.billerId,
      division: biller.division,
      paymentItem: product?.paymentItem || biller.billerId,
      reference: params.reference,
      phoneNumber: params.phone,
    };

    logger.info({ payload }, 'VFD purchaseAirtime payload');
    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('data', params.network || '');
    if (!biller) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD biller for data network: ${params.network}` };
    }

    const product = await this.resolveProduct(biller.billerId, params.bundleCode);
    if (!product) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD product for bundle: ${params.bundleCode}` };
    }

    const payload = {
      amount: params.amount,
      customerId: params.phone,
      billerId: biller.billerId,
      productId: product.productId,
      division: biller.division,
      paymentItem: product.paymentItem,
      reference: params.reference,
      phoneNumber: params.phone,
    };

    logger.info({ payload }, 'VFD purchaseData payload');
    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('tv', params.provider);
    if (!biller) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD biller for TV: ${params.provider}` };
    }

    const product = await this.resolveProduct(biller.billerId, params.bouquetCode);
    if (!product) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD product for bouquet: ${params.bouquetCode}` };
    }

    const payload = {
      amount: params.amount,
      customerId: params.smartcardNo,
      billerId: biller.billerId,
      productId: product.productId,
      division: biller.division,
      paymentItem: product.paymentItem,
      reference: params.reference,
    };

    logger.info({ payload }, 'VFD purchaseTV payload');
    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('power', params.provider);
    if (!biller) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD biller for power: ${params.provider}` };
    }

    // For power, the product is typically "prepaid" or "postpaid"
    const products = await this.fetchProducts(biller.billerId);
    const meterLower = (params.meterType || 'prepaid').toLowerCase();
    const product = products.find(p =>
      p.productName.toLowerCase().includes(meterLower) ||
      p.productId.toLowerCase().includes(meterLower)
    ) || products[0];

    const payload = {
      amount: params.amount,
      customerId: params.meterNo,
      billerId: biller.billerId,
      productId: product?.productId || meterLower,
      division: biller.division,
      paymentItem: product?.paymentItem || biller.billerId,
      reference: params.reference,
    };

    logger.info({ payload }, 'VFD purchasePower payload');
    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('betting', params.provider);
    if (!biller) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD biller for betting: ${params.provider}` };
    }

    const product = await this.resolveProduct(biller.billerId);

    const payload = {
      amount: params.amount,
      customerId: params.customerId,
      billerId: biller.billerId,
      productId: product?.productId || biller.billerId,
      division: biller.division,
      paymentItem: product?.paymentItem || biller.billerId,
      reference: params.reference,
    };

    logger.info({ payload }, 'VFD purchaseBetting payload');
    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  /* ═══════════════════════════════════════════════
   * VALIDATION
   * ═══════════════════════════════════════════════ */

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    const category = params.serviceType || 'tv';
    const frontendId = params.provider || params.itemCode || '';

    const biller = await this.resolveBiller(category, frontendId);
    if (!biller) {
      logger.warn({ category, frontendId }, 'Could not resolve biller for validation — returning invalid');
      return { valid: false, name: '' };
    }

    // Get the product so we have the correct paymentItem for validation
    const product = await this.resolveProduct(biller.billerId, params.itemCode);

    try {
      const res = await this.vfdApi.validateBillerCustomer(
        params.customerRef,
        biller.billerId,
        biller.division,
        product?.paymentItem || product?.productId
      );

      logger.info({ customerRef: params.customerRef, billerId: biller.billerId, response: res }, 'VFD validation response');

      if (res?.status === '00' || res?.status === 'Success' || res?.status === 'success') {
        return {
          valid: true,
          name: res.data?.name || res.data?.customerName || res.data?.customer || 'Valid Customer',
          meta: { ...res.data, address: res.data?.address, customer: res.data?.customerId || params.customerRef }
        };
      }
      return { valid: false, name: '' };
    } catch (e: any) {
      logger.error({ error: e.message, customerRef: params.customerRef, billerId: biller?.billerId }, 'VFD validation error');
      return { valid: false, name: '' };
    }
  }

  /* ═══════════════════════════════════════════════
   * CATALOG DISCOVERY (exposed to frontend)
   * ═══════════════════════════════════════════════ */

  async getCategories(): Promise<BillCategory[]> {
    try {
      const res = await this.vfdApi.getBillerCategories();
      return (res.data || []).map((c: any) => ({
        id: this.normalizeCategoryId(c.name || c.id),
        name: c.name,
        description: c.description || ''
      }));
    } catch (err: any) {
      logger.error({ error: err.message }, 'getCategories failed');
      return [];
    }
  }

  async getBillers(categoryId: string): Promise<BillBiller[]> {
    const vfdCategory = CATEGORY_TO_VFD[categoryId] || categoryId;
    const billers = await this.fetchBillers(vfdCategory);
    return billers.map(b => ({
      id: b.billerId,
      name: b.billerName,
      categoryId: categoryId,
    }));
  }

  async getProducts(billerId: string): Promise<BillProduct[]> {
    // billerId here may be a frontend ID or a real VFD billerId.
    // Try fetching directly first; if empty, try resolving it.
    let products = await this.fetchProducts(billerId);

    if (products.length === 0) {
      // The billerId might be a Flutterwave code — try to resolve it
      // We don't know the category, so try common ones
      for (const cat of ['airtime', 'data', 'tv', 'power', 'betting', 'internet']) {
        const biller = await this.resolveBiller(cat, billerId);
        if (biller) {
          products = await this.fetchProducts(biller.billerId);
          if (products.length > 0) break;
        }
      }
    }

    return products.map(p => ({
      id: p.productId,
      name: p.productName,
      billerId: billerId,
      amount: p.amount,
      item_code: p.productId,
      meta: p.raw,
    }));
  }

  /* ═══════════════════════════════════════════════
   * UTILITY
   * ═══════════════════════════════════════════════ */

  async getBalance(): Promise<{ balance: number }> {
    const res = await this.vfdApi.getPrimeAccountInfo();
    return { balance: Number(res?.data?.accountBalance || 0) };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.vfdApi.getPrimeAccountInfo();
      return true;
    } catch {
      return false;
    }
  }

  private mapResponse(res: any, reference: string): BillProviderResult {
    const statusRaw = res?.status?.toString?.() || '';
    const isSuccess = statusRaw === '00' || statusRaw.toLowerCase() === 'success';

    if (isSuccess) {
      return {
        success: true,
        reference,
        status: 'COMPLETED',
        message: res.message || 'Payment successful'
      };
    }
    return {
      success: false,
      reference,
      status: 'FAILED',
      message: res?.message || 'Payment failed'
    };
  }

  private normalizeCategoryId(nameOrId: string): string {
    if (!nameOrId) return '';
    const lower = nameOrId.toLowerCase();
    if (lower.includes('airtime')) return 'airtime';
    if (lower.includes('data')) return 'data';
    if (lower.includes('cable') || lower.includes('tv')) return 'tv';
    if (lower.includes('electric') || lower.includes('power')) return 'power';
    if (lower.includes('betting')) return 'betting';
    if (lower.includes('internet')) return 'internet';
    return nameOrId;
  }
}
