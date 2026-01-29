/**
 * VFD Provider - Banking operations adapter
 * Wraps VFD API calls with retry logic and circuit breaker
 */
import axios, { AxiosRequestConfig } from "axios";
import { CircuitBreaker } from "../utils/circuit";
import { generateBearerToken } from "../utils/generateBearerToken";
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
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000,
      windowDuration: 300000,
    });
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      const accessToken = await generateBearerToken(customerKey, customerSecret);

      config.headers = {
        ...(config.headers || {}),
        AccessToken: accessToken,
        "Content-Type": "application/json",
      };
      config.url = `${baseUrl}${config.url}`;

      const response = await axios(config);

      console.log({ response, accessToken });
      return response.data as T;
    });
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

  async getAccountInfo(accountNumber?: string) {
    const url = accountNumber
      ? `/account/enquiry?accountNumber=${accountNumber}`
      : "/account/enquiry";
    return this.request<AccountInfoResponse>({ method: "GET", url });
  }

  async getPrimeAccountInfo() {
    return this.getAccountInfo();
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
    // Mapping to getBeneficiary for now as VFD structure implies recipient lookup
    // Assuming 'inter' is the default context for name enquiry
    const response = await this.getBeneficiary(accountNo, bankCode, 'inter');

    // Adapt response to expected format if needed
    // The caller expects data.accountName
    if (response && response.data) {
      return {
        ...response,
        data: {
          ...response.data,
          accountName: response.data.name
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
}
