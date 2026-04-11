/**
 * PayBeta Bill Provider — Normalized wrapper
 * Maps PayBeta's flat API structure to the unified NormalizedBillProvider interface.
 */
import {
  NormalizedBillProvider,
  BillCategory, BillBiller, BillProduct,
  BillProviderResult, BillValidationResult,
  AirtimePurchaseParams, DataPurchaseParams,
  TVPurchaseParams, PowerPurchaseParams, ValidationParams
} from './bill-provider.interface';
import { PayBetaProvider, PayBetaResponse } from '../../../shared/providers/paybeta.provider';
import pino from 'pino';

const logger = pino({ name: 'paybeta-bill-provider' });

export class PayBetaBillProvider implements NormalizedBillProvider {
  readonly providerName = 'paybeta';
  private pb: PayBetaProvider;

  constructor() {
    this.pb = new PayBetaProvider();
  }

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const resp = await this.pb.buyAirtime({
      service: (params.network || 'MTN').toLowerCase(),
      phoneNumber: params.phone,
      amount: params.amount,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const resp = await this.pb.buyData({
      service: (params.network || 'MTN').toLowerCase(),
      phoneNumber: params.phone,
      amount: params.amount,
      code: params.bundleCode,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    // First validate to get customer name
    let customerName = 'Customer';
    try {
      const validation = await this.pb.validateTv(params.provider, params.smartcardNo);
      customerName = validation?.data?.customerName || validation?.data?.name || 'Customer';
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'TV validation failed, proceeding with default name');
    }

    const resp = await this.pb.buyTv({
      service: params.provider,
      smartCardNumber: params.smartcardNo,
      amount: params.amount,
      packageCode: params.bouquetCode,
      customerName,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    // Validate meter first
    let customerName = 'Customer';
    let customerAddress = '';
    try {
      const validation = await this.pb.validateMeter(params.provider, params.meterNo, params.meterType);
      customerName = validation?.data?.customerName || validation?.data?.name || 'Customer';
      customerAddress = validation?.data?.customerAddress || validation?.data?.address || '';
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Meter validation failed, proceeding with defaults');
    }

    const resp = await this.pb.buyElectricity({
      service: params.provider,
      meterNumber: params.meterNo,
      meterType: params.meterType,
      amount: params.amount,
      customerName,
      customerAddress,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    try {
      let result: any;
      switch (params.serviceType) {
        case 'tv':
          result = await this.pb.validateTv(params.provider || '', params.customerRef);
          break;
        case 'power':
          result = await this.pb.validateMeter(params.provider || '', params.customerRef, params.itemCode || 'prepaid');
          break;
        case 'betting':
          result = await this.pb.validateGaming(params.provider || '', params.customerRef);
          break;
        default:
          return { name: '', valid: false, meta: { error: 'Unsupported service type for validation' } };
      }

      const name = result?.data?.customerName || result?.data?.name || '';
      return {
        name,
        valid: !!name && name !== 'Error' && result?.status === 'successful',
        meta: result?.data
      };
    } catch (err) {
      return { name: '', valid: false, meta: { error: (err as Error).message } };
    }
  }

  async getCategories(): Promise<BillCategory[]> {
    // PayBeta doesn't have a top-level category endpoint — return hardcoded categories
    return [
      { id: 'airtime', name: 'Airtime', description: 'Purchase airtime for any network' },
      { id: 'data', name: 'Data Bundle', description: 'Purchase data bundles' },
      { id: 'tv', name: 'Cable TV', description: 'TV subscriptions (DSTV, GOtv, Startimes)' },
      { id: 'power', name: 'Electricity', description: 'Prepaid/postpaid electricity tokens' },
      { id: 'betting', name: 'Betting', description: 'Fund betting wallets' },
      { id: 'education', name: 'Education', description: 'Exam cards and education services' }
    ];
  }

  async getBillers(categoryId: string): Promise<BillBiller[]> {
    try {
      let providers: any;
      switch (categoryId) {
        case 'airtime':
          providers = await this.pb.getAirtimeProviders();
          break;
        case 'data':
          providers = await this.pb.getDataProviders();
          break;
        case 'tv':
          providers = await this.pb.getTvProviders();
          break;
        case 'power':
          providers = await this.pb.getElectricityProviders();
          break;
        case 'betting':
          providers = await this.pb.getGamingProviders();
          break;
        case 'education':
          providers = await this.pb.getEducationProviders();
          break;
        default:
          return [];
      }

      const items = providers?.data || [];
      return items.map((p: any) => ({
        id: p.name?.toLowerCase?.() || p.id || '',
        name: p.name || '',
        categoryId,
        logo: p.logo || undefined
      }));
    } catch (err) {
      logger.error({ categoryId, error: (err as Error).message }, 'Failed to fetch billers');
      return [];
    }
  }

  async getProducts(billerId: string): Promise<BillProduct[]> {
    try {
      // For data bundles and TV bouquets, we can fetch products
      const dataBundles = await this.pb.getDataBundles(billerId).catch(() => null);
      if (dataBundles?.data) {
        const items = Array.isArray(dataBundles.data) ? dataBundles.data : [];
        return items.map((b: any) => ({
          id: b.code || b.id || '',
          name: b.name || b.description || '',
          billerId,
          amount: Number(b.amount || b.price) || 0,
          description: b.description || b.name || '',
          duration: this.parseDuration(b.name || b.description || '')
        }));
      }

      const tvBouquets = await this.pb.getTvBouquets(billerId).catch(() => null);
      if (tvBouquets?.data) {
        const items = Array.isArray(tvBouquets.data) ? tvBouquets.data : [];
        return items.map((b: any) => ({
          id: b.code || b.packageCode || b.id || '',
          name: b.name || b.description || '',
          billerId,
          amount: Number(b.amount || b.price) || 0,
          description: b.description || b.name || '',
          duration: this.parseDuration(b.name || b.description || '')
        }));
      }

      return [];
    } catch (err) {
      logger.error({ billerId, error: (err as Error).message }, 'Failed to fetch products');
      return [];
    }
  }

  /**
   * Extract duration from product name/description strings.
   * Common patterns: "1GB - 7 Days", "2GB Monthly", "Weekly Plan", "1 Month", "30days"
   */
  private parseDuration(text: string): string | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();

    // Match explicit patterns like "7 days", "30 days", "1 month", "1 week", etc.
    const durationMatch = lower.match(/(\d+)\s*(day|days|week|weeks|month|months|hour|hours|hr|hrs)/i);
    if (durationMatch) {
      const num = durationMatch[1];
      const unit = durationMatch[2].toLowerCase();
      if (unit.startsWith('day')) return `${num} day${num === '1' ? '' : 's'}`;
      if (unit.startsWith('week')) return `${num} week${num === '1' ? '' : 's'}`;
      if (unit.startsWith('month')) return `${num} month${num === '1' ? '' : 's'}`;
      if (unit.startsWith('hour') || unit.startsWith('hr')) return `${num} hour${num === '1' ? '' : 's'}`;
    }

    // Match keywords
    if (lower.includes('daily')) return '1 day';
    if (lower.includes('weekly')) return '7 days';
    if (lower.includes('monthly')) return '30 days';
    if (lower.includes('yearly') || lower.includes('annual')) return '1 year';

    return undefined;
  }

  async getBalance(): Promise<{ balance: number }> {
    const resp = await this.pb.getWalletBalance();
    return { balance: resp?.data?.availableBalance || 0 };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pb.getWalletBalance();
      return true;
    } catch {
      return false;
    }
  }

  private normalizeResult(resp: PayBetaResponse, reference: string): BillProviderResult {
    const status = resp?.status?.toLowerCase?.() || '';
    return {
      success: status === 'successful',
      reference: resp?.data?.reference || reference,
      status: status === 'successful' ? 'success' : status === 'pending' ? 'pending' : 'failed',
      message: resp?.message || '',
      meta: resp?.data || {}
    };
  }
}
