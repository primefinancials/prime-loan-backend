/**
 * VFD Provider - Banking operations adapter
 * Wraps VFD API calls with retry logic and circuit breaker
 */
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { generateBearerToken, clearBearerToken } from "../utils/generateBearerToken";
import { customerKey, customerSecret, baseUrl } from "../../config";

/* ---------- TYPES ---------- */

export interface CreateClientResponse {
  status: string;
  message: string;
  data?: {
    firstname: string;
    middlename?: string;
    lastname: string;
    bvn: string;
    phone: string;
    dob: string;
    accountNo: string;
  };
}

export interface AccountInfoResponse {
  status: string;
  message: string;
  data: {
    accountNo: string;
    accountBalance: string;
    accountId: string;
    client: string;
    clientId: string;
    savingsProductName: string;
  };
}

export interface BeneficiaryResponse {
  status: string;
  message: string;
  data?: {
    name: string;
    clientId: string;
    bvn: string;
    account: {
      number: string;
      id: string;
    };
    status: string;
    currency: string;
    bank: string;
  };
}

export interface TransferRequest {
  uniqueSenderAccountId: string;
  fromAccount: string;
  fromClientId: string;
  fromClient: string;
  fromSavingsId: string;
  toClientId?: string;
  toClient?: string;
  toSavingsId?: string;
  toSession?: string;
  toBvn?: string;
  toAccount: string;
  toBank: string;
  signature: string;
  amount: number; // in kobo
  remark: string;
  transferType: "intra" | "inter";
  reference: string;
}

export interface TransferResponse {
  status: string;
  message: string;
  data?: {
    txnId: string;
    sessionId?: string;
    reference?: string;
  };
}

export interface TransactionStatusResponse {
  status: string;
  message: string;
  data?: {
    TxnId: string;
    amount: string;
    accountNo: string;
    fromAccountNo: string;
    transactionStatus: string;
    transactionDate: string;
    toBank: string;
    fromBank: string;
    sessionId: string;
    bankTransactionId: string;
    transactionType: string;
  };
}

export interface ReversalStatusResponse {
  status: string;
  message: string;
  data?: {
    TxnId: string;
    amount: string;
    accountNo: string;
    transactionStatus: string;
    transactionDate: string;
    toBank: string;
    fromBank: string;
    sessionId: string;
    bankTransactionId: string;
  };
}

export interface WebhookRepushResponse {
  status: string;
  message: string;
}

export interface BankListResponse {
  status: string;
  message: string;
  data: Array<{
    name: string;
    code: string;
  }>;
}

export interface CreditSimulationResponse {
  status: string;
  message: string;
}

export interface NameEnquiryResponse {
  status: string;
  message: string;
  data?: {
    name: string;
    clientId: string;
    bvn: string;
    account: {
      number: string;
      id: string;
    };
    status: string;
    currency: string;
    bank: string;
    accountName: string; // Added field
  };
}

/* ---------- PROVIDER CLASS ---------- */

export class VfdProvider {
  constructor() {
    // Circuit breaker removed for faster and more direct VFD requests without premature timeouts
  }

  private async request<T>(config: AxiosRequestConfig, isRetry = false): Promise<T> {
    const accessToken = await generateBearerToken(customerKey, customerSecret);

    config.headers = {
      ...(config.headers || {}),
      AccessToken: accessToken,
      "Content-Type": "application/json",
    };
    config.url = `${baseUrl}${config.url}`;

    try {
      const response = await axios(config);
      console.log("VFD Response", response);
      return response.data as T;
    } catch (error) {
      console.log("VFD Error", error);
      const axiosError = error as AxiosError;
      // If unauthorized, clear the token and retry exactly once
      if ((axiosError.response?.status === 401 || axiosError.response?.status === 403) && !isRetry) {
        clearBearerToken();
        // The URL already has baseUrl prepended from the first attempt, so we strip it or pass a clean config
        // Actually, easier to reconstruct the config to avoid double prepending
        const retryConfig = { ...config, url: config.url.replace(baseUrl, "") };
        return this.request<T>(retryConfig, true);
      }
      throw error;
    }
  }

  /* ---------- CLIENT ---------- */

  async createClient(req: { bvn?: string; dob?: string; previousAccountNo?: string }) {
    let url = "/client/create";
    if (req.previousAccountNo) {
      url += `?previousAccountNo=${req.previousAccountNo}`;
    } else {
      url += `?bvn=${req.bvn}&dateOfBirth=${req.dob}`;
    }
    return this.request<CreateClientResponse>({ method: "POST", url, data: {} });
  }

