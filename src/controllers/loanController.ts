import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";
import { generateRandomString } from "../utils/generateRef";
import { sha512 } from "js-sha512";
import { ProtectedRequest, Subscriber, LoanDetails, ICreditScore } from "../interfaces";
import { UserService, TransactionService, LoanService } from "../services";
import { BadRequestError, ConflictError, NotFoundError } from "../exceptions";
import axios, { AxiosRequestConfig } from "axios";
import { APIError } from "../exceptions";
import { date } from "joi";
import { sendEmail } from "../jobs/loanReminder";

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction } = new TransactionService();
const { update: updateLoan, findById: findLoanById, find: findLoan, create: createLoan } = new LoanService();

function convertToCreditScore(rawData: any): ICreditScore | null {
  if(rawData.error) return null;

  const profile = rawData?.profile || {};
  const creditHistories = rawData?.credit_history || [];

  const firstCredit = creditHistories[0]?.history[0] || {};

  console.log({ profile, creditHistories, firstCredit })

  const loan_details: LoanDetails[] = creditHistories.flatMap((ch: any) => {
    console.log({ ch });
    return ch.history.map((h: any) => {
      const repaymentAmount = isNaN(Number(h.repayment_amount)) ? 0 : Number(h.repayment_amount);

      console.log({ h });

      return {
        loanProvider: ch.institution || "Unknown",
        accountNumber: "N/A",
        loanAmount: repaymentAmount,
        outstandingBalance: 0,
        status: h.loan_status || "",
        performanceStatus: h.performance_status || "",
        overdueAmount: 0,
        type: "N/A",
        loanDuration: `${h.tenor || 0} months`,
        repaymentFrequency: h.repayment_frequency || "",
        repaymentBehavior: h.repayment_schedule?.[0]?.status || "",
        paymentProfile: h.repayment_schedule?.[0]?.status || "",
        dateAccountOpened: formatDate(h.date_opened),
        lastUpdatedAt: formatDate(h.closed_date),
        loanCount: ch.history.length,
        monthlyInstallmentAmt: repaymentAmount
      };
    });
  })

  const creditors: Subscriber[] = creditHistories.map((ch: any) => ({
    Subscriber_ID: ch.institution,
    Name: ch.institution,
    Phone: "",
    Address: ""
  }))

  const totalDebt = loan_details.reduce((sum, loan) => sum + loan.loanAmount, 0);

  return {
    loanId: "N/A",
    lastReported: rawData.timestamp || new Date().toISOString(),
    creditorName: creditHistories[0]?.institution || "Unknown",
    totalDebt: totalDebt.toString(),
    accountype: "N/A",
    outstandingBalance: 0,
    activeLoan: loan_details.filter(loan => loan.status === "open").length,
    loansTaken: loan_details.length,
    income: 0,
    repaymentHistory: loan_details[0]?.repaymentBehavior || "",
    openedDate: loan_details[0]?.dateAccountOpened || "",
    lengthOfCreditHistory: "0 years",
    remarks: loan_details[0]?.performanceStatus ? `Loan is ${loan_details[0].performanceStatus}` : "",
    creditors,
    loan_details
  };
}

// Helper: Convert DD-MM-YYYY to ISO format
function formatDate(dateStr: string): string {
  if(dateStr) {
    const [day, month, year] = dateStr?.split("-") || [];
    if (!day || !month || !year) return "";
    return new Date(`${year}-${month}-${day}`).toISOString();
  }

  return new Date().toISOString();
}

const httpRequest = async (bvn: string) => {
  const url = `https://api.withmono.com/v3/lookup/credit-history/all`;

  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "mono-sec-key": "live_sk_axio44pdonk6lb6rdhxa",
  };

  const options: AxiosRequestConfig = {
    url,
    method: "POST",
    headers,
    data: { bvn }
  };

  try {
    const response = await axios(options);

    if (![200, 202].includes(response.status)) {
        throw new Error(`Client creation failed: ${response.data.message}`);
    }

    return response.data.data;
  } catch (error: any) {
    if(
      error.response.data.message == "Insufficient funds, minimum wallet balance of ₦538 is required" 
      || error.message == "Insufficient funds, minimum wallet balance of ₦538 is required"
    ) {
      return ({ error: "Unable to create loan cause credit check can't be performed at this time" });
    } else {
      return ({ error: error.response.data });
    }
  }
};

