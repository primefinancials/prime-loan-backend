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
  TVPurchaseParams, PowerPurchaseParams, ValidationParams
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
      description: p.description || p.short_name || ''
    }));
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
    const map: Record<string, string> = { MTN: 'BIL108', GLO: 'BIL109', AIRTEL: 'BIL110', '9MOBILE': 'BIL111' };
    return map[(network || 'MTN').toUpperCase()] || 'BIL108';
  }

  private getAirtimeItem(network?: string): string {
    const map: Record<string, string> = { MTN: 'AT099', GLO: 'AT100', AIRTEL: 'AT101', '9MOBILE': 'AT102' };
    return map[(network || 'MTN').toUpperCase()] || 'AT099';
  }

  private getDataBiller(network?: string): string {
    return this.getAirtimeBiller(network);
  }

  private getTVBiller(provider?: string): string {
    const map: Record<string, string> = { dstv: 'BIL121', gotv: 'BIL122', startimes: 'BIL123' };
    return map[(provider || 'dstv').toLowerCase()] || 'BIL121';
  }

  private getPowerBiller(provider?: string): string {
    return provider || 'BIL112';
  }

  private normalizeResult(resp: any, reference: string): BillProviderResult {
    const status = resp?.status?.toLowerCase?.() || '';
    return {
      success: status === 'success',
      reference,
      status: status === 'success' ? 'COMPLETED' : status === 'pending' ? 'PENDING' : 'FAILED',
      message: resp?.message || '',
      meta: resp?.data || resp
    };
  }
}
