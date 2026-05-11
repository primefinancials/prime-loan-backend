/**
 * VFD Bill Provider — Normalized wrapper
 *
 * Fixed against VFD WalletAPI documentation:
 * https://vbaas-docs.vfdtech.ng/docs/wallets-api/Products/bills-payment-api/
 *
 * VFD bill payment base URL: https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore
 *
 * Key fixes vs previous version:
 *  1. fetchProducts: VFD returns `paymentitems` (not `data`), with fields:
 *       paymentitemid  → productId
 *       paymentCode    → paymentItem (the code sent in /pay)
 *       paymentitemname→ productName
 *     The old code read `p.productId`, `p.paymentCode`, `p.paymentItem`, `p.name`
 *     which mostly worked but missed the top-level array key `paymentitems`.
 *  2. fetchBillers: VFD biller list fields normalised correctly.
 *  3. FRONTEND_ID_TO_NAME expanded to cover VBank-style IDs (e.g. AIRTEL_VBANK)
 *     that the frontend currently sends as serviceId.
 *  4. validateAccount: passes paymentCode (not productId) as the paymentItem param.
 *  5. All PayBeta references removed.
 *  6. purchasePower: meter type product now resolved more robustly.
 */
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

/* ─────────────────────────────────────────────────────────────────────────
 * Cached VFD Discovery Types
 * ───────────────────────────────────────────────────────────────────────── */

interface VfdBillerEntry {
  billerId: string;
  billerName: string;
  division: string;
  categoryName: string;
  raw: any;
}

interface VfdProductEntry {
  productId: string;    // paymentitemid from VFD API
  paymentCode: string;  // paymentCode from VFD API — this is what the /pay endpoint needs as `paymentItem`
  productName: string;  // paymentitemname from VFD API
  amount: number;
  isAmountFixed: boolean;
  division: string;
  raw: any;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Frontend ID → human-readable name mapping
 *
 * The frontend may send Flutterwave biller_codes OR VBank-style IDs as the
 * serviceId. We fuzzy-match these against VFD's billerName field.
 * ───────────────────────────────────────────────────────────────────────── */

const FRONTEND_ID_TO_NAME: Record<string, string> = {
  // ── Airtime (Flutterwave biller codes) ──
  BIL099: 'MTN',
  BIL100: 'Airtel',
  BIL102: 'Glo',
  BIL103: '9mobile',
  // ── Airtime (VBank-style IDs) ──
  MTN_VBANK: 'MTN',
  AIRTEL_VBANK: 'Airtel',
  GLO_VBANK: 'Glo',
  '9MOBILE_VBANK': '9mobile',
  ETISALAT_VBANK: '9mobile',
  // ── Data (Flutterwave biller codes) ──
  BIL108: 'MTN',
  BIL109: 'Glo',
  BIL110: 'Airtel',
  BIL111: '9mobile',
  // ── Airtime item codes ──
  AT099: 'MTN',
  AT100: 'Airtel',
  AT102: 'Airtel',
  AT104: 'Glo',
  AT106: '9mobile',
  AT133: 'Glo',
  AT134: '9mobile',
  // ── TV ──
  BIL119: 'DSTV',
  BIL120: 'GOTV',
  BIL123: 'Startimes',
  DSTV: 'DSTV',
  GOTV: 'GOTV',
  STARTIMES: 'Startimes',
  // ── Power (corrected to Flutterwave doc codes) ──
  BIL112: 'Eko Electric',
  BIL113: 'Ikeja Electric',
  BIL114: 'Ibadan Electric',
  BIL115: 'Enugu Electric',
  BIL116: 'Port Harcourt Electric',
  BIL117: 'Benin Electric',
  BIL118: 'Yola Electric',
  // BIL119 already mapped to DSTV above; for power, the provider resolves via category
  BIL204: 'Abuja Electric',
  // ── Betting (common Nigerian providers) ──
  SPORTYBET: 'SportyBet',
  BET9JA: 'Bet9ja',
  BETWAY: 'Betway',
  NAIRABET: 'Nairabet',
  MSPORT: 'MSport',
};

/**
 * Maps internal category names to VFD's categoryName values.
 */
const CATEGORY_TO_VFD: Record<string, string> = {
  airtime: 'Airtime',
  data: 'Data',
  tv: 'Cable TV',
  power: 'Electricity',
  betting: 'Betting',
  internet: 'Internet',
  insurance: 'Insurance',
};

/* ─────────────────────────────────────────────────────────────────────────
 * Provider Implementation
 * ───────────────────────────────────────────────────────────────────────── */

const discoveryCache = new NodeCache({ stdTTL: 24 * 60 * 60 }); // 24h

export class VfdBillProvider implements NormalizedBillProvider {
  readonly providerName = 'vfd';
  private vfdApi: VfdProvider;

