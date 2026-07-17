/**
 * VFD Provider - Banking operations adapter
 * Wraps VFD API calls with retry logic and circuit breaker
 *
 * Changes vs previous version:
 *  1. Added createClientWithNIN() — uses /client/individual?nin=&dateOfBirth= (Tier 1, no consent)
 *  2. Added createClientWithBVNNIN() — uses /client/tiers/individual?bvn=&nin=&address=&dateOfBirth= (Tier 3)
 *  3. Added getAccountTier() — GET /client/tiers?accountNo= to fetch current KYC tier from VFD
 *  4. Added upgradeAccountTier() — POST /client/tiers/upgrade to request tier upgrade
 *  5. Added uploadKYCDocument() — POST to VFD KYC endpoint for document upload
 *  6. Added getKYCStatus() — GET /client/kyc-status?accountNo= to check VFD-side KYC status
 *  7. Corrected Axios URL concatenation (billsBaseUrl has trailing slash, endpoints no leading slash)
 *  8. validateBillerCustomer: 4th param renamed to `paymentItemCode`
 */
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import https from "https";
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
    bvn?: string;
    nin?: string;
    phone?: string;
    dob?: string;
    accountNo: string;
    currentTier?: string;
    ninVerification?: string;
    ninValidation?: string;
    bvnVerification?: string;
    bvnValidation?: string;
    nameMatch?: string;
    address?: string;
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

export interface AccountTierResponse {
  status: string;
  message: string;
  data?: {
    accountNo: string;
    currentTier: string | number;
    tierLimits?: {
      dailyLimit: number;
      maxBalance: number;
    };
  };
}

export interface KYCStatusResponse {
  status: string;
  message: string;
  data?: {
    accountNo: string;
    kycStatus: "verified" | "pending" | "rejected" | "not_started";
    currentTier: string | number;
    documents?: Array<{
      type: string;
      status: string;
      uploadedAt?: string;
    }>;
  };
}

export interface KYCDocumentUploadResponse {
  status: string;
  message: string;
  data?: {
    reference: string;
    documentType: string;
    status: string;
  };
}

export interface TierUpgradeResponse {
  status: string;
  message: string;
  data?: {
    requestId: string;
    currentTier: string | number;
    requestedTier: string | number;
    status: string;
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
    accountName: string;
  };
}

export interface VfdBillPayRequest {
  amount: string | number;
  customerId: string;
  billerId: string;
  division: string;
  productId: string;
  paymentItem: string;
  reference: string;
  phoneNumber?: string;
}

/* ---------- PROVIDER CLASS ---------- */

export class VfdProvider {
  private billsBaseUrl = "https://api-apps.vfdbank.systems/vtech-bills/api/v2/billspaymentstore/";
  private kycBaseUrl = "https://api-apps.vfdbank.systems/vtech-kyc/api/v2/kyc/";
  private httpsAgent = new https.Agent({ keepAlive: true });

  constructor() { }

  private async request<T>(config: AxiosRequestConfig, isRetry = false): Promise<T> {
    const accessToken = await generateBearerToken(customerKey, customerSecret);

    config.headers = {
      ...(config.headers || {}),
      AccessToken: accessToken,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*"
    };
    if (!config.baseURL) {
      config.url = `${baseUrl}${config.url}`;
    }

    if (process.env.FORWARD_PROXY_URL && !config.httpsAgent) {
      const { HttpsProxyAgent } = require("https-proxy-agent");
      config.httpsAgent = new HttpsProxyAgent(process.env.FORWARD_PROXY_URL);
    } else if (!config.httpsAgent) {
      config.httpsAgent = this.httpsAgent;
    }

    try {
      const response = await axios(config);
      return response.data as T;
    } catch (error) {
      const axiosError = error as AxiosError;
      if ((axiosError.response?.status === 401 || axiosError.response?.status === 403) && !isRetry) {
        clearBearerToken();
        const retryConfig = { ...config, url: (config.url || "").replace(baseUrl, "") };
        return this.request<T>(retryConfig, true);
      }
      throw error;
    }
  }