  /* ---------- ACCOUNT ---------- */

  private static accountInfoCache: Map<string, { data: AccountInfoResponse, expires: number }> = new Map();

  async getAccountInfo(accountNumber?: string) {
    const cacheKey = accountNumber || 'prime';
    const cached = VfdProvider.accountInfoCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const url = accountNumber
      ? `/account/enquiry?accountNumber=${accountNumber}`
      : "/account/enquiry";
    
    const response = await this.request<AccountInfoResponse>({ method: "GET", url });
    
    if (response?.status === "Success" || response?.data) {
      // Cache for 10 seconds (enough for concurrent requests, but fresh for UI)
      VfdProvider.accountInfoCache.set(cacheKey, { data: response, expires: Date.now() + 10 * 1000 });
    }
    
    return response;
  }

  async getPrimeAccountInfo() {
    return this.getAccountInfo();
  }

  /**
   * Explicitly clear cache for an account (useful after transfers)
   */
  async clearCache(accountNumber?: string) {
    const cacheKey = accountNumber || 'prime';
    VfdProvider.accountInfoCache.delete(cacheKey);
  }

  /* ---------- BENEFICIARY ---------- */

  async getBeneficiary(accountNo: string, bank: string, transferType: string) {
    const url = `/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`;
    return this.request<BeneficiaryResponse>({ method: "GET", url });
  }

  /* ---------- BANK ---------- */

  async getBanks() {
    return this.request<BankListResponse>({ method: "GET", url: "/bank" });
  }

  async nameEnquiry(bankCode: string, accountNo: string) {
    const response = await this.getBeneficiary(accountNo, bankCode, 'inter');

    if (response && response.data) {
      const d = response.data as any;
      // Try multiple field names known in VFD/Banking APIs
      const resolvedName = d.accountName || d.name || d.client || d.account_name || 
        (d.firstname && d.lastname ? `${d.firstname} ${d.lastname}` : null);
      
      return {
        ...response,
        data: {
          ...response.data,
          accountName: resolvedName
        }
      }
    }
    return response;
  }

  /* ---------- TRANSFER ---------- */

  async transfer(request: TransferRequest) {
    return this.request<TransferResponse>({
      method: "POST",
      url: "/transfer",
      data: {
        ...request,
        amount: String(request.amount), // convert kobo → naira
      },
    });
  }

  /* ---------- TRANSACTIONS ---------- */

  async queryTransaction(ref?: string, sessionId?: string) {
    let url = "/transactions?";
    if (ref) url += `reference=${ref}`;
    else if (sessionId) url += `sessionId=${sessionId}`;
    else throw new Error("reference or sessionId required");
    return this.request<TransactionStatusResponse>({ method: "GET", url });
  }

  async queryReversal(reference: string) {
    return this.request<ReversalStatusResponse>({
      method: "GET",
      url: `/transactions/reversal?reference=${reference}`,
    });
  }

  async retriggerWebhook(payload: { transactionId?: string; sessionId?: string; pushIdentifier: "transactionId" | "sessionId" }) {
    return this.request<WebhookRepushResponse>({
      method: "POST",
      url: "/transactions/repush",
      data: payload,
    });
  }

  /* ---------- CREDIT (TEST) ---------- */

  async simulateCredit(payload: {
    amount: string;
    accountNo: string;
    senderAccountNo: string;
    senderBank: string;
    senderNarration: string;
  }) {
    return this.request<CreditSimulationResponse>({
      method: "POST",
      url: "/credit",
      data: payload,
    });
  }

  /* ---------- BILL PAYMENTS ---------- */

  async getBillerCategories() {
    return this.request<{ status: string; message: string; data: any[] }>({ method: "GET", url: "/biller/categories" });
  }

  async getBillerItems(categoryId: string) {
    return this.request<{ status: string; message: string; data: any[] }>({ method: "GET", url: `/biller/items?categoryId=${categoryId}` });
  }

  async validateBillerCustomer(customerId: string, billerId?: string) {
    return this.request<{ status: string; message: string; data: any }>({
      method: "POST",
      url: "/biller/customer/validate",
      data: { customerId, billerId }
    });
  }

  async payBill(payload: { amount: string | number; customerId: string; itemId: string; reference: string }) {
    return this.request<{ status: string; message: string; data: any }>({
      method: "POST",
      url: "/biller/pay",
      data: payload
    });
  }
}
