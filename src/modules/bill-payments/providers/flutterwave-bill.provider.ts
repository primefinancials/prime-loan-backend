/**
 * Flutterwave Bill Provider — Normalized wrapper
 * Extracts/wraps existing Flutterwave logic into the NormalizedBillProvider interface.
 */
import axios from 'axios';
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

async function fwGet<T = any>(path: string, params?: Record<string, any>) {
  const res = await axios.get<{ status: string; data?: T }>(`https://api.flutterwave.com${path}`, { headers: fwHeaders(), params });
  return res.data;
}

async function fwPost<T = any>(path: string, body: any = {}) {
  const res = await axios.post<{ status: string; data?: T; message?: string }>(`https://api.flutterwave.com${path}`, body, { headers: fwHeaders() });
  return res.data;
}

export class FlutterwaveBillProvider implements NormalizedBillProvider {
  readonly providerName = 'flutterwave';

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getAirtimeBiller(params.network);
    const itemCode = this.getAirtimeItem(params.network);

    // Flutterwave Bills Payment: POST /v3/bills/payment
    const resp = await fwPost('/v3/bills/payment', {
      country: 'NG',
      customer: params.phone,
      amount: params.amount,
      biller_code: billerCode,
      item_code: itemCode,
      reference: params.reference,
    });

    return this.normalizeResult(resp, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getDataBiller(params.network);
    const resp = await fwPost('/v3/bills/payment', {
      country: 'NG',
      customer: params.phone,
      amount: params.amount,
      biller_code: billerCode,
      item_code: params.bundleCode,
      reference: params.reference,
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getTVBiller(params.provider);
    const resp = await fwPost('/v3/bills/payment', {
      country: 'NG',
      customer: params.smartcardNo,
      amount: params.amount,
      biller_code: billerCode,
      item_code: params.bouquetCode,
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
    const itemCode = params.meterType === 'prepaid' ? `${billerCode}_PREPAID` : `${billerCode}_POSTPAID`;
    const resp = await fwPost('/v3/bills/payment', {
      country: 'NG',
      customer: params.meterNo,
      amount: params.amount,
      biller_code: billerCode,
      item_code: itemCode,
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
    const itemCode = params.itemCode || params.provider || '';
    const resp = await fwGet(`/v3/bill-items/${encodeURIComponent(itemCode)}/validate`, {
      customer: params.customerRef
    });
    const data = resp.data as any;
    return {
      name: data?.customer_name || data?.name || '',
      valid: !!(data?.customer_name && data.customer_name !== 'INVALID_SMARTCARDNO' && data.customer_name !== 'INVALID_METERNO'),
      meta: data
    };
  }

  async getCategories(): Promise<BillCategory[]> {
    const resp = await fwGet('/v3/top-bill-categories', { country: 'NG' });
    const items = (resp.data as any[]) || [];
    return items.map((c: any) => ({
      id: c.id?.toString() || c.biller_code || c.name,
      name: c.name || c.description || '',
      description: c.description || c.name || ''
    }));
  }

  async getBillers(categoryId: string): Promise<BillBiller[]> {
    const resp = await fwGet(`/v3/bills/${encodeURIComponent(categoryId)}/billers`, { country: 'NG' });
    const items = (resp.data as any[]) || [];
    return items.map((b: any) => ({
      id: b.biller_code || b.id?.toString() || '',
      name: b.name || b.biller_name || '',
      categoryId,
      logo: b.logo_url || b.logo || undefined
    }));
  }

  async getProducts(billerId: string): Promise<BillProduct[]> {
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
  }

  /**
   * Extract duration from product name/description strings.
   */
  private parseDuration(text: string): string | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();

    const durationMatch = lower.match(/(\d+)\s*(day|days|week|weeks|month|months|hour|hours|hr|hrs)/i);
    if (durationMatch) {
      const num = durationMatch[1];
      const unit = durationMatch[2].toLowerCase();
      if (unit.startsWith('day')) return `${num} day${num === '1' ? '' : 's'}`;
      if (unit.startsWith('week')) return `${num} week${num === '1' ? '' : 's'}`;
      if (unit.startsWith('month')) return `${num} month${num === '1' ? '' : 's'}`;
      if (unit.startsWith('hour') || unit.startsWith('hr')) return `${num} hour${num === '1' ? '' : 's'}`;
    }

    if (lower.includes('daily')) return '1 day';
    if (lower.includes('weekly')) return '7 days';
    if (lower.includes('monthly')) return '30 days';
    if (lower.includes('yearly') || lower.includes('annual')) return '1 year';

    return undefined;
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
      message: resp?.message || '',
      meta: resp?.data || resp
    };
  }
}