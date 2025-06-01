import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Interfaces for TypeScript type safety
interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  merchant_code?: string;
  production_payment_code?: string;
  requestor_id?: string;
  payable_id?: string;
  jti?: string;
}

export class OAuthClient {
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private axiosInstance: AxiosInstance;

  constructor(
    private readonly clientId: string,
    private readonly secretKey: string,
    private readonly tokenUrl: string,
    private readonly baseUrl: string
  ) {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
    });
  }

  private async fetchAccessToken(): Promise<void> {
    const credentials = Buffer.from(`${this.clientId}:${this.secretKey}`).toString('base64');
    const response = await axios.post<OAuthTokenResponse>(
      this.tokenUrl,
      new URLSearchParams({ grant_type: 'client_credentials' }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    this.accessToken = response.data.access_token;
    this.expiresAt = Date.now() + response.data.expires_in * 1000;
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.accessToken || !this.expiresAt || Date.now() >= this.expiresAt) {
      await this.fetchAccessToken();
    }
  }

  public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    await this.ensureValidToken();
    
    const response = await this.axiosInstance.request<T>({
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    return response.data;
  }
}


export class InterswitchAuthClient {
  private axiosInstance: AxiosInstance;

  constructor(
    private readonly clientId: string,
    private readonly secretKey: string,
    private readonly baseUrl: string
  ) {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
    });
  }

  private generateNonce(): string {
    return uuidv4();
  }

  private generateTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  private computeSignature(method: string, endpoint: string, timestamp: string, nonce: string): string {
    const signatureBase = `${method}&${encodeURIComponent(endpoint)}&${timestamp}&${nonce}&${this.clientId}&${this.secretKey}`;
    const hash = crypto.createHash('sha1').update(signatureBase).digest();
    return hash.toString('base64');
  }

  public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    const nonce = this.generateNonce();
    const timestamp = this.generateTimestamp();
    const method = config.method?.toUpperCase() || 'GET';
    const endpoint = config.url || '/';

    const signature = this.computeSignature(method, endpoint, timestamp, nonce);

    const headers = {
      ...config.headers,
      Authorization: `InterswitchAuth ${Buffer.from(this.clientId).toString('base64')}`,
      Nonce: nonce,
      Timestamp: timestamp,
      SignatureMethod: 'SHA1',
      Signature: signature,
      'Content-Type': 'application/json',
    };

    const response = await this.axiosInstance.request<T>({
      ...config,
      headers,
      method,
    });

    return response.data;
  }
}