  /* ---------- CLIENT CREATION ---------- */

  /**
   * Create individual account using BVN only (legacy — may be placed on PND)
   * Tier 1 by default
   */
  async createClient(req: { bvn?: string; dob?: string; previousAccountNo?: string }) {
    let url = "/client/create";
    if (req.previousAccountNo) {
      url += `?previousAccountNo=${req.previousAccountNo}`;
    } else {
      url += `?bvn=${req.bvn}&dateOfBirth=${req.dob}`;
    }
    return this.request<CreateClientResponse>({ method: "POST", url, data: {} });
  }

  /**
   * Create individual account using NIN + DOB only.
   * No consent required, no PND. Tier 1 (₦30,000 daily limit).
   * DOB format: DD-MMM-YYYY (e.g. 15-Jan-1990)
   */
  async createClientWithNIN(req: { nin: string; dateOfBirth: string }) {
    const url = `/client/individual?nin=${req.nin}&dateOfBirth=${req.dateOfBirth}`;
    return this.request<CreateClientResponse>({ method: "POST", url, data: {} });
  }

  /**
   * Create individual account using BVN + NIN + address + DOB.
   * No PND restriction. Places account at Tier 3 (₦10M daily limit).
   * DOB format: DD-MMM-YYYY (e.g. 15-Jan-1990)
   */
  async createClientWithBVNNIN(req: {
    bvn: string;
    nin: string;
    address: string;
    dateOfBirth: string;
  }) {
    const params = new URLSearchParams({
      bvn: req.bvn,
      nin: req.nin,
      address: req.address,
      dateOfBirth: req.dateOfBirth,
    });
    const url = `/client/tiers/individual?${params.toString()}`;
    return this.request<CreateClientResponse>({ method: "POST", url, data: {} });
  }

  /* ---------- ACCOUNT ---------- */

  private static accountInfoCache: Map<string, { data: AccountInfoResponse; expires: number }> = new Map();

  async getAccountInfo(accountNumber?: string) {
    const cacheKey = accountNumber || "prime";
    const cached = VfdProvider.accountInfoCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const url = accountNumber
      ? `/account/enquiry?accountNumber=${accountNumber}`
      : "/account/enquiry";

    const response = await this.request<AccountInfoResponse>({ method: "GET", url });

    if (response?.status === "Success" || response?.data) {
      VfdProvider.accountInfoCache.set(cacheKey, { data: response, expires: Date.now() + 10 * 1000 });
    }

    return response;
  }

  async getPrimeAccountInfo() {
    return this.getAccountInfo();
  }

  async clearCache(accountNumber?: string) {
    const cacheKey = accountNumber || "prime";
    VfdProvider.accountInfoCache.delete(cacheKey);
  }

  /* ---------- ACCOUNT TIER ---------- */

  /**
   * Get current KYC tier for an account from VFD
   * GET /client/tiers?accountNo={accountNo}
   */
  async getAccountTier(accountNo: string): Promise<AccountTierResponse> {
    const url = `/client/tiers?accountNo=${accountNo}`;
    return this.request<AccountTierResponse>({ method: "GET", url });
  }

  /**
   * Get full KYC status for an account from VFD
   * GET /client/kyc-status?accountNo={accountNo}
   */
  async getKYCStatus(accountNo: string): Promise<KYCStatusResponse> {
    const url = `/client/kyc-status?accountNo=${accountNo}`;
    return this.request<KYCStatusResponse>({ method: "GET", url });
  }