export const createAndDisburseLoan = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const amount = Number(req.body.amount); // Ensure amount is a number
    const { duration, transactionId, userId } = req.body;

    const { admin } = req;
    console.log({ admin })

    if (!admin || !admin._id) {
      return res.status(404).json({
        status: "Admin not found.",
        data: null
      });
    }

    const user = await find({ _id: userId }, "one");

    if (!user || Array.isArray(user) || !user._id) {
      throw new NotFoundError(`Invalid user ID provided`);
    }

    const foundLoan = await findLoanById(transactionId);

    if (!foundLoan) {
      return res.status(404).json({
        status: "Loan not found.",
        data: null
      });
    }

    if (foundLoan.status === "accepted") {
      return res.status(400).json({
        status: "Loan already accepted.",
        data: null
      });
    }
    
    const account = await httpClient(`/wallet2/account/enquiry?`, "GET");
    // console.log({ account })

    const useraccount = await httpClient(`/wallet2/account/enquiry?accountNumber=${user?.user_metadata.accountNo}`, "GET");
    // console.log({ useraccount })
    
    if(account.data && useraccount.data) {
      const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
      const { accountNo: uan, accountBalance: uab, accountId: uai, bn, client: uc, clientId: uci, savingsProductName: uspn } = useraccount.data.data;
      const reference =`Prime-Finance-${generateRandomString(9)}`;

      // Processing Fee Calculation
      const processing_fee = (amount * 3) / 100;
      const total_amount = foundLoan.category === "working" ? amount - processing_fee : amount;

      console.log({ request_amount: req.body.amount, amount, processing_fee, total_amount });

      const response = await httpClient("/wallet2/transfer", "POST", {
        fromAccount: accountNo,
        uniqueSenderAccountId: "",
        fromClientId: clientId,
        fromClient: client,
        fromSavingsId: accountId,
        toClientId: uci,
        toClient: uc,
        toSavingsId: uai,
        toSession: uai,
        toAccount: uan,
        toBank: "999999",
        signature: sha512.hex(`${accountNo}${uan}`),
        amount: String(total_amount),
        remark: "Loan Disbursement",
        transferType: "intra",
        reference
      });

      console.log({ response });

      if(response.data) {
        const fee = Number(500);
        const loan_per = foundLoan.category === "working"? 4 : 10;
        const percentage = duration / 30 >= 1
        ? ((amount * loan_per) / 100) * (duration / 30)
        : (amount * loan_per) / 100;
        const total = Number(Number(amount) + Number(fee + percentage));

        const loanDate = new Date();
        const repaymentDate = new Date(loanDate);
        repaymentDate.setDate(loanDate.getDate() + Number(duration));

        const loan = await updateLoan(transactionId, {
          ...(duration ? { duration } : {}),
          ...(amount ? { amount } : {}),
          outstanding: total,
          status: "accepted",
          loan_date: loanDate.toISOString(),
          repayment_date: repaymentDate.toISOString(),
        });

        await sendEmail(
          user.email,
          "Loan Application Approved",
          `Congratulations on your successful loan! 🎉 Repay on time and unlock access to higher limits—up to ₦200,000 on your next request.\n\nPrime Finance`
        ) 

        res.status(response.status).json({ status: "success", data: response.data.data });
      }

      return res.status(400).json({ status: "failed", message: 'Unable to approve loan' });
    }
    
    return res.status(400).json({ status: "failed", message: 'Unable to get users information' });
  } catch (error: any) {
    console.log("Error creating disbursing loan:", error);
    next(error);
  }
};

