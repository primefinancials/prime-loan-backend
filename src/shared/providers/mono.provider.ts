import pino from 'pino';
import axios from 'axios';
import https from 'https';

const logger = pino({ name: 'mono-provider' });

export class MonoProvider {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly httpsAgent: https.Agent;

  constructor() {
    this.baseUrl = process.env.MONO_BASE_URL || 'https://api.withmono.com';
    this.secretKey = process.env.MONO_SECRET_KEY || '';
    this.httpsAgent = new https.Agent({ keepAlive: true });
  }

  private getHeaders() {
    if (!this.secretKey) {
      throw new Error('Mono credentials not configured. Please set MONO_SECRET_KEY in .env.');
    }
    return {
      'Content-Type': 'application/json',
      'mono-sec-key': this.secretKey,
    };
  }

  /**
   * Initiate Mandate
   * Calls Mono DirectPay v2 endpoint to initiate a mandate and returns payment_id.
   */
  async initiateMandate(params: {
    amount: number; // Max amount in Naira
    email: string;
    name: string;
    phone?: string;
    address?: string;
    bvn?: string;
    nin?: string;
    reference: string;
    description: string;
  }): Promise<{ paymentId: string; monoUrl?: string }> {
    try {
      const today = new Date();
      const startDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
      const nextYear = new Date();
      nextYear.setFullYear(today.getFullYear() + 5); // 5 years validity
      const endDate = nextYear.toISOString().split('T')[0];

      let identity;
      if (params.bvn) {
        identity = { type: 'bvn', number: params.bvn };
      } else if (params.nin) {
        identity = { type: 'nin', number: params.nin };
      }

      const payload = {
        amount: params.amount * 100, // Converting Naira to Kobo
        type: 'recurring-debit',
        method: 'mandate',
        mandate_type: 'emandate',
        debit_type: 'variable',
        description: params.description,
        reference: params.reference,
        start_date: startDate,
        end_date: endDate,
        redirect_url: `${process.env.FRONTEND_URL || 'https://prime-loan-web-v2-staging.vercel.app'}/loans/mono-callback`,
        customer: {
          email: params.email,
          name: params.name || 'Prime User',
          phone: params.phone || '08000000000',
          address: params.address || 'Lagos, Nigeria',
          ...(identity ? { identity } : {})
        }
      };

      const response = await axios.post(
        `${this.baseUrl}/v2/payments/initiate`,
        payload,
        { headers: this.getHeaders(), httpsAgent: this.httpsAgent }
      );

      // Extract the ID from the URL or data depending on response structure.
      // Typical response: { data: { mandate_id: "...", mono_url: "..." } }
      const paymentId = response.data?.data?.id || response.data?.id || response.data?.data?.mandate_id || response.data?.data?.payment_id || response.data?.mandate_id || response.data?.payment_id;
      const monoUrl = response.data?.data?.mono_url || response.data?.mono_url;
      return { paymentId, monoUrl };
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Mono initiate mandate failed');
      throw new Error(error.response?.data?.message || 'Failed to initiate Mono mandate');
    }
  }

  /**
   * Get Account Info (Balance)
   * Uses Mono Connect Account ID to fetch balance.
   */
  async getAccountInfo(accountId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v2/accounts/${accountId}`,
        { headers: this.getHeaders(), httpsAgent: this.httpsAgent }
      );
      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, accountId }, 'Mono getAccountInfo failed');
      throw new Error(error.response?.data?.message || 'Failed to fetch Mono account info');
    }
  }

  /**
   * Direct Debit Account
   * Uses Mono v3 Mandates Debit API to charge the user's account
   */
  async chargeAccount(params: {
    accountId: string; // Now acts as the mandate ID
    amount: number;
    reference: string;
    narration: string;
  }): Promise<any> {
    try {
      // Direct debit endpoint: /v3/payments/mandates/{mandate_id}/debit
      const payload = {
        amount: params.amount * 100, // Converting Naira to Kobo
        narration: params.narration,
        reference: params.reference,
      };

      const response = await axios.post(
        `${this.baseUrl}/v3/payments/mandates/${params.accountId}/debit`,
        payload,
        { headers: this.getHeaders(), httpsAgent: this.httpsAgent }
      );

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, reference: params.reference }, 'Mono chargeAccount failed');
      // Throw a more detailed error string so the cron catches and logs the actual reason
      const details = error.response?.data || JSON.stringify(error.response?.data?.errors) || 'Mono account charge failed';
      throw new Error(details);
    }
  }

  /**
   * Get Mandate Status
   * Fetches the current status of a Mono mandate
   */
  async getMandateStatus(mandateId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v3/payments/mandates/${mandateId}`,
        { headers: this.getHeaders(), httpsAgent: this.httpsAgent }
      );
      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, mandateId }, 'Mono getMandateStatus failed');
      throw new Error(error.response?.data?.message || 'Failed to fetch Mono mandate status');
    }
  }
}
