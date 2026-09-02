/**
 * Flutterwave Bill Provider — Normalized wrapper
 * Extracts/wraps existing Flutterwave logic into the NormalizedBillProvider interface.
 *
 * FIX: purchaseAirtime and purchaseData now honour `params.itemCode` when it is
 * supplied by the caller (resolved live from Flutterwave's own catalog by the
 * frontend / bill_payment_service). The hardcoded mapping is kept as a fallback
 * only. This fixes the "Invalid Biller or item selected" error that occurred when
 * the service passed serviceId "BIL100" as `network` but the derived item_code
 * didn't match what Flutterwave's catalog returned for that biller.
 */
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  NormalizedBillProvider,
  BillCategory, BillBiller, BillProduct,
  BillProviderResult, BillValidationResult,
  AirtimePurchaseParams, DataPurchaseParams,
  TVPurchaseParams, PowerPurchaseParams, BettingPurchaseParams, ValidationParams
} from './bill-provider.interface';
import pino from 'pino';

const logger = pino({ name: 'flutterwave-bill-provider' });

function fwHeaders() {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) throw new Error('Missing FLUTTERWAVE_SECRET_KEY');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Outbound proxy is OPTIONAL. On the current infra a Squid proxy gave a stable
// egress IP for Flutterwave's IP allow-list; on the new single-instance EB env
// the instance's own Elastic IP is the stable egress, so no proxy is needed.
// Set FORWARD_PROXY_URL (or PROXY_URL) only if you actually run one.
const PROXY_URL = process.env.FORWARD_PROXY_URL || process.env.PROXY_URL || '';
const proxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

async function fwGet<T = any>(path: string, params?: Record<string, any>) {
  const res = await axios.get<{ status: string; data?: T }>(`https://api.flutterwave.com${path}`, {
    headers: fwHeaders(),
    params,
    ...(proxyAgent ? { httpsAgent: proxyAgent } : {}),
  });
  return res.data;
}

async function fwPost<T = any>(path: string, body: any = {}) {
  const res = await axios.post<{ status: string; data?: T; message?: string }>(`https://api.flutterwave.com${path}`, body, {
    headers: fwHeaders(),
    ...(proxyAgent ? { httpsAgent: proxyAgent } : {}),
  });
  return res.data;
}

export class FlutterwaveBillProvider implements NormalizedBillProvider {
  readonly providerName = 'flutterwave';

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getAirtimeBiller(params.network);

    // FIX: prefer the item code resolved live from the FW catalog (passed via
    // params.itemCode). Fall back to the hardcoded map only when not provided.
    const itemCode = params.itemCode || this.getAirtimeItem(params.network);

    logger.info({ billerCode, itemCode, network: params.network }, 'FW purchaseAirtime resolved codes');