export const createClientLoan = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { 
      first_name,
      last_name,
      dob,
      nin,
      email,
      bvn,
      phone,
      address,
      company,
      company_address,
      annual_income,
      guarantor_1_name,
      guarantor_1_phone,
      guarantor_2_name,
      guarantor_2_phone,
      amount,
      reason,
      base64Image, 
      outstanding, 
      category, type,
      status,
      duration, 
      repayment_amount,
      percentage,
      loan_date,
      repayment_date,
      acknowledgment,
      debit_account
    } = req.body;

    const { user }= req;

    if (!user || !user._id) {
      throw new NotFoundError("User not found.");
    }

    const loans_get = await findLoan(
      { 
        userId: user._id, 
        status: { $in: ["pending", "active"] } 
      }, 
      "many"
    );

    if (loans_get && Array.isArray(loans_get) && loans_get.length > 0) {
      throw new ConflictError(
        "Duplicate loan attempt. Wait for the current loan decision, or repay the existing one."
      );
    }

    const credit = await httpRequest(bvn); 

    const loan = await createLoan({
      first_name,
      last_name,
      dob,
      nin,
      email,
      bvn,
      phone,
      address,
      company,
      company_address,
      annual_income,
      guarantor_1_name,
      guarantor_1_phone,
      guarantor_2_name,
      guarantor_2_phone,
      requested_amount: amount,
      amount,
      reason,
      base64Image, 
      outstanding, 
      category, type,
      status,
      userId: user._id,
      duration, 
      repayment_amount,
      percentage,
      loan_date,
      repayment_date,
      acknowledgment,
      loan_payment_status: "not-started",
      credit_message: credit?.error?.message || "available",
      credit_score: convertToCreditScore(credit),
      debit_account: debit_account || "N/A"
    });

    if(!loan) throw new NotFoundError("Loan not created");

    await sendEmail(
      user.email,
      "Loan Application Received",
      `Dear ${user.user_metadata.first_name},\n\nYour loan application has been received. We will review it and get back to you shortly.\n\nThank you,\nPrime Finance`
    )

    await sendEmail(
      "primefinancials68@gmail.com, info@primefinance.live",
      "New Loan Created From User: " + user.user_metadata.first_name,
      `A new loan has been created by ${user.user_metadata.first_name} ${user.user_metadata.surname}.\n\nDetails:\n- Amount: ${amount}\n- Category: ${category}\n- Type: ${type}\n- Status: ${status}\n- Duration: ${duration} days\n\nPlease review the application at your earliest convenience.`
    )

    res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error getting loan transaction status:", error);
    next(error);
  }
};

export const UpdateLoanAmount = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { 
      amount,
      transactionId,
      userId,
    } = req.body;

    const { admin } = req;

    if(!admin || !admin._id) {
      return res.status(403).json({
        status: "User Unauthorized.",
        data: null
      });
    }

    const user = await find({ _id: userId }, "one")

    if (!user || Array.isArray(user) || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

    if (Number(user.user_metadata.wallet) < Number(amount)) {
      return res.status(409).json({
        status: "Insufficient Funds.",
        data: null
      });
    }

    const foundLoan = await findLoanById(transactionId);

    if (!foundLoan) {
      return res.status(404).json({
        status: "Loan not found.",
        data: null
      });
    }

    const loan = await updateLoan(foundLoan._id, { 
      amount
    });

    return res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error creating disbursing loan:", error);
    next(error);
  }
};

