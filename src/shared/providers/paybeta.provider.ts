/**
 * PayBeta Provider — Bill Payment API (https://api.paybeta.ng/v2)
 * Docs: https://docs.paybeta.ng/
 * Auth: Single header `P-API-KEY`
 */
import axios, { AxiosError } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
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
    let envUrl = process.env.PAYBETA_API_URL || 'https://api.paybeta.ng';
    if (!envUrl.endsWith('/v2') && !envUrl.endsWith('/v2/')) {
      envUrl = envUrl.replace(/\/$/, '') + '/v2';
    }
    this.baseUrl = envUrl;
    
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
    const url = `${this.baseUrl}${path}`;
    const headers = this.headers();
    try {
      const config = {
        method,
        url,
        headers,
        ...(data ? { data } : {}),
        ...(process.env.FORWARD_PROXY_URL ? { httpsAgent: new HttpsProxyAgent(process.env.FORWARD_PROXY_URL) } : {})
      };
      
      // Log request for debugging (at trace level to avoid log spam)
      logger.debug({ method, url, data }, 'PayBeta request initiated');

      const res = await axios(config);
      
      // PayBeta sometimes returns status false/failed in a 200 OK response
      if (res.data && (res.data.status === 'failed' || res.data.status === 'false' || res.data.status === false)) {
        logger.warn({ url, resp: res.data }, 'PayBeta returned failure in 200 OK');
        throw new Error(res.data.message || res.data.error || 'Paybeta Error');
      }
      return res.data as T;
    } catch (error) {
      const axErr = error as AxiosError;
      const respData = axErr.response?.data as any;
      const statusCode = axErr.response?.status;
      const actualMessage = respData?.message || respData?.error || axErr.message;
      
      logger.error({ 
        path, 
        status: statusCode, 
        requestBody: data,
        responseData: respData 
      }, 'PayBeta request failed');
      
      // Attach status code to error for easier handling in callers
      const err = new Error(actualMessage) as any;
      err.status = statusCode;
      throw err;
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
    // Primary and only endpoint for bundles in V2
    return await this.request<any>('POST', '/data-bundle/list', { service });
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
    return this.request<any>('POST', '/cable/bouquet', { service });
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
