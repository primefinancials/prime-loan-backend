/**
 * Flutterwave Auto-Debit Provider
 * Handles card tokenization and e-mandate (direct debit) operations via Flutterwave
 * Replaces the old MonoProvider
 */
import axios, { AxiosError } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import pino from 'pino';

const logger = pino({ name: 'flutterwave-debit-provider' });

export class FlutterwaveDebitProvider {
  private secretKey: string;
  private baseUrl = 'https://api.flutterwave.com/v3';
  private axiosInstance: import('axios').AxiosInstance;

  constructor() {
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY || '';
    if (!this.secretKey) {
      logger.warn('FLUTTERWAVE_SECRET_KEY not configured');
    }

    this.axiosInstance = axios.create(
      process.env.FORWARD_PROXY_URL 
        ? { httpsAgent: new HttpsProxyAgent(process.env.FORWARD_PROXY_URL) } 
        : {}
    );
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.secretKey}`,
    };
  }

  /* ---------- CARD TOKENIZATION ---------- */

  /**
   * Initiate a card auth charge (₦100) to tokenize the card
   * Frontend should use Flutterwave Inline to handle this;
   * backend receives the transaction reference to verify and extract token
   */
  async verifyTransaction(txRef: string) {
    try {
      const res = await this.axiosInstance.get(
        `${this.baseUrl}/transactions/verify_by_reference?tx_ref=${txRef}`,
        { headers: this.headers() }
      );
      logger.info({ txRef, status: res.data?.data?.status }, 'Flutterwave transaction verified');
      return res.data?.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ txRef, status: axErr.response?.status }, 'FW transaction verification failed');
      throw new Error(`Transaction verification failed: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }

  /**
   * Charge a tokenized card
   */
  async chargeToken(params: {
    token: string;
    email: string;
    amount: number;
    txRef: string;
    currency?: string;
    redirectUrl?: string;
  }) {
    try {
      const res = await this.axiosInstance.post(
        `${this.baseUrl}/tokenized-charges`,
        {
          token: params.token,
          email: params.email,
          amount: params.amount,
          tx_ref: params.txRef,
          currency: params.currency || 'NGN',
          redirect_url: params.redirectUrl,
        },
        { headers: this.headers() }
      );
      logger.info({ txRef: params.txRef, status: res.data?.status }, 'FW tokenized charge initiated');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ txRef: params.txRef, status: axErr.response?.status, data: axErr.response?.data }, 'FW tokenized charge failed');
      throw new Error(`Tokenized charge failed: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }

  private encrypt3DES(text: string): string {
    const crypto = require('crypto');
    const md5 = crypto.createHash('md5').update(this.secretKey).digest('hex');
    const last12 = md5.substring(md5.length - 12).toLowerCase();
    const first12 = this.secretKey.replace('FLWSECK-', '').replace('FLWSECK_TEST-', '').substring(0, 12);
    const encryptionKey = `${first12}${last12}`;
    
    const cipher = crypto.createCipheriv('des-ede3', Buffer.from(encryptionKey), null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  /**
   * Charge a card directly (Server-to-Server)
   */
  async chargeCard(params: {
    cardNumber: string;
    cvv: string;
    expiryMonth: string;
    expiryYear: string;
    email: string;
    amount: number;
    txRef: string;
    fullname?: string;
    currency?: string;
    redirectUrl?: string;
  }) {
    try {
      const payload = {
        card_number: params.cardNumber,
        cvv: params.cvv,
        expiry_month: params.expiryMonth,
        expiry_year: params.expiryYear,
        currency: params.currency || 'NGN',
        amount: params.amount,
        email: params.email,
        fullname: params.fullname || 'Prime User',
        tx_ref: params.txRef,
        redirect_url: params.redirectUrl || 'https://primefinance.live'
      };

      const encrypted = this.encrypt3DES(JSON.stringify(payload));

      const res = await this.axiosInstance.post(
        `${this.baseUrl}/charges?type=card`,
        { client: encrypted },
        { headers: this.headers() }
      );
      logger.info({ txRef: params.txRef, status: res.data?.status }, 'FW card charge initiated');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ txRef: params.txRef, status: axErr.response?.status, data: axErr.response?.data }, 'FW card charge failed');
      throw new Error(`Card charge failed: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }

  /**
   * Validate a charge (OTP/PIN/3DS)
   */
  async validateCharge(flwRef: string, otp: string) {
    try {
      const res = await this.axiosInstance.post(
        `${this.baseUrl}/validate-charge`,
        {
          otp,
          flw_ref: flwRef
        },
        { headers: this.headers() }
      );
      logger.info({ flwRef, status: res.data?.status }, 'FW charge validated');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ flwRef, status: axErr.response?.status, data: axErr.response?.data }, 'FW charge validation failed');
      throw new Error(`Charge validation failed: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }

  /* ---------- E-MANDATE / DIRECT DEBIT ---------- */

  /**
   * Validate a bank account via Flutterwave
   */
  async validateBankAccount(accountNumber: string, bankCode: string) {
    try {
      const res = await this.axiosInstance.post(
        `${this.baseUrl}/accounts/resolve`,
        { account_number: accountNumber, account_bank: bankCode },
        { headers: this.headers() }
      );
      logger.info({ accountNumber: accountNumber.slice(-4), bankCode }, 'Bank account validated');
      return res.data?.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ accountNumber: accountNumber.slice(-4), bankCode, status: axErr.response?.status }, 'Bank validation failed');
      throw new Error(`Bank validation failed: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }

  /**
   * Initiate a direct debit (e-mandate) charge
   * This uses Flutterwave's charge endpoint with type 'debit_ng_account'
   */
  async initiateDirectDebit(params: {
    accountNumber: string;
    bankCode: string;
    email: string;
    amount: number;
    txRef: string;
    narration?: string;
  }) {
    try {
      const res = await this.axiosInstance.post(
        `${this.baseUrl}/charges?type=debit_ng_account`,
        {
          account_bank: params.bankCode,
          account_number: params.accountNumber,
          amount: params.amount,
          email: params.email,
          tx_ref: params.txRef,
          currency: 'NGN',
          narration: params.narration || 'Prime Loan Auto-Debit',
        },
        { headers: this.headers() }
      );
      logger.info({ txRef: params.txRef, status: res.data?.status }, 'FW direct debit initiated');
      return res.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ txRef: params.txRef, status: axErr.response?.status }, 'FW direct debit failed');
      throw new Error(`Direct debit initiation failed: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }

  /**
   * Get list of Nigerian banks from Flutterwave
   */
  async getBanks() {
    try {
      const res = await this.axiosInstance.get(`${this.baseUrl}/banks/NG`, { headers: this.headers() });
      return res.data?.data || [];
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ status: axErr.response?.status }, 'Failed to fetch banks');
      throw new Error(`Failed to fetch banks: ${(axErr.response?.data as any)?.message || axErr.message}`);
    }
  }
}
