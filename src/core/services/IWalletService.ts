export interface CreateAccountRequest {
  bvn: string;
  dateOfBirth: string;
}

export interface CreateAccountResponse {
  accountNo: string;
  status: string;
  message: string;
}

export interface TransferFundsRequest {
  fromAccountType: 'admin' | 'user';
  fromAccountNumber?: string;
  toAccountNumber: string;
  amount: number;
  reference: string;
  remark: string;
}

export interface TransferFundsResponse {
  status: string;
  txnId: string;
  sessionId: string;
  message: string;
}

export interface IWalletService {
  createAccount(bvn: string, dateOfBirth: string): Promise<CreateAccountResponse>;
  transferFunds(request: TransferFundsRequest): Promise<TransferFundsResponse>;
  getAccountBalance(accountNumber?: string): Promise<number>;
  getAccountDetails(accountNumber?: string): Promise<any>;
}