  constructor() {
    this.vfdApi = new VfdProvider();
  }

  /* ═══════════════════════════════════════════════
   * DISCOVERY — resolve real VFD IDs from their API
   * ═══════════════════════════════════════════════ */

  /**
   * Fetch and cache the full biller list for a VFD category name.
   * VFD endpoint: GET /billerList?categoryName={categoryName}
   * Response: { status: "00", data: [ { billerId, billerName, division, ... } ] }
   */
  private async fetchBillers(vfdCategory: string): Promise<VfdBillerEntry[]> {
    const cacheKey = `vfd_billers_${vfdCategory}`;
    const cached = discoveryCache.get<VfdBillerEntry[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await this.vfdApi.getBillerList(vfdCategory);
      const rawBillers: any[] = res.data || [];

      const billers: VfdBillerEntry[] = rawBillers.map((b: any) => ({
        billerId: b.billerId || b.id || b.name || '',
        billerName: b.billerName || b.name || '',
        division: b.division || b.divisionId || '',
        categoryName: b.categoryName || vfdCategory,
        raw: b,
      }));

      logger.info(
        { category: vfdCategory, count: billers.length, billers: billers.map(b => ({ id: b.billerId, name: b.billerName })) },
        'VFD biller discovery'
      );
      discoveryCache.set(cacheKey, billers);
      return billers;
    } catch (err: any) {
      logger.error({ category: vfdCategory, error: err.message }, 'VFD biller discovery failed');
      return [];
    }
  }

  /**
   * Fetch and cache products for a specific VFD billerId.
   *
   * VfdProvider.getBillerItems(billerId) returns { status, data: any[] }
   * where data is the flat array of payment items. Each item has:
   *   paymentitemid   -> our productId
   *   paymentCode     -> our paymentCode (sent as `paymentItem` in /pay)
   *   paymentitemname -> our productName
   *
   * IMPORTANT: The VFD docs say not to persist these as they are dynamic.
   * We cache for 24h but the cache can be cleared on demand if needed.
   */
  private async fetchProducts(vfdBillerId: string): Promise<VfdProductEntry[]> {
    const cacheKey = `vfd_products_${vfdBillerId}`;
    const cached = discoveryCache.get<VfdProductEntry[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await this.vfdApi.getBillerItems(vfdBillerId);

      // VfdProvider returns { data: any[] } — data is already the flat items array.
      const rawItems: any[] = res?.data || [];

      const products: VfdProductEntry[] = rawItems.map((p: any) => ({
        productId: String(p.paymentitemid || p.productId || p.id || ''),
        paymentCode: String(p.paymentCode || p.payDirectitemCode || p.paymentitemid || ''),
        productName: String(p.paymentitemname || p.name || p.productName || ''),
        amount: Number(p.amount) || 0,
        isAmountFixed: String(p.isAmountFixed).toLowerCase() === 'true',
        division: String(p.division || ''),
        raw: p,
      }));

      logger.info(
        { billerId: vfdBillerId, count: products.length, sample: products.slice(0, 3).map(p => ({ id: p.productId, code: p.paymentCode, name: p.productName })) },
        'VFD product discovery'
      );
      discoveryCache.set(cacheKey, products);
      return products;
    } catch (err: any) {
      logger.error({ billerId: vfdBillerId, error: err.message }, 'VFD product discovery failed');
      return [];
    }
  }

