import { CreditScore } from '../entities/Loan';

export interface CreditCheckResponse {
  creditScore?: CreditScore;
  error?: {
    message: string;
  };
}

export interface ICreditCheckService {
  performCreditCheck(bvn: string): Promise<CreditCheckResponse>;
}