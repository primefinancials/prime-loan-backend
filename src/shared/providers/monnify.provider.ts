import pino from 'pino';
import axios from 'axios';

const logger = pino({ name: 'monnify-provider' });

export class MonnifyProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly contractCode: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.baseUrl = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
    this.apiKey = process.env.MONNIFY_API_KEY || '';
    this.secretKey = process.env.MONNIFY_SECRET_KEY || '';
    this.contractCode = process.env.MONNIFY_CONTRACT_CODE || '';
  }

  private async getAccessToken(): Promise<string> {
    if (!this.apiKey || !this.secretKey) {
      throw new Error('Monnify credentials not configured.');
    }

    // Reuse token if valid (buffer of 60 seconds)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    try {
      const authBuffer = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');
      const response = await axios.post(
        `${this.baseUrl}/api/v1/auth/login`,
        {},
        {
          headers: {
            Authorization: `Basic ${authBuffer}`,
          },
        }
      );

      this.accessToken = response.data.responseBody.accessToken;
      this.tokenExpiresAt = Date.now() + response.data.responseBody.expiresIn * 1000;
      return this.accessToken as string;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Monnify auth failed');
      throw new Error('Failed to authenticate with Monnify');
    }
  }

  private async getHeaders() {
    if (!this.apiKey) {
      throw new Error('Monnify credentials not configured.');
    }
    const token = await this.getAccessToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Create Mandate
   * Initiates a Direct Debit Mandate on a bank account or Moniepoint wallet.
   * Returns an authorization URL that the user must visit to authorize the mandate.
   */
  async createMandate(params: {
    accountNumber: string;
    accountName: string;
    bankCode: string;
    email: string;
    amount: number; // Max debit amount per transaction
  }): Promise<{ mandateCode: string; authUrl: string }> {
    try {
      if (!this.apiKey) {
        logger.warn('Mocking Monnify createMandate because keys are missing');
        const mockMandateCode = `MOCK_MND_${Date.now()}`;
        return {
          mandateCode: mockMandateCode,
          authUrl: `https://sandbox.monnify.com/mandate-auth?mandateCode=${mockMandateCode}`,
        };
      }

      const headers = await this.getHeaders();
      const payload = {
        accountNumber: params.accountNumber,
        accountName: params.accountName,
        bankCode: params.bankCode,
        payerEmail: params.email,
        amount: params.amount,
        contractCode: this.contractCode,
        // Mandate type configuration
        mandateType: 'VARIABLE', // Assuming variable amount up to a max
      };

      const response = await axios.post(`${this.baseUrl}/api/v1/direct-debit/mandate/create`, payload, {
        headers,
      });

      return {
        mandateCode: response.data.responseBody.mandateCode,
        authUrl: response.data.responseBody.authorizationUrl,
      };
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Monnify createMandate failed');
      throw new Error(error.response?.data?.responseMessage || 'Monnify mandate creation failed');
    }
  }

  /**
   * Debit Mandate
   * Deducts funds from an active mandate without OTP.
   */
  async debitMandate(params: {
    mandateCode: string;
    amount: number;
    reference: string;
    narration: string;
  }): Promise<any> {
    try {
      if (!this.apiKey) {
        logger.warn('Mocking Monnify debitMandate because keys are missing');
        return {
          status: 'SUCCESS',
          amount: params.amount,
          transactionReference: params.reference,
        };
      }

      const headers = await this.getHeaders();
      const payload = {
        mandateCode: params.mandateCode,
        amount: params.amount,
        transactionReference: params.reference,
        narration: params.narration,
        contractCode: this.contractCode,
      };

      const response = await axios.post(`${this.baseUrl}/api/v1/direct-debit/mandate/debit`, payload, {
        headers,
      });

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, reference: params.reference }, 'Monnify debitMandate failed');
      throw new Error(error.response?.data?.responseMessage || 'Monnify direct debit failed');
    }
  }

  /**
   * Get Mandate Status
   * Checks if a mandate has been authorized by the user.
   */
  async getMandateStatus(mandateCode: string): Promise<string> {
    try {
      if (!this.apiKey) {
        return 'ACTIVE'; // Mock active status
      }

      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseUrl}/api/v1/direct-debit/mandate/${mandateCode}`, {
        headers,
      });

      return response.data.responseBody.status; // e.g., 'PENDING', 'ACTIVE', 'REVOKED'
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, mandateCode }, 'Monnify getMandateStatus failed');
      throw new Error('Failed to fetch Monnify mandate status');
    }
  }
}