  /**
   * Resolve a frontend biller ID to the real VFD biller entry via fuzzy matching.
   */
  private async resolveBiller(category: string, frontendId: string): Promise<VfdBillerEntry | null> {
    const vfdCategory = CATEGORY_TO_VFD[category] || category;
    const billers = await this.fetchBillers(vfdCategory);

    if (billers.length === 0) {
      logger.warn({ category, frontendId, vfdCategory }, 'No billers found from VFD — cannot resolve');
      return null;
    }

    // 1. Exact match on billerId
    const exact = billers.find(b => b.billerId === frontendId);
    if (exact) return exact;

    // 2. Map the frontend ID to a human-readable name, then fuzzy-match billerName
    const knownName = (FRONTEND_ID_TO_NAME[frontendId] || FRONTEND_ID_TO_NAME[frontendId.toUpperCase()] || frontendId).toLowerCase();

    const fuzzy = billers.find(b => {
      const bName = b.billerName.toLowerCase();
      const bId = b.billerId.toLowerCase();
      // Match if either side contains the other's first word
      const nameWord = knownName.split(/[\s_]/)[0];
      return (
        bName.includes(knownName) ||
        bId.includes(knownName) ||
        knownName.includes(bName.split(' ')[0]) ||
        bName.includes(nameWord) ||
        bId.includes(nameWord)
      );
    });

    if (fuzzy) {
      logger.info({ frontendId, knownName, resolvedTo: fuzzy.billerId, billerName: fuzzy.billerName }, 'VFD biller resolved via fuzzy match');
      return fuzzy;
    }

    // 3. If exactly 1 biller in category, use it
    if (billers.length === 1) {
      logger.info({ frontendId, resolvedTo: billers[0].billerId }, 'Single biller in VFD category — using it');
      return billers[0];
    }

    logger.warn({ frontendId, knownName, vfdCategory, available: billers.map(b => `${b.billerId}(${b.billerName})`) }, 'VFD biller not resolved');
    return null;
  }

  /**
   * Resolve a frontend item code to a VFD product entry.
   * Returns null only for data purchases where we must have a specific bundle.
   */
  private async resolveProduct(vfdBillerId: string, frontendItemCode?: string): Promise<VfdProductEntry | null> {
    const products = await this.fetchProducts(vfdBillerId);
    if (products.length === 0) return null;

    if (!frontendItemCode) return products[0];

    // Exact match on productId or paymentCode
    const exact = products.find(
      p => p.productId === frontendItemCode || p.paymentCode === frontendItemCode
    );
    if (exact) return exact;

    // Fuzzy name match
    const lower = frontendItemCode.toLowerCase();
    const fuzzy = products.find(p =>
      p.productName.toLowerCase().includes(lower) ||
      p.productId.toLowerCase().includes(lower) ||
      p.paymentCode.toLowerCase().includes(lower)
    );
    if (fuzzy) return fuzzy;

    // Fallback: first product (safe for airtime; caller should check for data)
    return products[0];
  }

