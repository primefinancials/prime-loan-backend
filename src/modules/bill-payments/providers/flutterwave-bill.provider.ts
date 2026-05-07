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
    // Flutterwave airtime uses biller/item payment — we need a biller code
    // For normalized usage, network maps to known biller codes
    const billerCode = this.getAirtimeBiller(params.network);
    const itemCode = this.getAirtimeItem(params.network);

    const resp = await fwPost(`/v3/billers/${billerCode}/items/${itemCode}/payment`, {
      amount: String(params.amount),
      customer_id: params.phone,
      reference: params.reference,
      currency: 'NGN',
      phone: params.phone,
      country: 'NG'
    });

    return this.normalizeResult(resp, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getDataBiller(params.network);
    const resp = await fwPost(`/v3/billers/${billerCode}/items/${params.bundleCode}/payment`, {
      amount: String(params.amount),
      customer_id: params.phone,
      reference: params.reference,
      currency: 'NGN',
      phone: params.phone,
      type: 'data',
      country: 'NG'
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getTVBiller(params.provider);
    const resp = await fwPost(`/v3/billers/${billerCode}/items/${params.bouquetCode}/payment`, {
      amount: String(params.amount),
      customer_id: params.smartcardNo,
      reference: params.reference,
      currency: 'NGN',
      country: 'NG',
      phone: params.smartcardNo
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const billerCode = this.getPowerBiller(params.provider);
    const resp = await fwPost(`/v3/billers/${billerCode}/items/payment`, {
      amount: String(params.amount),
      customer_id: params.meterNo,
      reference: params.reference,
      currency: 'NGN',
      meter_type: params.meterType === 'prepaid' ? '01' : '02',
      phone: params.meterNo,
      country: 'NG'
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
    if (!network) return 'BIL108';
    const up = network.toUpperCase();
    const map: Record<string, string> = { 
      MTN: 'BIL108', GLO: 'BIL109', AIRTEL: 'BIL110', '9MOBILE': 'BIL111',
      // Map frontend IDs to Flutterwave expected biller codes
      'BIL099': 'BIL108', // MTN
      'BIL100': 'BIL110', // Airtel
      'BIL102': 'BIL109', // Glo
      'BIL103': 'BIL111', // 9mobile
    };
    return map[up] || up;
  }

  private getAirtimeItem(network?: string): string {
    if (!network) return 'AT099';
    const up = network.toUpperCase();
    const map: Record<string, string> = { 
      MTN: 'AT099', GLO: 'AT100', AIRTEL: 'AT101', '9MOBILE': 'AT102',
      // Map frontend IDs to Flutterwave expected item codes
      'BIL099': 'AT099',
      'BIL100': 'AT101',
      'BIL102': 'AT100',
      'BIL103': 'AT102',
    };
    return map[up] || up;
  }

  private getDataBiller(network?: string): string {
    return this.getAirtimeBiller(network);
  }

  private getTVBiller(provider?: string): string {
    if (!provider) return 'BIL121';
    const low = provider.toLowerCase();
    const map: Record<string, string> = { 
      dstv: 'BIL121', gotv: 'BIL122', startimes: 'BIL123',
      bil121: 'BIL121', bil122: 'BIL122', bil123: 'BIL123'
    };
    return map[low] || provider;
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
