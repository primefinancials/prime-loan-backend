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

export class VfdBillProvider implements NormalizedBillProvider {
  readonly providerName = 'vfd';
  private vfdApi: VfdProvider;

  constructor() {
    this.vfdApi = new VfdProvider();
  }

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.phone,
      itemId: this.mapBillerId(params.network || 'airtime'),
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.phone,
      itemId: this.mapBillerId(params.bundleCode),
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.smartcardNo,
      itemId: this.mapBillerId(params.bouquetCode),
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.meterNo,
      itemId: this.mapBillerId(params.provider),
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult> {
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.customerId,
      itemId: this.mapBillerId(params.provider),
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    const providerId = this.mapBillerId(params.provider || params.itemCode || '');
    try {
      const res = await this.vfdApi.validateBillerCustomer(params.customerRef, providerId);
      if (res?.status === 'Success' || res?.status === 'success') {
        return {
          valid: true,
          name: res.data?.name || res.data?.customerName || 'Valid Customer',
          meta: res.data
        };
      }
      return { valid: false, name: '' };
    } catch (e) {
      return { valid: false, name: '' };
    }
  }

  async getCategories(): Promise<BillCategory[]> {
    const res = await this.vfdApi.getBillerCategories();
    return (res.data || []).map((c: any) => ({
      id: this.normalizeCategoryId(c.name || c.id),
      name: c.name,
      description: c.description || ''
    }));
  }

  async getBillers(categoryId: string): Promise<BillBiller[]> {
    const res = await this.vfdApi.getBillerItems(this.mapBillerId(categoryId));
    return (res.data || []).map((b: any) => ({
      id: b.id,
      name: b.name,
      categoryId: categoryId
    }));
  }

  async getProducts(billerId: string): Promise<BillProduct[]> {
    const res = await this.vfdApi.getBillerItems(this.mapBillerId(billerId));
    return (res.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      billerId: p.billerId || billerId,
      amount: p.amount || 0,
      item_code: p.id
    }));
  }

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
    if (res?.status === 'Success' || res?.status === 'success') {
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

  private mapBillerId(id: string): string {
    const mapping: Record<string, string> = {
      // Airtime (Flutterwave IDs)
      'BIL099': 'MTN',
      'BIL100': 'AIRTEL',
      'BIL102': 'GLO',
      'BIL103': '9MOBILE',
      'AT099': 'MTN',
      'AT100': 'AIRTEL',
      'AT133': 'GLO',
      'AT134': '9MOBILE',

      // Data (Flutterwave IDs)
      'BIL108': 'MTN_DATA',
      'BIL110': 'AIRTEL_DATA',
      'BIL109': 'GLO_DATA',
      'BIL111': '9MOBILE_DATA',

      // TV
      'BIL121': 'DSTV',
      'BIL122': 'GOTV',
      'BIL123': 'STARTIMES',

      // Power
      'BIL112': 'EKEDC',
      'BIL113': 'IKEDC',

      // Category aliases (for dynamic fetching)
      'airtime': 'Airtime',
      'data': 'Data',
      'tv': 'Cable TV',
      'power': 'Electricity',
      'betting': 'Betting',
      'internet': 'Internet'
    };
    return mapping[id] || id;
  }

  private normalizeCategoryId(nameOrId: string): string {
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
