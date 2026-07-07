import pino from 'pino';
import axios from 'axios';
import crypto from 'crypto';

const logger = pino({ name: 'opay-provider' });

export class OPayProvider {
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly secretKey: string;
  private readonly publicKey: string;

  constructor() {
    // Scaffolded credentials - to be replaced with real env vars once approved by OPay
    this.baseUrl = process.env.OPAY_BASE_URL || 'https://sandboxapi.opaycheckout.com/api/v1/international';
    this.merchantId = process.env.OPAY_MERCHANT_ID || '';
    this.secretKey = process.env.OPAY_SECRET_KEY || '';
    this.publicKey = process.env.OPAY_PUBLIC_KEY || '';
  }

  private getHeaders(data?: any) {
    if (!this.merchantId || !this.secretKey) {
      throw new Error('OPay credentials not configured. Please set OPAY_MERCHANT_ID and OPAY_SECRET_KEY.');
    }

    // OPay usually requires HMAC signature for server-to-server calls
    let signature = '';
    if (data) {
      signature = crypto.createHmac('sha512', this.secretKey).update(JSON.stringify(data)).digest('hex');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.publicKey}`, // OPay sometimes uses Public Key as Bearer, or Signature
      'MerchantId': this.merchantId,
      'Signature': signature,
    };
  }

  /**
   * Initiate Wallet Binding (Tokenization)
   * Sends an OTP to the user's OPay wallet phone number.
   */
  async initiateBinding(phone: string, reference: string): Promise<any> {
    try {
      if (!this.merchantId) {
         // Mock response for testing until real keys are provided
         logger.warn('Mocking OPay initiateBinding because keys are missing');
         return { status: 'success', message: 'Mock OTP sent', reference };
      }

      const payload = {
        phoneNumber: phone,
        reference,
        // ... other OPay specific fields
      };

      const response = await axios.post(`${this.baseUrl}/wallet/bind/initiate`, payload, {
        headers: this.getHeaders(payload),
      });

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'OPay initiateBinding failed');
      throw new Error(error.response?.data?.message || 'OPay wallet binding initiation failed');
    }
  }

  /**
   * Verify Wallet Binding
   * Submits the OTP to verify and obtain the recurring payment token.
   */
  async verifyBinding(phone: string, otp: string, reference: string): Promise<{ token: string; status: string }> {
    try {
      if (!this.merchantId) {
         // Mock response
         logger.warn('Mocking OPay verifyBinding because keys are missing');
         return { token: `mock_opay_token_${Date.now()}`, status: 'successful' };
      }

      const payload = {
        phoneNumber: phone,
        otp,
        reference,
      };

      const response = await axios.post(`${this.baseUrl}/wallet/bind/verify`, payload, {
        headers: this.getHeaders(payload),
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

  /**
   * Charge Wallet (Recurring)
   * Debits a previously tokenized OPay wallet without requiring OTP.
   */
  async chargeWallet(params: { token: string; amount: number; reference: string; phone?: string }): Promise<any> {
    try {
      if (!this.merchantId) {
         logger.warn('Mocking OPay chargeWallet because keys are missing');
         return {
           status: 'successful',
           data: {
             status: 'successful',
             reference: params.reference,
             amount: params.amount,
           },
         };
      }

      const payload = {
        token: params.token,
        amount: String(params.amount * 100), // Assuming kobo/cents depending on OPay spec
        currency: 'NGN',
        reference: params.reference,
        phoneNumber: params.phone,
      };

      const response = await axios.post(`${this.baseUrl}/transaction/recurring`, payload, {
        headers: this.getHeaders(payload),
      });

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, reference: params.reference }, 'OPay chargeWallet failed');
      throw new Error(error.response?.data?.message || 'OPay charge failed');
    }
  }
}