    const resp = await fwPost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(itemCode)}/payment`, {
      country: 'NG',
      customer_id: params.phone,
      amount: params.amount,
      reference: params.reference,
    });

    return this.normalizeResult(resp, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getDataBiller(params.network);

    // FIX: prefer the live-resolved bundle code from the catalog.
    const itemCode = params.bundleCode || params.itemCode || '';

    logger.info({ billerCode, itemCode, network: params.network }, 'FW purchaseData resolved codes');

    const resp = await fwPost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(itemCode)}/payment`, {
      country: 'NG',
      customer_id: params.phone,
      amount: params.amount,
      reference: params.reference,
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getTVBiller(params.provider);
    const resp = await fwPost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(params.bouquetCode)}/payment`, {
      country: 'NG',
      customer_id: params.smartcardNo,
      amount: params.amount,
      reference: params.reference,
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getPowerBiller(params.provider);
    // Flutterwave item_code for electricity: prepaid = 'BIL112' + '_PREPAID', but
    // in practice FW uses the itemCode passed directly from the product catalog.
    // The frontend sends the item code selected from billItems (fetched from FW's own catalog),
    // so pass it through directly via params.meterType mapping.
    const itemCode = params.itemCode || (params.meterType === 'prepaid' ? `${billerCode}_PREPAID` : `${billerCode}_POSTPAID`);
    const resp = await fwPost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(itemCode)}/payment`, {
      country: 'NG',
      customer_id: params.meterNo,
      amount: params.amount,
      reference: params.reference,
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult> {
    return {
      success: false,
      reference: params.reference,
      status: 'FAILED',
      message: 'Betting not supported via Flutterwave at this time'
    };
  }

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    let itemCode = params.itemCode || params.provider || '';
    
    let billerCode = '';
    if (params.serviceType === 'tv') {
      billerCode = this.getTVBiller(params.provider);
      // Fallback for TV validation when specific plan is not yet selected
      if (!params.itemCode || params.itemCode === params.provider) {
        itemCode = this.getTVItem(params.provider || '');
      }
    }
    else if (params.serviceType === 'power') billerCode = this.getPowerBiller(params.provider);
    else if (params.serviceType === 'data') billerCode = this.getDataBiller(params.provider);
    else if (params.serviceType === 'airtime') billerCode = this.getAirtimeBiller(params.provider);

    try {
      const resp = await fwGet(`/v3/bill-items/${encodeURIComponent(itemCode)}/validate`, {
        code: billerCode,
        customer: params.customerRef
      });
      const data = resp.data as any;
      return {
        name: data?.customer_name || data?.name || '',
        valid: !!(data?.customer_name && data.customer_name !== 'INVALID_SMARTCARDNO' && data.customer_name !== 'INVALID_METERNO'),
        meta: data
      };
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ params, error: errorData }, 'FW validateAccount failed');
      return { valid: false, name: '', meta: errorData };
    }
  }

  async getCategories(): Promise<BillCategory[]> {
    try {
      const resp = await fwGet('/v3/top-bill-categories', { country: 'NG' });
      const items = (resp.data as any[]) || [];
      return items.map((c: any) => ({
        id: c.id?.toString() || c.biller_code || c.name,
        name: c.name || c.description || '',
        description: c.description || c.name || ''
      }));
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ error: errorData }, 'FW getCategories failed');
      throw new Error(`FW Categories Request Failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    }
  }

  async getBillers(categoryId: string): Promise<BillBiller[]> {
    try {
      const resp = await fwGet(`/v3/bills/${encodeURIComponent(categoryId)}/billers`, { country: 'NG' });
      const items = (resp.data as any[]) || [];
      return items.map((b: any) => ({
        id: b.biller_code || b.id?.toString() || '',
        name: b.name || b.biller_name || '',
        categoryId,
        logo: b.logo_url || b.logo || undefined
      }));
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ categoryId, error: errorData }, 'FW getBillers failed');
      throw new Error(`FW Billers Request Failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    }
  }

  async getProducts(billerId: string, categoryId?: string): Promise<BillProduct[]> {
    try {
      const resp = await fwGet(`/v3/billers/${encodeURIComponent(billerId)}/items`);
      const items = (resp.data as any[]) || [];
      return items.map((p: any) => ({
        id: p.item_code || p.id?.toString() || '',
        name: p.name || p.biller_name || '',
        billerId,
        amount: Number(p.amount) || 0,
        description: p.description || p.short_name || '',
        duration: this.parseDuration(p.name || p.description || p.short_name || '')
      }));
    } catch (err) {
      const errorData = (err as any).response?.data || (err as any).message;
      logger.error({ billerId, error: errorData }, 'FW getProducts failed');
      throw new Error(`FW Products Request Failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    }
  }

  /**
   * Extract duration from product name/description strings.
   */
  private parseDuration(text: string): string | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();

    const durationMatch = lower.match(/(\d+)\s*(days?|weeks?|months?|hours?|hrs?|d|w|m)(?:\b|$)/i);
    if (durationMatch) {
      const num = durationMatch[1];
      const unit = durationMatch[2].toLowerCase();
      if (unit === 'd' || unit.startsWith('day')) return `${num} day${num === '1' ? '' : 's'}`;
      if (unit === 'w' || unit.startsWith('week')) return `${num} week${num === '1' ? '' : 's'}`;
      if (unit === 'm' || unit.startsWith('month')) return `${num} month${num === '1' ? '' : 's'}`;
      if (unit === 'h' || unit.startsWith('hour') || unit.startsWith('hr')) return `${num} hour${num === '1' ? '' : 's'}`;
    }

    if (lower.includes('daily')) return '1 day';
    if (lower.includes('weekly')) return '7 days';
    if (lower.includes('monthly')) return '30 days';
    if (lower.includes('yearly') || lower.includes('annual')) return '1 year';

    return undefined;
  }

  private getTVItem(provider: string): string {
    const low = provider.toLowerCase();
    if (low.includes('dstv') || low.includes('bil121')) return 'CB177';
    if (low.includes('gotv') || low.includes('bil122')) return 'CB188';
    if (low.includes('startimes') || low.includes('bil123')) return 'CB189';
    return '';
  }

  async getBalance(): Promise<{ balance: number }> {
    // Flutterwave doesn't expose a simple wallet balance — return 0
    return { balance: 0 };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await fwGet('/v3/top-bill-categories', { country: 'NG' });
      return true;
    } catch {
      return false;
    }
  }

  /* ---------- Internal Biller Code Mappings ---------- */

  private getAirtimeBiller(network?: string): string {
    if (!network) return 'BIL099'; // MTN default
    const up = network.toUpperCase();
    // Direct FW airtime biller codes — return as-is
    const directCodes = new Set(['BIL099', 'BIL100', 'BIL102', 'BIL103']);
    if (directCodes.has(up)) return up;
    // Named network → FW airtime biller code
    const map: Record<string, string> = {
      MTN: 'BIL099',
      AIRTEL: 'BIL100',
      GLO: 'BIL102',
      '9MOBILE': 'BIL103',
      ETISALAT: 'BIL103',
      // FW data biller codes → map to airtime equivalents
      BIL108: 'BIL099', // MTN data → MTN airtime
      BIL110: 'BIL100', // Airtel data → Airtel airtime
      BIL109: 'BIL102', // Glo data → Glo airtime
      BIL111: 'BIL103', // 9mobile data → 9mobile airtime
    };
    return map[up] || up;
  }

  private getAirtimeItem(network?: string): string {
    if (!network) return 'AT099';
    const up = network.toUpperCase();
    const map: Record<string, string> = {
      BIL099: 'AT099', MTN: 'AT099',
      BIL100: 'AT100', AIRTEL: 'AT100',
      BIL102: 'AT133', GLO: 'AT133',
      BIL103: 'AT134', '9MOBILE': 'AT134', ETISALAT: 'AT134',
      // data biller codes → correct airtime item codes
      BIL108: 'AT099',
      BIL110: 'AT100',
      BIL109: 'AT133',
      BIL111: 'AT134',
    };
    return map[up] || 'AT099';
  }

  private getDataBiller(network?: string): string {
    if (!network) return 'BIL108'; // MTN data default
    const up = network.toUpperCase();
    // FW data biller codes — return as-is
    const directCodes = new Set(['BIL108', 'BIL109', 'BIL110', 'BIL111']);
    if (directCodes.has(up)) return up;
    // Named network or airtime code → data biller code
    const map: Record<string, string> = {
      MTN: 'BIL108', BIL099: 'BIL108',
      GLO: 'BIL109', BIL102: 'BIL109',
      AIRTEL: 'BIL110', BIL100: 'BIL110',
      '9MOBILE': 'BIL111', ETISALAT: 'BIL111', BIL103: 'BIL111',
    };
    return map[up] || up;
  }

  private getTVBiller(provider?: string): string {
    if (!provider) return 'BIL121';
    const low = provider.toLowerCase();
    const map: Record<string, string> = {
      dstv: 'BIL121', bil121: 'BIL121',
      gotv: 'BIL122', bil122: 'BIL122',
      startimes: 'BIL123', bil123: 'BIL123',
    };
    return map[low] || provider.toUpperCase();
  }

  private getPowerBiller(provider?: string): string {
    return provider || 'BIL112';
  }

  private normalizeResult(resp: any, reference: string): BillProviderResult {
    const status = resp?.status?.toLowerCase?.() || '';
    const isSuccess = status === 'success' || status === 'successful';
    const isPending = status === 'pending';
    return {
      success: isSuccess,
      reference,
      status: isSuccess ? 'success' : isPending ? 'pending' : 'failed',
      message: resp?.message || (isSuccess ? 'Payment successful' : 'Payment failed'),
      meta: resp?.data || resp
    };
  }
}