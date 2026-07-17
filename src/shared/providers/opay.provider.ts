import pino from 'pino';
import axios from 'axios';
import crypto from 'crypto';
import https from 'https';

const logger = pino({ name: 'opay-provider' });

export class OPayProvider {
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly secretKey: string;
  private readonly publicKey: string;
  private readonly httpsAgent: https.Agent;

  constructor() {
    this.baseUrl = process.env.OPAY_BASE_URL || 'https://sandboxapi.opaycheckout.com/api/v1/international';
    this.merchantId = process.env.OPAY_MERCHANT_ID || '';
    this.secretKey = process.env.OPAY_SECRET_KEY || '';
    this.publicKey = process.env.OPAY_PUBLIC_KEY || '';
    this.httpsAgent = new https.Agent({ keepAlive: true });
  }

  private getHeaders(data?: any) {
    if (!this.merchantId || !this.secretKey) {
      throw new Error('OPay credentials not configured. Please set OPAY_MERCHANT_ID and OPAY_SECRET_KEY in .env.');
    }

    let signature = '';
    if (data) {
      signature = crypto.createHmac('sha512', this.secretKey).update(JSON.stringify(data)).digest('hex');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.publicKey}`,
      'MerchantId': this.merchantId,
      'Signature': signature,
    };
  }

  async initiateBinding(phone: string, reference: string): Promise<any> {
    try {
      const payload = {
        phoneNumber: phone,
        reference,
      };

      const response = await axios.post(`${this.baseUrl}/wallet/bind/initiate`, payload, {
        headers: this.getHeaders(payload),
        httpsAgent: this.httpsAgent
      });

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'OPay initiateBinding failed');
      throw new Error(error.response?.data?.message || 'OPay wallet binding initiation failed');
    }
  }

  async verifyBinding(phone: string, otp: string, reference: string): Promise<{ token: string; status: string }> {
    try {
      const payload = {
        phoneNumber: phone,
        otp,
        reference,
      };

      const response = await axios.post(`${this.baseUrl}/wallet/bind/verify`, payload, {
        headers: this.getHeaders(payload),
        httpsAgent: this.httpsAgent
      });

      return {
        token: response.data?.data?.token || response.data?.token,
        status: response.data.status,
      };
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'OPay verifyBinding failed');
      throw new Error(error.response?.data?.message || 'OPay wallet binding verification failed');
    }
  }

  async chargeWallet(params: { token: string; amount: number; reference: string; phone?: string }): Promise<any> {
    try {
      const payload = {
        token: params.token,
        amount: String(params.amount * 100), // Assuming kobo/cents depending on OPay spec
        currency: 'NGN',
        reference: params.reference,
        phoneNumber: params.phone,
      };

      const response = await axios.post(`${this.baseUrl}/transaction/recurring`, payload, {
        headers: this.getHeaders(payload),
        httpsAgent: this.httpsAgent
      });

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, reference: params.reference }, 'OPay chargeWallet failed');
      throw new Error(error.response?.data?.message || 'OPay charge failed');
    }
  }
}
