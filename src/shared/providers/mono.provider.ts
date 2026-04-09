/**
 * Mono Provider — Account Linking & Direct Debit
 * Handles Mono Connect token exchange, account lookup, and DirectPay one-time debits.
 * Docs: https://docs.mono.co/
 */
import axios, { AxiosError } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'mono-provider' });

/* ---------- TYPES ---------- */

export interface MonoAccountDetails {
  id: string;
  institution: {
    name: string;
    bankCode: string;
    type: string;
  };
  name: string;
  accountNumber: string;
  type: string;
  balance: number;
  currency: string;
  bvn: string;
}

export interface MonoPaymentResponse {
  id: string;
  type: string;
  amount: number;
  description: string;
  reference: string;
  status: 'successful' | 'pending' | 'failed';
  created_at: string;
}

export interface MonoMandateResponse {
  id: string;
  mandate_type: string;
  debit_type: string;
  status: 'active' | 'pending' | 'revoked';
  account: string;
  amount: number;
  description: string;
  reference: string;
}

export interface MonoPaymentStatus {
  id: string;
  status: 'successful' | 'pending' | 'failed';
  amount: number;
  reference: string;
  message?: string;
  created_at: string;
}

/* ---------- PROVIDER CLASS ---------- */

export class MonoProvider {
  private secretKey: string;
  private baseUrl = 'https://api.withmono.com';

  constructor() {
    this.secretKey = process.env.MONO_SEC_KEY || '';
    if (!this.secretKey) {
      logger.warn('MONO_SEC_KEY not configured');
    }
  }

  private headers() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'mono-sec-key': this.secretKey
    };
  }

  /**
   * Exchange auth code from Mono Connect widget for an account ID
   */
  async exchangeToken(code: string): Promise<MonoAccountDetails> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/v2/accounts/auth`,
        { code },
        { headers: this.headers() }
      );
      logger.info({ accountId: res.data?.id }, 'Mono token exchanged');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ status: axErr.response?.status, data: axErr.response?.data }, 'Mono token exchange failed');
      throw new Error(`Mono token exchange failed: ${axErr.message}`);
    }
  }

  /**
   * Get account details (balance, institution)
   */
  async getAccountDetails(accountId: string): Promise<MonoAccountDetails> {
    try {
      const res = await axios.get(
        `${this.baseUrl}/v2/accounts/${accountId}`,
        { headers: this.headers() }
      );
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ accountId, status: axErr.response?.status }, 'Mono account details fetch failed');
      throw new Error(`Mono account details failed: ${axErr.message}`);
    }
  }

  /**
   * Initiate a one-time payment (direct debit)
   */
  async initiateOneTimePayment(params: {
    accountId: string;
    amount: number;      // in kobo
    type?: string;
    description: string;
    reference: string;
  }): Promise<MonoPaymentResponse> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/v2/payments/initiate`,
        {
          account: params.accountId,
          amount: params.amount,
          type: params.type || 'onetime-debit',
          description: params.description,
          reference: params.reference
        },
        { headers: this.headers() }
      );
      logger.info({ paymentId: res.data?.id, reference: params.reference }, 'Mono payment initiated');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ reference: params.reference, status: axErr.response?.status, data: axErr.response?.data }, 'Mono payment initiation failed');
      throw new Error(`Mono payment initiation failed: ${axErr.message}`);
    }
  }

  /**
   * Verify payment status
   */
  async verifyPayment(paymentId: string): Promise<MonoPaymentStatus> {
    try {
      const res = await axios.get(
        `${this.baseUrl}/v2/payments/${paymentId}`,
        { headers: this.headers() }
      );
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ paymentId, status: axErr.response?.status }, 'Mono payment verification failed');
      throw new Error(`Mono payment verification failed: ${axErr.message}`);
    }
  }

  /**
   * Setup a mandate for recurring debits
   */
  async setupMandate(params: {
    accountId: string;
    amount: number;
    debitType?: 'variable' | 'fixed';
    description: string;
    reference: string;
  }): Promise<MonoMandateResponse> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/v2/payments/mandates`,
        {
          account: params.accountId,
          amount: params.amount,
          debit_type: params.debitType || 'variable',
          description: params.description,
          reference: params.reference
        },
        { headers: this.headers() }
      );
      logger.info({ mandateId: res.data?.id, reference: params.reference }, 'Mono mandate created');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ reference: params.reference, status: axErr.response?.status }, 'Mono mandate setup failed');
      throw new Error(`Mono mandate setup failed: ${axErr.message}`);
    }
  }

  /**
   * Debit an existing mandate
   */
  async debitMandate(mandateId: string, amount: number, reference: string): Promise<MonoPaymentResponse> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/v2/payments/mandates/${mandateId}/debit`,
        { amount, reference },
        { headers: this.headers() }
      );
      logger.info({ mandateId, reference, amount }, 'Mono mandate debit initiated');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ mandateId, reference, status: axErr.response?.status }, 'Mono mandate debit failed');
      throw new Error(`Mono mandate debit failed: ${axErr.message}`);
    }
  }
}
