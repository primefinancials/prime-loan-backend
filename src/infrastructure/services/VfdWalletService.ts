import { IWalletService, CreateAccountResponse, TransferFundsRequest, TransferFundsResponse } from '../../core/services/IWalletService';
import { httpClient } from '../../utils/httpClient';
import { convertDate } from '../../utils/convertDate';
import { generateRandomString } from '../../utils/generateRef';
import { sha512 } from 'js-sha512';

export class VfdWalletService implements IWalletService {
  async createAccount(bvn: string, dateOfBirth: string): Promise<CreateAccountResponse> {
    const apiUrl = `/wallet2/client/create?bvn=${bvn}&dateOfBirth=${convertDate(dateOfBirth)}`;
    const response = await httpClient(apiUrl, 'POST', {});
    
    if (response.data && response.data.status === '00') {
      return {
        accountNo: response.data.data.accountNo,
        status: response.data.status,
        message: response.data.message,
      };
    }
    
    throw new Error(response.data.message || 'Failed to create account');
  }

  async transferFunds(request: TransferFundsRequest): Promise<TransferFundsResponse> {
    let fromAccountData: any;
    let toAccountData: any;

    // Get admin account details
    const adminAccount = await httpClient('/wallet2/account/enquiry?', 'GET');
    if (!adminAccount.data) {
      throw new Error('Admin account not found');
    }

    // Get user account details if needed
    if (request.fromAccountType === 'user' && request.fromAccountNumber) {
      const userAccount = await httpClient(`/wallet2/account/enquiry?accountNumber=${request.fromAccountNumber}`, 'GET');
      if (!userAccount.data) {
        throw new Error('User account not found');
      }
      fromAccountData = userAccount.data.data;
      toAccountData = adminAccount.data.data;
    } else {
      fromAccountData = adminAccount.data.data;
      const userAccount = await httpClient(`/wallet2/account/enquiry?accountNumber=${request.toAccountNumber}`, 'GET');
      if (!userAccount.data) {
        throw new Error('User account not found');
      }
      toAccountData = userAccount.data.data;
    }

    const transferBody = {
      fromAccount: fromAccountData.accountNo,
      uniqueSenderAccountId: fromAccountData.accountId,
      fromClientId: fromAccountData.clientId,
      fromClient: fromAccountData.client,
      fromSavingsId: fromAccountData.accountId,
      toClientId: toAccountData.clientId,
      toClient: toAccountData.client,
      toSavingsId: toAccountData.accountId,
      toSession: toAccountData.accountId,
      toAccount: toAccountData.accountNo,
      toBank: '999999',
      signature: sha512.hex(`${fromAccountData.accountNo}${toAccountData.accountNo}`),
      amount: request.amount.toString(),
      remark: request.remark,
      transferType: 'intra',
      reference: request.reference,
    };

    const response = await httpClient('/wallet2/transfer', 'POST', transferBody);

    if (response.data && response.data.status === '00') {
      return {
        status: response.data.status,
        txnId: response.data.data.txnId,
        sessionId: response.data.data.sessionId,
        message: response.data.message,
      };
    }

    throw new Error(response.data.message || 'Transfer failed');
  }

  async getAccountBalance(accountNumber?: string): Promise<number> {
    const response = await httpClient(`/wallet2/account/enquiry${accountNumber ? `?accountNumber=${accountNumber}` : '?'}`, 'GET');
    
    if (response.data && response.data.data) {
      return Number(response.data.data.accountBalance) || 0;
    }
    
    return 0;
  }

  async getAccountDetails(accountNumber?: string): Promise<any> {
    const response = await httpClient(`/wallet2/account/enquiry${accountNumber ? `?accountNumber=${accountNumber}` : '?'}`, 'GET');
    
    if (response.data && response.data.data) {
      return response.data.data;
    }
    
    throw new Error('Account not found');
  }
}