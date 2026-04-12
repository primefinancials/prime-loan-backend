/**
 * Flutterwave Payout Provider — Bank Transfers for Influencer Withdrawals
 * Wraps Flutterwave's Transfer API
 */
import axios, { AxiosError } from 'axios';
import pino from 'pino';

const logger = pino({ name: 'flutterwave-payout-provider' });

export interface PayoutResult {
  id: number;
  reference: string;
  status: string;
  amount: number;
  narration: string;
  bankName: string;
  accountNumber: string;
  fullName: string;
}

export class FlutterwavePayoutProvider {
  private secretKey: string;
  private baseUrl = 'https://api.flutterwave.com/v3';

  constructor() {
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY || '';
    if (!this.secretKey) {
      logger.warn('FLUTTERWAVE_SECRET_KEY not configured for payouts');
    }
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.secretKey}`,
    };
  }

  /**
   * Initiate a bank transfer payout
   */
  async createTransfer(params: {
    bankCode: string;
    accountNumber: string;
    amount: number;
    reference: string;
    narration?: string;
    beneficiaryName?: string;
  }): Promise<PayoutResult> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/transfers`,
        {
          account_bank: params.bankCode,
          account_number: params.accountNumber,
          amount: params.amount,
          currency: 'NGN',
          reference: params.reference,
          narration: params.narration || 'Prime Finance Influencer Payout',
          beneficiary_name: params.beneficiaryName || undefined,
          callback_url: process.env.FLUTTERWAVE_PAYOUT_CALLBACK_URL || undefined,
        },
        { headers: this.headers() }
      );

      const data = res.data?.data;
      logger.info({ reference: params.reference, transferId: data?.id, status: data?.status }, 'Payout transfer initiated');

      return {
        id: data?.id,
        reference: data?.reference || params.reference,
        status: data?.status,
        amount: data?.amount,
        narration: data?.narration,
        bankName: data?.bank_name,
        accountNumber: data?.account_number,
        fullName: data?.full_name,
      };
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ reference: params.reference, status: axErr.response?.status, data: axErr.response?.data }, 'Payout transfer failed');
      throw new Error(`Payout transfer failed: ${axErr.message}`);
    }
  }

  /**
   * Verify a transfer status
   */
  async getTransferStatus(transferId: number) {
    try {
      const res = await axios.get(
        `${this.baseUrl}/transfers/${transferId}`,
        { headers: this.headers() }
      );
      return res.data?.data;
    } catch (error) {
      const axErr = error as AxiosError;
      logger.error({ transferId, status: axErr.response?.status }, 'Transfer status check failed');
      throw new Error(`Transfer status check failed: ${axErr.message}`);
    }
  }
}
