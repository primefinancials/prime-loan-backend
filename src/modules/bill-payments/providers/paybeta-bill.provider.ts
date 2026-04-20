/**
 * PayBeta Bill Provider — Normalized wrapper
 * Maps PayBeta's flat API structure to the unified NormalizedBillProvider interface.
 */
import {
  NormalizedBillProvider,
  BillCategory, BillBiller, BillProduct,
  BillProviderResult, BillValidationResult,
  AirtimePurchaseParams, DataPurchaseParams,
  TVPurchaseParams, PowerPurchaseParams, BettingPurchaseParams, ValidationParams
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

  /* ---------- Compatibility Layer / Service Resolver ---------- */

  /**
   * Resolves a biller/service name from either a standard name or a Flutterwave ID.
   * Maps to PayBeta's specific slug formats:
   * - Airtime: provider_vtu (underscore)
   * - Data: provider_data (underscore)
   * - TV: provider (slug, like 'dstv')
   * - Power/Gaming: hyphenated slugs (like 'ikeja-electric')
   */
  private detectCategory(id: string): string {
    const uppercased = id.toUpperCase();
    if (['BIL108', 'BIL109', 'BIL110', 'BIL111', 'BIL136'].includes(uppercased)) {
      return 'data';
    }
    if (['BIL121', 'BIL122', 'BIL123', 'BIL126'].includes(uppercased)) {
      return 'tv';
    }
    if (uppercased.startsWith('BIL11') || uppercased.startsWith('BIL12')) {
      // BIL112-BIL120 and BIL124-125 are Power
      return 'power';
    }
    
    // Simple heuristic for raw names/slugs
    const lower = id.toLowerCase();
    if (lower.includes('vtu') || lower.includes('airtime')) return 'airtime';
    if (lower.includes('data')) return 'data';
    if (lower.includes('dstv') || lower.includes('gotv') || lower.includes('startimes') || lower.includes('tv')) return 'tv';
    if (lower.includes('electric') || lower.includes('meter') || lower.includes('diso')) return 'power';
    if (lower.includes('bet') || lower.includes('king') || lower.includes('gaming')) return 'betting';
    
    return 'unknown';
  }

  private async resolveService(id: string, category: string): Promise<string> {
    const fwMap: Record<string, string> = {
      // Airtime/Data
      'BIL108': 'mtn',
      'BIL109': 'glo',
      'BIL110': 'airtel',
      'BIL111': '9mobile',
      'BIL136': 'mtn',
      // TV
      'BIL121': 'dstv',
      'BIL122': 'gotv',
      'BIL123': 'startimes',
      'BIL126': 'showmax',
      // Power
      'BIL112': 'ikeja-electric',
      'BIL113': 'eko-electric',
      'BIL114': 'kano-electric',
      'BIL115': 'port-harcourt-electric',
      'BIL116': 'jos-electric',
      'BIL117': 'ibadan-electric',
      'BIL118': 'kaduna-electric',
      'BIL119': 'enugu-electric',
      'BIL120': 'abuja-electric',
      'BIL124': 'benin-electric',
      'BIL125': 'yola-electric',
    };

    let mapped = fwMap[id.toUpperCase()];
    if (!mapped) {
      // If not in map, try to detect dynamically from the providers list
      try {
        const billers = await this.getBillers(category);
        const found = billers.find(b => b.id === id.toLowerCase() || b.name.toLowerCase().includes(id.toLowerCase()));
        if (found) mapped = found.id;
      } catch (err) {
        logger.warn({ id, category }, 'Dynamic service detection failed');
      }
    }

    if (!mapped) mapped = id.toLowerCase();

    // Final formatting according to PayBeta V2 spec
    if (category === 'airtime') {
      // Must be mtn_vtu, etc.
      return mapped.replace(/-/g, '_').split('_')[0] + '_vtu';
    }
    if (category === 'data') {
      // Must be mtn_data, etc.
      return mapped.replace(/-/g, '_').split('_')[0] + '_data';
    }

    return mapped.replace(/_/g, '-'); // Electricity/Gaming use hyphens
  }

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<BillProviderResult> {
    const service = await this.resolveService(params.network || 'MTN', 'airtime');
    const resp = await this.pb.buyAirtime({
      service,
      phoneNumber: params.phone,
      amount: params.amount,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseData(params: DataPurchaseParams): Promise<BillProviderResult> {
    const service = await this.resolveService(params.network || 'MTN', 'data');
    const resp = await this.pb.buyData({
      service,
      phoneNumber: params.phone,
      amount: params.amount,
      code: params.bundleCode,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseTV(params: TVPurchaseParams): Promise<BillProviderResult> {
    const service = await this.resolveService(params.provider, 'tv');
    
    // First validate to get customer name
    let customerName = 'Customer';
    try {
      const validation = await this.pb.validateTv(service, params.smartcardNo);
      customerName = validation?.data?.customerName || validation?.data?.name || 'Customer';
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'TV validation failed, proceeding with default name');
    }

    const resp = await this.pb.buyTv({
      service,
      smartCardNumber: params.smartcardNo,
      amount: params.amount,
      packageCode: params.bouquetCode,
      customerName,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchasePower(params: PowerPurchaseParams): Promise<BillProviderResult> {
    const service = await this.resolveService(params.provider, 'power');
    
    // Validate meter first
    let customerName = 'Customer';
    let customerAddress = '';
    try {
      const validation = await this.pb.validateMeter(service, params.meterNo, params.meterType);
      customerName = validation?.data?.customerName || validation?.data?.name || 'Customer';
      customerAddress = validation?.data?.customerAddress || validation?.data?.address || '';
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Meter validation failed, proceeding with defaults');
    }

    const resp = await this.pb.buyElectricity({
      service,
      meterNumber: params.meterNo,
      meterType: params.meterType,
      amount: params.amount,
      customerName,
      customerAddress,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async purchaseBetting(params: BettingPurchaseParams): Promise<BillProviderResult> {
    const service = await this.resolveService(params.provider, 'betting');
    
    // Validate gaming account first
    let customerName = 'Customer';
    try {
      const validation = await this.pb.validateGaming(service, params.customerId);
      customerName = validation?.data?.customerName || validation?.data?.name || 'Customer';
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Gaming validation failed, proceeding with default name');
    }

    const resp = await this.pb.buyGaming({
      service,
      customerId: params.customerId,
      amount: params.amount,
      customerName,
      reference: params.reference
    });
    return this.normalizeResult(resp, params.reference);
  }

  async validateAccount(params: ValidationParams): Promise<BillValidationResult> {
    try {
      let result: any;
      switch (params.serviceType) {
        case 'tv':
          const tvServ = await this.resolveService(params.provider || '', 'tv');
          result = await this.pb.validateTv(tvServ, params.customerRef);
          break;
        case 'power':
          const pwrServ = await this.resolveService(params.provider || '', 'power');
          result = await this.pb.validateMeter(pwrServ, params.customerRef, params.itemCode || 'prepaid');
          break;
        case 'betting':
          const betServ = await this.resolveService(params.provider || '', 'betting');
          result = await this.pb.validateGaming(betServ, params.customerRef);
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
      // Internet removed as PayBeta does not offer simple wifi/internet bundles
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
        id: p.slug || p.id || p.name?.toLowerCase?.() || '',
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
      const category = this.detectCategory(billerId);
      
      // Try Data Bundles
      if (category === 'data' || category === 'airtime' || category === 'unknown') {
        const dataService = await this.resolveService(billerId, 'data');
        const dataBundles = await this.pb.getDataBundles(dataService).catch(() => null);
        if (dataBundles?.data) {
          const items = Array.isArray(dataBundles.data) 
            ? dataBundles.data 
            : (dataBundles.data.packages || dataBundles.data.bundles || []);
            
          if (items.length > 0) {
            return items.map((b: any) => ({
              id: b.code || b.id || b.datacode || '',
              name: b.name || b.description || b.plan || '',
              billerId,
              amount: Number(b.amount || b.price || b.fee) || 0,
              description: b.description || b.name || '',
              duration: this.parseDuration(b.name || b.description || '')
            }));
          }
        }
      }

      // Try TV
      if (category === 'tv' || category === 'unknown') {
        const tvService = await this.resolveService(billerId, 'tv');
        
        let tvBouquets: any;
        if (tvService === 'showmax') {
          tvBouquets = await this.pb.getShowmaxBouquets().catch(() => null);
        } else {
          tvBouquets = await this.pb.getTvBouquets(tvService).catch(() => null);
        }

        if (tvBouquets?.data) {
          const items = Array.isArray(tvBouquets.data) 
            ? tvBouquets.data 
            : (tvBouquets.data.packages || tvBouquets.data.bouquets || []);
            
          if (items.length > 0) {
            return items.map((b: any) => ({
              id: b.code || b.packageCode || b.id || '',
              name: b.name || b.description || '',
              billerId,
              amount: Number(b.amount || b.price) || 0,
              description: b.description || b.name || '',
              duration: this.parseDuration(b.name || b.description || '')
            }));
          }
        }
      }

      // Try Power (Electricity) - Return Meter Types as products
      if (category === 'power') {
        return [
          { id: 'prepaid', name: 'Prepaid Meter', billerId, amount: 0, description: 'Pay for prepaid meter' },
          { id: 'postpaid', name: 'Postpaid Meter', billerId, amount: 0, description: 'Pay for postpaid meter' }
        ];
      }

      // Try Betting - Often just requires the provider slug and customer ID
      if (category === 'betting') {
        return [
          { id: 'fund', name: 'Fund Wallet', billerId, amount: 0, description: 'Top up betting account' }
        ];
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

  private normalizeResult(resp: any, reference: string): BillProviderResult {
    // Handle both boolean status and string status
    let rawStatus = resp?.status;
    if (typeof rawStatus === 'boolean') {
      rawStatus = rawStatus ? 'successful' : 'failed';
    }
    const status = (rawStatus || '').toLowerCase();

    // Map PayBeta statuses to internal statuses
    const isSuccess = status === 'successful' || status === 'success';
    const isPending = status === 'pending' || status === 'processing';
    const isFailed = status === 'failed' || status === 'error' || status === 'false' || status === '0';

    let normalizedStatus: 'success' | 'pending' | 'failed' = 'failed';
    if (isSuccess) normalizedStatus = 'success';
    else if (isPending) normalizedStatus = 'pending';

    return {
      success: isSuccess,
      reference: resp?.data?.reference || reference,
      status: normalizedStatus,
      message: resp?.message || resp?.error || '',
      meta: resp?.data || {}
    };
  }
}