export const repayLoan = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
      const { 
        amount,
        transactionId,
        outstanding,
      } = req.body;
  
      const { user } = req;
    
      console.log({ user });

      if (!user || !user._id) {
        return res.status(404).json({
          status: "User not found.",
          data: null
        });
      }

      if (Number(user.user_metadata.wallet) < Number(outstanding)) {
        return res.status(409).json({
          status: "Insufficient Funds.",
          data: null
        });
      }
        
      const account = await httpClient(`/wallet2/account/enquiry?`, "GET");
      console.log({ account, data: account.data.data })

      const useraccount = await httpClient(`/wallet2/account/enquiry?accountNumber=${user?.user_metadata.accountNo}`, "GET");
      console.log({ useraccount, data: useraccount.data.data })
      
      if(account.data && useraccount.data) {
        const { accountNo: userAccountNumber, accountBalance: userAccountBalance, accountId: userAccountId, client: userClient, clientId: userClientId, savingsProductName: userSavingsProductName } = useraccount.data.data;
        const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
        const ref =`Prime-Finance-${generateRandomString(9)}`;

        if(userAccountBalance) {
          await update(
            user._id,
            "user_metadata.wallet",
            String(userAccountBalance)
          );
        }

        const body = {
          fromAccount: userAccountNumber,
          uniqueSenderAccountId: userAccountId,
          fromClientId: userClientId,
          fromClient: userClient,
          fromSavingsId: userAccountId,
          // fromBvn: "Rolandpay-birght 221552585559",
          toClientId: clientId,
          toClient: client,
          toSavingsId: accountId,
          toSession: accountId,
          // toBvn: "11111111111",
          toAccount: accountNo,
          toBank: "999999",
          signature: sha512.hex(`${userAccountNumber}${accountNo}`),
          amount: outstanding,
          remark: "Loan",
          transferType: "intra",
          reference: ref
        }
        
        const response = await httpClient("/wallet2/transfer", "POST", body);

        console.log({ response });

        if(response.data && response.data.status === "00") {
          const foundLoan = await findLoanById(transactionId);

          if (!foundLoan) {
            return res.status(404).json({
              status: "Loan not found.",
              data: null
            });
          }

          const loan = await updateLoan(foundLoan._id, { 
            loan_payment_status: (Number(outstanding) - Number(foundLoan.outstanding)) <= 0? "complete" : "in-progress", 
            outstanding: Number(outstanding) - Number(foundLoan.outstanding) <= 0? 0 : Number(outstanding) - Number(foundLoan.outstanding),
            repayment_history: [ ...(foundLoan.repayment_history || []), { amount: Number(outstanding), outstanding: Number(outstanding) - Number(foundLoan.outstanding) <= 0? 0 : Number(outstanding) - Number(foundLoan.outstanding), action: "repayment", date: new Date().toLocaleString() }]
          });

          const newUser = await update(
            user._id,
            "user_metadata.wallet",
            String(Number(user?.user_metadata?.wallet) - Number(outstanding))
          );

          const transaction = await createTransaction(
            { 
              name: "Loan Repayment" + new Date().toDateString(), 
              category: "debit",
              type: "loan",
              user: user._id,
              details: "Loan Repayment",
              transaction_number: response.data.data.txnId ||  "no-txnId",
              bank: "Prime Finance",
              receiver: `Prime Finance`,
              account_number: accountNo,
              amount: outstanding,
              outstanding: Number(outstanding) - Number(foundLoan.outstanding),
              session_id: response.data.data.sessionId || "no-sessionId",
              status: "success"
            }
          );
    
          return res.status(200).json({ status: "success", data: loan });
        }
      }

      return res.status(400).json({ status: "failed", message: 'Unable to get users information' });
    } catch (error: any) {
      console.log("Error creating disbursing loan:", error);
      next(error);
    }
};

export const rejectLoan = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
      const { transactionId, reason }= req.body;
      // Validate required parameters
      validateRequiredParams(
          { transactionId, reason }, 
          [ "transactionId", "reason" ]
      );

      const foundLoan = await findLoanById(transactionId);

      if (!foundLoan) {
        return res.status(404).json({
          status: "Loan not found.",
          data: null
        });
      }

      if (foundLoan.status === "accepted") {
        return res.status(400).json({
          status: "Can not reject accepted loan.",
          data: null
        });
      }

      if (foundLoan.status === "rejected") {
        return res.status(400).json({
          status: "Loan already rejected.",
          data: null
        });
      }

      const loan = await updateLoan(transactionId, {
        outstanding: 0,
        rejectionReason: reason,
        status: "rejected"
      });
  
      res.status(200).json({ status: "success", data: loan });
    } catch (error: any) {
      console.log("Error creating disbursing loan:", error);
      next(error);
    }
};

export const loanTransactionStatus = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { transactionId }= req.body;
    
    const loan = await findLoanById(transactionId);

    if(!loan) throw new NotFoundError("Loan id not found");

    res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error getting loan transaction status:", error);
    next(error);
  }
};

export const loanPortfolio = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { user }= req;

    if (!user || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

    const loan = await findLoan({ userId: user._id }, "many");

    if(!loan) return res.status(200).json({ status: "success", data: [] });;

    return res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error getting repayment schedule:", error);
    next(error);
  }
};

export const loans = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { admin }= req;

    if (!admin || !admin._id) {
      return res.status(404).json({
        status: "Admin not found.",
        data: null
      });
    }

    const loan = await findLoan({ }, "many");

    if(!loan) throw new NotFoundError("Loan not found");

    res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error getting repayment schedule:", error);
    next(error);
  }
};