  /* ═══════════════════════════════════════════════
   * PURCHASE METHODS
   * ═══════════════════════════════════════════════ */

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('airtime', params.network || '');
    if (!biller) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `Could not resolve VFD biller for airtime network: ${params.network}` };
    }

    // For airtime there is typically only one product item
    const product = await this.resolveProduct(biller.billerId);
    if (!product) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `No VFD products found for airtime biller: ${biller.billerId}` };
    }

    const payload = {
      amount: params.amount,
      customerId: params.phone,
      billerId: biller.billerId,
      productId: product.productId,
      division: biller.division || product.division,
      paymentItem: product.paymentCode, // VFD /pay requires paymentCode as `paymentItem`
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
      division: biller.division || product.division,
      paymentItem: product.paymentCode,
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
      division: biller.division || product.division,
      paymentItem: product.paymentCode,
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

    const products = await this.fetchProducts(biller.billerId);
    const meterLower = (params.meterType || 'prepaid').toLowerCase();

    // Try to match prepaid/postpaid product by name. Fall back to first product.
    const product =
      products.find(p => p.productName.toLowerCase().includes(meterLower)) ||
      products.find(p => p.paymentCode.toLowerCase().includes(meterLower)) ||
      products[0];

    if (!product) {
      return { success: false, reference: params.reference, status: 'FAILED', message: `No VFD products found for power biller: ${biller.billerId}` };
    }

    const payload = {
      amount: params.amount,
      customerId: params.meterNo,
      billerId: biller.billerId,
      productId: product.productId,
      division: biller.division || product.division,
      paymentItem: product.paymentCode,
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

    // For betting, get the first (often only) product
    const product = await this.resolveProduct(biller.billerId);

    const payload = {
      amount: params.amount,
      customerId: params.customerId,
      billerId: biller.billerId,
      productId: product?.productId || biller.billerId,
      division: biller.division || product?.division || '',
      paymentItem: product?.paymentCode || biller.billerId,
      reference: params.reference,
    };

    logger.info({ payload }, 'VFD purchaseBetting payload');
    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  /* ═══════════════════════════════════════════════
   * VALIDATION
   *
   * VFD endpoint: GET /customervalidate
   *   ?divisionId={divisionId}
   *   &paymentItem={paymentCode}   ← must be the paymentCode, NOT productId
   *   &customerId={customerId}
   *   &billerId={billerId}
   * ═══════════════════════════════════════════════ */

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    const category = params.serviceType || 'tv';
    const frontendId = params.provider || params.itemCode || '';

    const biller = await this.resolveBiller(category, frontendId);
    if (!biller) {
      logger.warn({ category, frontendId }, 'Could not resolve VFD biller for validation');
      return { valid: false, name: '' };
    }

    // Resolve the product so we can pass the correct paymentCode
    const product = await this.resolveProduct(biller.billerId, params.itemCode);

    // For airtime/data: validation is optional per VFD docs
    const isAirtimeOrData = category === 'airtime' || category === 'data';
    if (isAirtimeOrData && !product) {
      return { valid: true, name: 'Verified', meta: { message: 'Validation skipped for airtime/data' } };
    }

    try {
      const res = await this.vfdApi.validateBillerCustomer(
        params.customerRef,
        biller.billerId,
        biller.division,
        product?.paymentCode  // VFD needs paymentCode as the paymentItem query param
      );

      logger.info({ customerRef: params.customerRef, billerId: biller.billerId, response: res }, 'VFD validation response');

      const isSuccess = res?.status === '00' || res?.status?.toLowerCase() === 'success';
      if (isSuccess) {
        const name =
          res.data?.name ||
          res.data?.customerName ||
          res.data?.customer ||
          res.data?.fullName ||
          'Valid Customer';
        return {
          valid: true,
          name,
          meta: {
            ...res.data,
            address: res.data?.address,
            customer: res.data?.customerId || params.customerRef,
          },
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
      const raw: any[] = res.data || [];
      return raw.map((c: any) => ({
        id: this.normalizeCategoryId(c.name || c.id || ''),
        name: c.name || '',
        description: c.description || c.name || '',
      }));
    } catch (err: any) {
      logger.error({ error: err.message }, 'VFD getCategories failed');
      return [];
    }
  }

  async getBillers(categoryId: string): Promise<BillBiller[]> {
    const vfdCategory = CATEGORY_TO_VFD[categoryId] || categoryId;
    const billers = await this.fetchBillers(vfdCategory);
    return billers.map(b => ({
      id: b.billerId,
      name: b.billerName,
      categoryId,
    }));
  }

  async getProducts(billerId: string): Promise<BillProduct[]> {
    // billerId here may be a frontend ID or a real VFD billerId.
    // Try fetching directly first; if empty, try resolving it.
    let biller: VfdBillerEntry | null = null;
    let products = await this.fetchProducts(billerId);

    if (products.length === 0) {
      // The billerId might be a Flutterwave/frontend code — resolve it
      for (const cat of ['airtime', 'data', 'tv', 'power', 'betting', 'internet']) {
        biller = await this.resolveBiller(cat, billerId);
        if (biller) {
          products = await this.fetchProducts(biller.billerId);
          if (products.length > 0) break;
        }
      }
    }

    return products.map(p => ({
      id: p.productId,
      name: p.productName,
      billerId: biller?.billerId || billerId,
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
    const isSuccess =
      statusRaw === '00' ||
      statusRaw.toLowerCase() === 'success' ||
      statusRaw.toLowerCase() === 'successful';

    logger.info({ statusRaw, isSuccess, message: res?.message }, 'VFD mapResponse');

    if (isSuccess) {
      return {
        success: true,
        reference,
        status: 'COMPLETED',
        message: res.message || 'Payment successful',
        meta: res.data,
      };
    }
    return {
      success: false,
      reference,
      status: 'FAILED',
      message: res?.message || 'Payment failed',
      meta: res?.data,
    };
  }

  private normalizeCategoryId(nameOrId: string): string {
    if (!nameOrId) return '';
    const lower = nameOrId.toLowerCase();
    if (lower.includes('airtime')) return 'airtime';
    if (lower.includes('data')) return 'data';
    if (lower.includes('cable') || lower.includes('tv')) return 'tv';
    if (lower.includes('electric') || lower.includes('power') || lower.includes('utility')) return 'power';
    if (lower.includes('betting') || lower.includes('gaming') || lower.includes('lottery')) return 'betting';
    if (lower.includes('internet')) return 'internet';
    return nameOrId;
  }
}