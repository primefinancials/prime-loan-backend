import axios, { AxiosRequestConfig } from 'axios';
import { ICreditCheckService, CreditCheckResponse } from '../../core/services/ICreditCheckService';
import { CreditScore, Creditor, LoanDetail } from '../../core/entities/Loan';

export class MonoCreditCheckService implements ICreditCheckService {
  private readonly apiUrl = 'https://api.withmono.com/v3/lookup/credit-history/all';
  private readonly secretKey = 'live_sk_axio44pdonk6lb6rdhxa';

  async performCreditCheck(bvn: string): Promise<CreditCheckResponse> {
    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'mono-sec-key': this.secretKey,
    };

    const options: AxiosRequestConfig = {
      url: this.apiUrl,
      method: 'POST',
      headers,
      data: { bvn },
    };

    try {
      const response = await axios(options);

      if (![200, 202].includes(response.status)) {
        throw new Error(`Credit check failed: ${response.data.message}`);
      }

      return {
        creditScore: this.convertToCreditScore(response.data.data),
      };
    } catch (error: any) {
      if (
        error.response?.data?.message === "Insufficient funds, minimum wallet balance of ₦538 is required" ||
        error.message === "Insufficient funds, minimum wallet balance of ₦538 is required"
      ) {
        return {
          error: {
            message: "Unable to create loan cause credit check can't be performed at this time",
          },
        };
      } else {
        return {
          error: {
            message: error.response?.data?.message || error.message || 'Credit check failed',
          },
        };
      }
    }
  }

  private convertToCreditScore(rawData: any): CreditScore | undefined {
    if (rawData.error) return undefined;

    const profile = rawData?.profile || {};
    const creditHistories = rawData?.credit_history || [];

    const loanDetails: LoanDetail[] = creditHistories.flatMap((ch: any) => {
      return ch.history.map((h: any) => {
        const repaymentAmount = isNaN(Number(h.repayment_amount)) ? 0 : Number(h.repayment_amount);

        return {
          loanProvider: ch.institution || 'Unknown',
          accountNumber: 'N/A',
          loanAmount: repaymentAmount,
          outstandingBalance: 0,
          status: h.loan_status || '',
          performanceStatus: h.performance_status || '',
          overdueAmount: 0,
          type: 'N/A',
          loanDuration: `${h.tenor || 0} months`,
          repaymentFrequency: h.repayment_frequency || '',
          repaymentBehavior: h.repayment_schedule?.[0]?.status || '',
          paymentProfile: h.repayment_schedule?.[0]?.status || '',
          dateAccountOpened: this.formatDate(h.date_opened),
          lastUpdatedAt: this.formatDate(h.closed_date),
          loanCount: ch.history.length,
          monthlyInstallmentAmount: repaymentAmount,
        };
      });
    });

    const creditors: Creditor[] = creditHistories.map((ch: any) => ({
      subscriberId: ch.institution,
      name: ch.institution,
      phone: '',
      address: '',
    }));

    const totalDebt = loanDetails.reduce((sum, loan) => sum + loan.loanAmount, 0);

    return {
      loanId: 'N/A',
      lastReported: rawData.timestamp || new Date().toISOString(),
      creditorName: creditHistories[0]?.institution || 'Unknown',
      totalDebt: totalDebt.toString(),
      accountType: 'N/A',
      outstandingBalance: 0,
      activeLoan: loanDetails.filter(loan => loan.status === 'open').length,
      loansTaken: loanDetails.length,
      income: 0,
      repaymentHistory: loanDetails[0]?.repaymentBehavior || '',
      openedDate: loanDetails[0]?.dateAccountOpened || '',
      lengthOfCreditHistory: '0 years',
      remarks: loanDetails[0]?.performanceStatus ? `Loan is ${loanDetails[0].performanceStatus}` : '',
      creditors,
      loanDetails,
    };
  }

  private formatDate(dateStr: string): string {
    if (dateStr) {
      const [day, month, year] = dateStr?.split('-') || [];
      if (!day || !month || !year) return '';
      return new Date(`${year}-${month}-${day}`).toISOString();
    }

    return new Date().toISOString();
  }
}