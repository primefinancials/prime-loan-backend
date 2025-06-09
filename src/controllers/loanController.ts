import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";
import { generateRandomString } from "../utils/generateRef";
import { sha512 } from "js-sha512";
import { ProtectedRequest } from "../interfaces";
import { UserService, TransactionService, LoanService } from "../services";
import { BadRequestError, NotFoundError } from "../exceptions";
import axios, { AxiosRequestConfig } from "axios";
import { APIError } from "../exceptions";
import { date } from "joi";

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction } = new TransactionService();
const { update: updateLoan, findById: findLoanById, find: findLoan, create: createLoan } = new LoanService();

const httpRequest = async (bvn: string) => {
  const url = `https://api.creditchek.africa/v1/credit/creditRegistry-premium?bvn=${bvn}`;
  const accessToken = `M9/lR4xLUzwA+k4lnVWL40j98i96FtJmmPAfAQBktaL2BfhpEHqWIrmqORGzodK1`;

  const headers = {
    "Content-Type": "application/json",
    "token": accessToken,
  };

  const options: AxiosRequestConfig = {
    url,
    method: "GET",
    headers
  };

  try {
    const response = await axios(options);

    console.log({ response })

    if (![200, 202].includes(response.status)) {
        throw new Error(`Client creation failed: ${response.data.message}`);
    }

    console.log({ httpClient: "passed" })

    return response.data.data;
  } catch (error: any) {
    if(
      error.response.data.message == "Insufficient funds, minimum wallet balance of ₦538 is required" 
      || error.message == "Insufficient funds, minimum wallet balance of ₦538 is required"
    ) {
      return ({ error: "Unable to create loan cause credit check can't be performed at this time" });
    } else {
      return ({ error });
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

    const user: any = await find({ _id: userId }, "one");

    if (!user)
      throw new NotFoundError(`Invalid user ID provided`);

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

        const loan = await updateLoan(transactionId, {
          ...(duration? { duration } : { }),
          ...(amount? { amount } : { }),
          outstanding: total,
          status: "accepted"
        });

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
      acknowledgment
    } = req.body;

    const { user }= req;

    if (!user || !user._id) {
      throw new NotFoundError("User not found.");
    }

    // const credit = await httpRequest(bvn); 

    // console.log({ credit });

    // if(credit.error) {
    //   throw new BadRequestError(credit.error);
    // }

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
      // credit_score: {
      //   loanId: credit._id,
      //   lastReported: "",
      //   creditorName: credit.name,
      //   totalDebt: credit.score.totalBorrowed,
      //   accountype: "",
      //   outstandingBalance: credit.score.totalOutstanding,
      //   activeLoan: credit.score.totalNoOfActiveLoans,
      //   loansTaken: credit.score.totalNoOfLoans,
      //   income: 0,
      //   repaymentHistory: credit.score.totalNoOfPerformingLoans,
      //   openedDate: credit.score.totalNoOfActiveLoans,
      //   lengthOfCreditHistory: credit.score.totalNoOfLoans,
      //   remarks: "",
      //   creditors: credit.score.creditors,
      //   loan_details: credit.score.loanPerformance,
      // }
    });

    if(!loan) throw new NotFoundError("Loan not created");

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
      const { transactionId }= req.body;
      // Validate required parameters
      validateRequiredParams(
          { transactionId }, 
          [ "transactionId" ]
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
