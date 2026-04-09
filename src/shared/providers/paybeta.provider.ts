/**
 * PayBeta Provider — Bill Payment API (https://api.paybeta.ng/v2)
 * Docs: https://docs.paybeta.ng/
 * Auth: Single header `P-API-KEY`
 */
import axios, { AxiosError } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'paybeta-provider' });

/* ---------- TYPES ---------- */

export interface PayBetaResponse {
  status: 'successful' | 'failed' | 'pending';
  message: string;
  code?: string;
  data?: {
    reference: string;
    amount: number;
    chargedAmount: number;
    commission: number;
    biller: string;
    customerId: string;
    token?: string | null;
    unit?: string | null;
    bonusToken?: string | null;
    voucher?: string | null;
    transactionDate: string;
    transactionId: string;
    // Transaction query extras
    paymentStatus?: string;
    amountPaid?: number;
    product?: string;
  };
}

export interface PayBetaProviderItem {
  name: string;
  category: string;
  status: boolean;
  logo: string;
}

export interface PayBetaProvidersResponse {
  status: 'successful' | 'failed';
  message: string;
  data: PayBetaProviderItem[];
}

export interface PayBetaWalletResponse {
  status: 'successful' | 'failed';
  message: string;
  data: {
    availableBalance: number;
    lienAmount: number;
  };
}

/* ---------- PROVIDER CLASS ---------- */

export class PayBetaProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.PAYBETA_API_URL || 'https://api.paybeta.ng/v2';
    this.apiKey = process.env.PAYBETA_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('PAYBETA_API_KEY not configured');
    }
  }

  private headers() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'P-API-KEY': this.apiKey
    };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, data?: any): Promise<T> {
    try {
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: this.headers(),
        ...(data ? { data } : {})
      };
      const res = await axios(config);
      return res.data as T;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ path, status: axErr.response?.status, data: axErr.response?.data }, 'PayBeta request failed');
      throw new Error(`PayBeta ${method} ${path} failed: ${axErr.message}`);
    }
  }

  /* ---------- AIRTIME ---------- */

  async getAirtimeProviders(): Promise<PayBetaProvidersResponse> {
    return this.request<PayBetaProvidersResponse>('GET', '/airtime/providers');
  }

  async buyAirtime(params: {
    service: string;
    phoneNumber: string;
    amount: number;
    reference: string;
  }): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/airtime/purchase', params);
  }

  /* ---------- DATA ---------- */

  async getDataProviders(): Promise<PayBetaProvidersResponse> {
    return this.request<PayBetaProvidersResponse>('GET', '/data-bundle/providers');
  }

  async getDataBundles(service: string): Promise<any> {
    return this.request<any>('POST', '/data-bundle/bundles', { service });
  }

  async buyData(params: {
    service: string;
    phoneNumber: string;
    amount: number;
    code: string;
    reference: string;
  }): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/data-bundle/purchase', params);
  }

  /* ---------- CABLE TV ---------- */

  async getTvProviders(): Promise<PayBetaProvidersResponse> {
    return this.request<PayBetaProvidersResponse>('GET', '/cable/providers');
  }

  async getTvBouquets(service: string): Promise<any> {
    return this.request<any>('POST', '/cable/bouquets', { service });
  }

  async validateTv(service: string, smartCardNumber: string): Promise<any> {
    return this.request<any>('POST', '/cable/validate', { service, smartCardNumber });
  }

  async buyTv(params: {
    service: string;
    smartCardNumber: string;
    amount: number;
    packageCode: string;
    customerName: string;
    reference: string;
  }): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/cable/purchase', params);
  }

  /* ---------- ELECTRICITY ---------- */

  async getElectricityProviders(): Promise<PayBetaProvidersResponse> {
    return this.request<PayBetaProvidersResponse>('GET', '/electricity/providers');
  }

  async validateMeter(service: string, meterNumber: string, meterType: string): Promise<any> {
    return this.request<any>('POST', '/electricity/validate', { service, meterNumber, meterType });
  }

  async buyElectricity(params: {
    service: string;
    meterNumber: string;
    meterType: string;
    amount: number;
    customerName: string;
    customerAddress: string;
    reference: string;
  }): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/electricity/purchase', params);
  }

  /* ---------- SHOWMAX ---------- */

  async getShowmaxBouquets(): Promise<any> {
    return this.request<any>('GET', '/showmax/bouquets');
  }

  async buyShowmax(params: {
    service: string;
    amount: number;
    packageCode: string;
    customerName: string;
    reference: string;
  }): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/showmax/purchase', params);
  }

  /* ---------- GAMING ---------- */

  async getGamingProviders(): Promise<PayBetaProvidersResponse> {
    return this.request<PayBetaProvidersResponse>('GET', '/gaming/providers');
  }

  async validateGaming(service: string, customerId: string): Promise<any> {
    return this.request<any>('POST', '/gaming/validate', { service, customerId });
  }

  async buyGaming(params: {
    service: string;
    customerId: string;
    amount: number;
    customerName: string;
    reference: string;
  }): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/gaming/purchase', params);
  }

  /* ---------- EDUCATION ---------- */

  async getEducationProviders(): Promise<PayBetaProvidersResponse> {
    return this.request<PayBetaProvidersResponse>('GET', '/education/providers');
  }

  async getExamTypes(service: string): Promise<any> {
    return this.request<any>('POST', '/education/exam-types', { service });
  }

  /* ---------- WALLET ---------- */

  async getWalletBalance(): Promise<PayBetaWalletResponse> {
    return this.request<PayBetaWalletResponse>('GET', '/wallet/balance');
  }

  /* ---------- TRANSACTION QUERY ---------- */

  async queryTransaction(reference: string): Promise<PayBetaResponse> {
    return this.request<PayBetaResponse>('POST', '/transaction/query', { reference });
  }
}
