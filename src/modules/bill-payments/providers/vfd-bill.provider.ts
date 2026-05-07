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
    const billerId = this.mapBillerId(params.network || 'airtime');
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.phone,
      billerId,
      productId: billerId,
      division: 'Airtime',
      paymentItem: billerId,
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    // bundleCode should contain the VFD productId (captured during getProducts)
    const billerId = this.mapBillerId(params.network);
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.phone,
      billerId,
      productId: params.bundleCode,
      division: 'Data',
      paymentItem: params.bundleCode,
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const billerId = this.mapBillerId(params.provider);
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.smartcardNo,
      billerId,
      productId: params.bouquetCode,
      division: 'TV',
      paymentItem: params.bouquetCode,
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const billerId = this.mapBillerId(params.provider);
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.meterNo,
      billerId,
      productId: params.meterType === 'prepaid' ? 'prepaid' : 'postpaid',
      division: 'Electricity',
      paymentItem: billerId,
      reference: params.reference
    });
    return this.mapResponse(res, params.reference);
  }

  async purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult> {
    const billerId = this.mapBillerId(params.provider);
    const res = await this.vfdApi.payBill({
      amount: params.amount,
      customerId: params.customerId,
      billerId,
      productId: billerId,
      division: 'Betting',
      paymentItem: billerId,
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
    // VFD uses categoryName for discovery
    const catName = this.mapBillerId(categoryId);
    const res = await this.vfdApi.getBillerList(catName);
    return (res.data || []).map((b: any) => ({
      id: b.id || b.billerId || b.name,
      name: b.name,
      categoryId: categoryId
    }));
  }

  async getProducts(billerId: string): Promise<BillProduct[]> {
    const vfdBillerId = this.mapBillerId(billerId);
    const res = await this.vfdApi.getBillerItems(vfdBillerId);
    return (res.data || []).map((p: any) => ({
      id: p.id || p.productId || p.item_code,
      name: p.name || p.productName,
      billerId: billerId,
      amount: p.amount || 0,
      item_code: p.id || p.productId || p.item_code,
      meta: p // Keep original VFD product for division/productId lookup
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
      'BIL099': 'mtnng',
      'BIL100': 'airng',
      'BIL102': 'glong',
      'BIL103': 'eting',
      'AT099': 'mtnng',
      'AT100': 'airng',
      'AT133': 'glong',
      'AT134': 'eting',
      'MTN': 'mtnng',
      'AIRTEL': 'airng',
      'GLO': 'glong',
      '9MOBILE': 'eting',

      // Data (Flutterwave IDs)
      'BIL108': 'mtnng',
      'BIL110': 'airng',
      'BIL109': 'glong',
      'BIL111': 'eting',
      'MTN_DATA': 'mtnng',
      'AIRTEL_DATA': 'airng',
      'GLO_DATA': 'glong',
      '9MOBILE_DATA': 'eting',

      // TV
      'BIL121': 'dstv',
      'BIL122': 'gotv',
      'BIL123': 'startimes',
      'DSTV': 'dstv',
      'GOTV': 'gotv',
      'STARTIMES': 'startimes',

      // Power
      'BIL112': 'ekedc',
      'BIL113': 'ikedc',
      'EKEDC': 'ekedc',
      'IKEDC': 'ikedc',

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
