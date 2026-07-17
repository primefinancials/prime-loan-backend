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
   * Exchange Auth Code for Account ID
   * Called after user successfully links account via Mono Connect widget.
   */
  async exchangeToken(authCode: string): Promise<{ id: string }> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/account/auth`,
        { code: authCode },
        { headers: this.getHeaders(), httpsAgent: this.httpsAgent }
      );

      return { id: response.data.id };
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Mono auth token exchange failed');
      throw new Error(error.response?.data?.message || 'Failed to exchange Mono token');
    }
  }

  /**
   * Direct Debit Account
   * Uses Mono DirectPay/Debit API to charge the user's account
   */
  async chargeAccount(params: {
    accountId: string;
    amount: number; // In Kobo usually, but check Mono specs. Assuming standard conversion if needed.
    reference: string;
    narration: string;
  }): Promise<any> {
    try {
      // Direct debit endpoint: /accounts/:id/direct-debit
      const payload = {
        amount: params.amount * 100, // Converting Naira to Kobo
        type: 'direct-debit',
        description: params.narration,
        reference: params.reference,
      };

      const response = await axios.post(
        `${this.baseUrl}/accounts/${params.accountId}/direct-debit`,
        payload,
        { headers: this.getHeaders(), httpsAgent: this.httpsAgent }
      );

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, reference: params.reference }, 'Mono chargeAccount failed');
      throw new Error(error.response?.data?.message || 'Mono account charge failed');
    }
  }
}