  /**
   * Upload a KYC document to VFD
   * POST /client/kyc/document
   */
  async uploadKYCDocument(params: {
    accountNo: string;
    documentType: string;
    base64Document: string;
    documentNumber?: string;
  }): Promise<KYCDocumentUploadResponse> {
    return this.request<KYCDocumentUploadResponse>({
      method: "POST",
      url: "/client/kyc/document",
      data: {
        accountNo: params.accountNo,
        documentType: params.documentType,
        documentImage: params.base64Document,
        documentNumber: params.documentNumber,
      },
    });
  }

  /**
   * Request tier upgrade from VFD
   * POST /client/tiers/upgrade
   */
  async upgradeAccountTier(params: {
    accountNo: string;
    targetTier: number;
    documentReferences: string[];
    address?: string;
    phone?: string;
  }): Promise<TierUpgradeResponse> {
    return this.request<TierUpgradeResponse>({
      method: "POST",
      url: "/client/tiers/upgrade",
      data: {
        accountNo: params.accountNo,
        targetTier: params.targetTier,
        documents: params.documentReferences,
        address: params.address,
        phoneNumber: params.phone,
      },
    });
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
    const response = await this.getBeneficiary(accountNo, bankCode, "inter");

    if (response && response.data) {
      const d = response.data as any;
      const resolvedName =
        d.accountName ||
        d.name ||
        d.client ||
        d.account_name ||
        (d.firstname && d.lastname ? `${d.firstname} ${d.lastname}` : null);

      return {
        ...response,
        data: {
          ...response.data,
          accountName: resolvedName,
        },
      };
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
        amount: String(request.amount),
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

  async retriggerWebhook(payload: {
    transactionId?: string;
    sessionId?: string;
    pushIdentifier: "transactionId" | "sessionId";
  }) {
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
    return this.request<{ status: string; message: string; data: any[] }>({
      method: "GET",
      url: "billercategory",
      baseURL: this.billsBaseUrl,
    });
  }

  async getBillerList(categoryName: string) {
    return this.request<{ status: string; message: string; data: any[] }>({
      method: "GET",
      url: `billerlist?categoryName=${categoryName}`,
      baseURL: this.billsBaseUrl,
    });
  }

  async getBillerItems(billerId: string, divisionId: string, productId: string) {
    let url = `billerItems?billerId=${billerId}`;
    if (divisionId) url += `&divisionId=${divisionId}`;
    if (productId) url += `&productId=${productId}`;

    return this.request<{ status: string; message: string; data: any[] }>({
      method: "GET",
      url,
      baseURL: this.billsBaseUrl,
    });
  }

  async validateBillerCustomer(
    customerId: string,
    billerId: string,
    divisionId: string,
    paymentItemCode: string
  ) {
    let url = `customervalidate?customerId=${customerId}&billerId=${billerId}`;
    if (divisionId) url += `&divisionId=${divisionId}`;
    if (paymentItemCode) url += `&paymentItem=${paymentItemCode}`;

    return this.request<{ status: string; message: string; data: any }>({
      method: "GET",
      url,
      baseURL: this.billsBaseUrl,
    });
  }

  async payBill(payload: VfdBillPayRequest) {
    return this.request<{ status: string; message: string; data: any }>({
      method: "POST",
      url: "pay",
      baseURL: this.billsBaseUrl,
      data: payload,
    });
  }

  /* ---------- NIN VERIFICATION (KYC API) ---------- */

  /**
   * Verify NIN via VFD KYC API
   * LIVE: https://api-apps.vfdbank.systems/vtech-kyc/api/v2/kyc/nin?nin=&firstName=&lastName=&dateOfBirth=
   */
  async verifyNIN(params: {
    nin: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }) {
    let url = `nin?nin=${params.nin}`;
    if (params.firstName) url += `&firstName=${params.firstName}`;
    if (params.lastName) url += `&lastName=${params.lastName}`;
    if (params.dateOfBirth) url += `&dateOfBirth=${params.dateOfBirth}`;

    return this.request<{ status: string; message: string; data: any }>({
      method: "GET",
      url,
      baseURL: this.kycBaseUrl,
    });
  }
}