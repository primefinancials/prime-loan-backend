/**
 * VFD Bill Provider — Normalized wrapper
 *
 * Fixed against VFD WalletAPI documentation:
 * https://vbaas-docs.vfdtech.ng/docs/wallets-api/Products/bills-payment-api/
 *
 * VFD bill payment base URL: https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore
 *
 * Key fixes vs previous version:
 *  1. fetchProducts: now accepts divisionId + productId and passes them as required
 *     query params to VFD's /billerItems endpoint (billerId alone is not enough).
 *     VfdBillerEntry now stores `productId` from the biller list `product` field.
 *  2. fetchBillers: maps VFD's `id`/`name`/`product` fields correctly.
 *     `billerId` ← b.id, `billerName` ← b.name, `productId` ← b.product.
 *  3. getCategories: VFD returns `{ category: "Airtime" }` objects — `c.category`
 *     is now checked FIRST in the name chain (was last, causing empty strings).
 *     Also adds a double-unwrap guard for axios responses where res.data is the
 *     VFD envelope, not the array.
 *  4. resolveProduct / all purchase methods: fetchProducts calls now forward
 *     divisionId + productId so the VFD /billerItems query is complete.
 *  5. All other previous fixes retained (paymentCode routing, fuzzy matching, etc.)
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
  /** VFD `product` field from /billerList — required as `productId` in /billerItems */
  productId: string;
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
  // ── Airtime ──
  BIL099: 'MTN', MTN_VBANK: 'MTN', MTN_NIGERIA: 'MTN',
  BIL100: 'Airtel', AIRTEL_VBANK: 'Airtel', AIRTEL_NIGERIA: 'Airtel',
  BIL102: 'Glo', GLO_VBANK: 'Glo', GLO_NIGERIA: 'Glo',
  BIL103: '9mobile', '9MOBILE_VBANK': '9mobile', ETISALAT_VBANK: '9mobile', '9MOBILE_NIGERIA': '9mobile',

  // ── Data ──
  BIL108: 'MTN',
  BIL110: 'Airtel',
  BIL109: 'Glo',
  BIL111: '9mobile',

  // ── TV ──
  BIL121: 'DSTV', DSTV: 'DSTV', MULTICHOICE: 'DSTV',
  BIL122: 'GOTV', GOTV: 'GOTV',
  BIL123: 'Startimes', STARTIMES: 'Startimes',
  BIL124: 'Showmax', SHOWMAX: 'Showmax',

  // ── Power ──
  BIL112: 'Eko Electric', EKEDC: 'Eko Electric', eko_electric_postpaid: 'Eko Electric', eko_electric_prepaid: 'Eko Electric',
  BIL113: 'Ikeja Electric', IKEDC: 'Ikeja Electric', ikeja_electric_postpaid: 'Ikeja Electric', ikeja_electric_prepaid: 'Ikeja Electric',
  BIL114: 'Ibadan Electric', IBEDC: 'Ibadan Electric', ibadan_electric_postpaid: 'Ibadan Electric', ibadan_electric_prepaid: 'Ibadan Electric',
  BIL115: 'Enugu Electric', EEDC: 'Enugu Electric', enugu_electric_postpaid: 'Enugu Electric', enugu_electric_prepaid: 'Enugu Electric',
  BIL116: 'Port Harcourt Electric', PHEDC: 'Port Harcourt Electric', port_harcourt_electric_postpaid: 'Port Harcourt Electric', port_harcourt_electric_prepaid: 'Port Harcourt Electric',
  BIL117: 'Benin Electric', BEDC: 'Benin Electric', benin_electric_postpaid: 'Benin Electric', benin_electric_prepaid: 'Benin Electric',
  BIL118: 'Yola Electric', YEDC: 'Yola Electric', yola_electric_postpaid: 'Yola Electric', yola_electric_prepaid: 'Yola Electric',
  BIL119: 'Kaduna Electric', KEDC: 'Kaduna Electric', kaduna_electric_postpaid: 'Kaduna Electric', kaduna_electric_prepaid: 'Kaduna Electric',
  BIL120: 'Kano Electric', KEDCO: 'Kano Electric', kano_electric_postpaid: 'Kano Electric', kano_electric_prepaid: 'Kano Electric',
  BIL204: 'Abuja Electric', AEDC: 'Abuja Electric', abuja_electric_postpaid: 'Abuja Electric', abuja_electric_prepaid: 'Abuja Electric',
  BIL127: 'Lekki Concession', LCC: 'Lekki Concession',

  // ── Internet ──
  BIL124_INT: 'Smile', SMILE: 'Smile', // Some overlap with TV BIL124
  BIL125: 'Spectranet', SPECTRANET: 'Spectranet',
  BIL126: 'Swift', SWIFT: 'Swift',
  BIL129: 'ipNX', IPNX: 'ipNX',
  BIL136: 'MTN Hynet', HYNET: 'MTN Hynet',

  // ── Betting ──
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
  // Flutterwave codes -> VFD names
  AIRTIME: 'Airtime',
  MOBILEDATA: 'Data',
  CABLEBILLS: 'Cable TV',
  UTILITYBILLS: 'Utility',
  BETTING: 'Betting',
  INTSERVICE: 'Internet Subscription',
  // Local aliases for backward compatibility
  airtime: 'Airtime',
  data: 'Data',
  tv: 'Cable TV',
  power: 'Utility',
  betting: 'Betting',
  internet: 'Internet Subscription',
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
   *
   * VFD endpoint: GET /billerList?categoryName={categoryName}
   * VFD response shape (from docs):
   *   { status: "00", data: [ { id, name, division, product, category } ] }
   *
   * FIX: VFD uses `id` (not `billerId`), `name` (not `billerName`), and
   * `product` (not `productId`). All three are now mapped correctly.
   * The `product` field is stored as `productId` in VfdBillerEntry because
   * VFD's /billerItems endpoint requires it as a query param.
   */
  private async fetchBillers(vfdCategory: string): Promise<VfdBillerEntry[]> {
    const cacheKey = `vfd_billers_${vfdCategory}`;
    const cached = discoveryCache.get<VfdBillerEntry[]>(cacheKey);
    if (cached) return cached;

    let body: any;
    try {
      const res = await this.vfdApi.getBillerList(vfdCategory);
      body = this.unwrapBody(res);
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ vfdCategory, error: errorData }, 'VFD biller discovery request failed');
      throw new Error(`VFD Biller Request Failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    }

    const isSuccess = body.status === '00' || body.status?.toString() === '0' || body.status?.toLowerCase() === 'success';

    if (!isSuccess) {
      logger.error({ vfdCategory, body }, 'VFD biller discovery failed');
      throw new Error(`VFD Biller Error: ${JSON.stringify(body)}`);
    }

    const rawBillers: any[] = Array.isArray(body.data)
      ? body.data
      : Array.isArray((body.data as any)?.billers)
        ? (body.data as any).billers
        : Array.isArray((body as any)?.paymentbillers)
          ? (body as any).paymentbillers
          : Array.isArray((body as any).billers)
            ? (body as any).billers
            : Array.isArray(body)
              ? body
              : [];

    const billers: VfdBillerEntry[] = rawBillers
      .map((b: any) => ({
        billerId: b.id || b.billerId || b.biller_id || b.code || '',
        billerName: b.name || b.billerName || b.biller_name || b.label || '',
        division: b.division || b.divisionId || b.division_id || '',
        productId: b.product || b.productId || b.product_id || '',
        categoryName: b.category || b.categoryName || vfdCategory,
        raw: b,
      }))
      .filter(b => b.billerId);

    discoveryCache.set(cacheKey, billers);
    return billers;
  }

  private async fetchProducts(vfdBillerId: string, divisionId: string, productId: string): Promise<VfdProductEntry[]> {
    let body: any;
    try {
      const res = await this.vfdApi.getBillerItems(vfdBillerId, divisionId, productId);
      body = this.unwrapBody(res);
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ vfdBillerId, error: errorData }, 'VFD product discovery request failed');
      throw new Error(`VFD Product Request Failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    }

    const isSuccess = body.status === '00' || body.status?.toString() === '0' || body.status?.toLowerCase() === 'success';

    if (!isSuccess) {
      logger.error({ vfdBillerId, body }, 'VFD product discovery failed');
      throw new Error(`VFD Product Error: ${JSON.stringify(body)}`);
    }

    const items = body.data?.paymentitems || body.data || [];
    if (!Array.isArray(items)) return [];

    return items.map((item: any) => ({
      productId: item.paymentitemid || item.id,
      paymentCode: item.paymentCode || item.itemCode || item.id,
      productName: item.paymentitemname || item.name,
      amount: Number(item.amount) || 0,
      isAmountFixed: item.isAmountFixed === true || item.fixedAmount === true,
      division: divisionId,
      raw: item,
    }));
  }

  /**
   * Resolve a frontend biller ID to the real VFD biller entry via fuzzy matching.
   */
  private async resolveBiller(category: string, serviceId: string): Promise<VfdBillerEntry | null> {
    const vfdCategory = CATEGORY_TO_VFD[category] || category;
    let billers = await this.fetchBillers(vfdCategory);

    // 1. Direct match on mapped name
    const mappedName = FRONTEND_ID_TO_NAME[serviceId] || FRONTEND_ID_TO_NAME[serviceId?.toUpperCase()];
    if (mappedName) {
      const match = billers.find(b => this.fuzzyMatch(b.billerName, mappedName));
      if (match) return match;
    }

    // 2. Fuzzy match on serviceId itself
    const serviceMatch = billers.find(b => this.fuzzyMatch(b.billerName, serviceId) || this.fuzzyMatch(b.billerId, serviceId));
    if (serviceMatch) return serviceMatch;

    // 3. Cross-category fallback
    if (vfdCategory !== 'all') {
      const allBillers = await this.fetchBillers('');
      const globalMatch = allBillers.find(b => 
        (mappedName && this.fuzzyMatch(b.billerName, mappedName)) ||
        this.fuzzyMatch(b.billerName, serviceId) ||
        this.fuzzyMatch(b.billerId, serviceId)
      );
      if (globalMatch) return globalMatch;
    }

    return null;
  }

  private fuzzyMatch(name: string, target: string): boolean {
    const b = name.toLowerCase();
    const t = target.toLowerCase();

    if (b.includes(t) || t.includes(b)) return true;

    const aliases: Record<string, string[]> = {
      mtn: ['mtn', 'hynet'],
      airtel: ['airtel'],
      glo: ['globacom', 'glo'],
      '9mobile': ['9mobile', 'etisalat'],
      eko: ['ekedc', 'eko electric'],
      ikeja: ['ikedc', 'ikeja electric'],
      ibadan: ['ibedc', 'ibadan electric'],
      enugu: ['eedc', 'enugu electric'],
      abuja: ['aedc', 'abuja electric'],
      benin: ['bedc', 'benin electric'],
      yola: ['yedc', 'yola electric'],
      kaduna: ['kedc', 'kaduna electric'],
      kano: ['kedco', 'kano electric'],
      'port harcourt': ['phedc', 'port harcourt electric'],
      lekki: ['lcc', 'lekki concession'],
      dstv: ['dstv', 'multichoice'],
      gotv: ['gotv'],
      startimes: ['startimes'],
      showmax: ['showmax'],
      smile: ['smile'],
      spectranet: ['spectranet'],
      swift: ['swift'],
      ipnx: ['ipnx'],
    };

    for (const [key, list] of Object.entries(aliases)) {
      if ((b.includes(key) || list.some(a => b.includes(a))) && 
          (t.includes(key) || list.some(a => t.includes(a)))) {
        return true;
      }
    }
    return false;
  }

  private async resolveProduct(biller: VfdBillerEntry, frontendItemCode?: string): Promise<VfdProductEntry | null> {
    const products = await this.fetchProducts(biller.billerId, biller.division, biller.productId);
    if (products.length === 0) return null;

    if (!frontendItemCode) return products[0];

    const exact = products.find(p => p.productId === frontendItemCode || p.paymentCode === frontendItemCode);
    if (exact) return exact;

    const lower = frontendItemCode.toLowerCase();
    return products.find(p =>
      p.productName.toLowerCase().includes(lower) ||
      p.productId.toLowerCase().includes(lower) ||
      p.paymentCode.toLowerCase().includes(lower)
    ) || products[0];
  }

  /* ═══════════════════════════════════════════════
   * PURCHASE METHODS
   * ═══════════════════════════════════════════════ */

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('airtime', params.network || '');
    if (!biller) return { success: false, reference: params.reference, status: 'FAILED', message: 'Could not resolve biller' };

    const product = await this.resolveProduct(biller);
    if (!product) return { success: false, reference: params.reference, status: 'FAILED', message: 'No products found for this biller' };

    const payload: any = {
      amount: params.amount,
      customerId: params.phone,
      billerId: biller.billerId,
      productId: biller.productId,
      division: biller.division || product.division || '',
      paymentItem: product.paymentCode || '',
      reference: params.reference,
      phoneNumber: params.phone
    };

    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('data', params.network || '');
    if (!biller) return { success: false, reference: params.reference, status: 'FAILED', message: 'Could not resolve biller' };

    const product = await this.resolveProduct(biller, params.bundleCode);
    if (!product) return { success: false, reference: params.reference, status: 'FAILED', message: 'Requested data bundle not found' };

    const payload: any = {
      amount: params.amount,
      customerId: params.phone,
      billerId: biller.billerId,
      productId: biller.productId,
      division: biller.division || product.division || '',
      paymentItem: product.paymentCode || '',
      reference: params.reference,
      phoneNumber: params.phone
    };

    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('tv', params.provider);
    if (!biller) return { success: false, reference: params.reference, status: 'FAILED', message: 'Could not resolve biller' };

    const product = await this.resolveProduct(biller, params.bouquetCode);
    if (!product) return { success: false, reference: params.reference, status: 'FAILED', message: 'Requested TV package not found' };

    const payload: any = {
      amount: params.amount,
      customerId: params.smartcardNo,
      billerId: biller.billerId,
      productId: biller.productId,
      division: biller.division || product.division || '',
      paymentItem: product.paymentCode || '',
      reference: params.reference
    };

    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('power', params.provider);
    if (!biller) return { success: false, reference: params.reference, status: 'FAILED', message: 'Could not resolve biller' };

    const products = await this.fetchProducts(biller.billerId, biller.division, biller.productId);
    const meterLower = (params.meterType || 'prepaid').toLowerCase();
    const product = products.find(p => p.productName.toLowerCase().includes(meterLower)) || products[0];

    if (!product) return { success: false, reference: params.reference, status: 'FAILED', message: 'No products found for this electricity provider' };

    const payload: any = {
      amount: params.amount,
      customerId: params.meterNo,
      billerId: biller.billerId,
      productId: biller.productId,
      division: biller.division || product.division || '',
      paymentItem: product.paymentCode || '',
      reference: params.reference,
      phoneNumber: params.phone
    };

    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  async purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult> {
    const biller = await this.resolveBiller('betting', params.provider);
    if (!biller) return { success: false, reference: params.reference, status: 'FAILED', message: 'Could not resolve biller' };

    const product = await this.resolveProduct(biller);
    const payload: any = {
      amount: params.amount,
      customerId: params.customerId,
      billerId: biller.billerId,
      productId: biller.productId,
      division: biller.division || product?.division || '',
      paymentItem: product?.paymentCode || biller.billerId,
      reference: params.reference
    };

    const res = await this.vfdApi.payBill(payload);
    return this.mapResponse(res, params.reference);
  }

  /* ═══════════════════════════════════════════════
   * VALIDATION
   * ═══════════════════════════════════════════════ */

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    const biller = await this.resolveBiller(params.serviceType || 'tv', params.provider || params.itemCode || '');
    if (!biller) return { valid: false, name: '' };

    const product = await this.resolveProduct(biller, params.itemCode);
    try {
      const res = await this.vfdApi.validateBillerCustomer(
        params.customerRef, 
        biller.billerId, 
        biller.division || '', 
        product?.paymentCode || ''
      );
      const isSuccess = res?.status === '00' || res?.status?.toString() === '0' || res?.status?.toLowerCase() === 'success';
      if (!isSuccess) {
        logger.warn({ params, res }, 'VFD customer validation failed');
      }
      return isSuccess ? { valid: true, name: res.data?.name || res.data?.customerName || 'Valid Customer', meta: res.data } : { valid: false, name: '' };
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ params, error: errorData }, 'VFD customer validation error');
      return { valid: false, name: '', meta: errorData };
    }
  }

  /* ═══════════════════════════════════════════════
   * CATALOG DISCOVERY
   * ═══════════════════════════════════════════════ */

  async getCategories(): Promise<BillCategory[]> {
    let body: any;
    try {
      const res = await this.vfdApi.getBillerCategories();
      body = this.unwrapBody(res);
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ error: errorData }, 'VFD category discovery request failed');
      throw new Error(`VFD Category Request Failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    }

    const isSuccess = body.status === '00' || body.status?.toString() === '0' || body.status?.toLowerCase() === 'success';
    if (!isSuccess) {
      logger.error({ body }, 'VFD category discovery failed');
      throw new Error(`VFD Category Error: ${JSON.stringify(body)}`);
    }

    const raw: any[] = Array.isArray(body.data)
      ? body.data
      : Array.isArray((body.data as any)?.categories)
        ? (body.data as any).categories
        : Array.isArray((body as any)?.categories)
          ? (body as any).categories
          : Array.isArray(body)
            ? body
            : [];

    logger.info({ count: raw.length, sample: raw.slice(0, 3) }, 'VFD raw categories');

    const mapped = raw.map((c: any) => {
      // FIX: check `c.category` FIRST — that is the only key VFD sends
      const rawName = c.category || c.categoryName || c.name || c.id || '';
      const rawId = c.categoryId || c.id || rawName;
      return {
        id: this.normalizeCategoryId(String(rawId)),
        name: rawName,
        description: c.description || rawName,
      };
    }).filter(c => c.id && c.name); // drop blank entries

    return mapped;
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

  async getProducts(billerId: string, categoryId?: string): Promise<BillProduct[]> {
    let biller: VfdBillerEntry | null = null;
    let products: VfdProductEntry[] = [];

    // If categoryId is provided, attempt targeted resolution first
    if (categoryId) {
      biller = await this.resolveBiller(categoryId, billerId);
      if (biller) {
        products = await this.fetchProducts(biller.billerId, biller.division, biller.productId);
      }
    }

    // Fallback to cross-category loop if no products found yet
    if (products.length === 0) {
      for (const cat of ['airtime', 'data', 'tv', 'power', 'betting', 'internet']) {
        if (cat === categoryId) continue; // already tried
        biller = await this.resolveBiller(cat, billerId);
        if (biller) {
          products = await this.fetchProducts(biller.billerId, biller.division, biller.productId);
          if (products.length > 0) break;
        }
      }
    }

    if (products.length === 0) {
      logger.warn({ billerId }, 'No products found for biller — resolution failed to provide division/productId');
    }

    return products.map(p => ({
      id: p.paymentCode, // Frontend expects paymentCode for the /pay endpoint
      name: p.productName,
      billerId: biller?.billerId || billerId,
      amount: p.amount,
      item_code: p.paymentCode,
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
    if (lower.includes('airtime')) return 'AIRTIME';
    if (lower.includes('data')) return 'MOBILEDATA';
    if (lower.includes('cable') || lower.includes('tv')) return 'CABLEBILLS';
    if (lower.includes('electric') || lower.includes('power') || lower.includes('utility')) return 'UTILITYBILLS';
    if (lower.includes('betting') || lower.includes('gaming') || lower.includes('lottery')) return 'BETTING';
    if (lower.includes('internet')) return 'INTSERVICE';
    return nameOrId.toUpperCase();
  }

  private unwrapBody(res: any): any {
    if (!res || res === "") {
      return { status: '99', message: 'VFD returned an empty response', raw: res };
    }

    // If 'res' already has VFD envelope fields, do NOT unwrap 'data'
    if (res.status !== undefined && (res.message !== undefined || res.data !== undefined)) {
      return res;
    }

    // If 'res.data' exists and 'res' lacks VFD fields, it's likely an Axios wrapper
    if (res && res.data && typeof res.data === 'object' && res.status === undefined) {
      return res.data;
    }

    return res;
  }
}