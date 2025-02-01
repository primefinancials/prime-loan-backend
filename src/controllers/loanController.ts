import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";
import { generateRandomString } from "../utils/generateRef";
import { sha512 } from "js-sha512";
import { ProtectedRequest } from "../interfaces";
import { UserService, TransactionService, LoanService } from "../services";
import { NotFoundError } from "../exceptions";

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction } = new TransactionService();
const { update: updateLoan, findById: findLoanById, find: findLoan, create: createLoan } = new LoanService();

export const createAndDisburseLoan = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, duration, transactionId } = req.body;

    const { user } = req;
    console.log({ user })

    if (!user || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }
    
    const account = await httpClient(`/wallet2/account/enquiry?`, "GET");
    console.log({ account })

    const useraccount = await httpClient(`/wallet2/account/enquiry?accountNumber=${user?.user_metadata.accountNo}`, "GET");
    console.log({ useraccount })
    
    if(account.data && useraccount.data) {
      const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
      const { accountNo: uan, accountBalance: uab, accountId: uai, bn, client: uc, clientId: uci, savingsProductName: uspn } = useraccount.data.data;
      const reference =`Prime-Finance-${generateRandomString(9)}`;

      const response = await httpClient("/wallet2/transfer", "POST", {
        fromAccount: accountNo,
        uniqueSenderAccountId: accountId,
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
        amount,
        remark: "Loan Disbursement",
        transferType: "intra",
        reference
      });

      console.log({ response });

      if(response.data) {
        const loan = await updateLoan("transactionId", transactionId);

        const transaction = await createTransaction(
          { 
            name: "Loan Withdrawal-" + new Date().toDateString(), 
            category: "credit",
            type: "loan",
            user: user._id,
            details: "Loan Disbursement",
            transaction_number: response.data.data.txnId || "no-txnId",
            amount,
            bank: "Prime Finance",
            receiver: `${user.user_metadata.first_name} ${user.user_metadata.surname}`,
            account_number: user.user_metadata.accountNo  || "",
            outstanding: 0.0,
            session_id: response.data.data.sessionId || "no-sessionId",
            status: "success"
          },
        );

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
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

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
      loan_payment_status: "not-started"
    });

    if(!loan) throw new NotFoundError("Loan id not found");

    res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error getting loan transaction status:", error);
    next(error);
  }
};

export const repayLoan = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
      const { 
        fromAccount,
        fromClientId,
        fromClient,
        fromSavingsId,
        fromBvn,
        toClientId,
        toClient,
        toSavingsId,
        toSession,
        toBvn,
        toKyc,
        toAccount,
        toBank,
        signature,
        amount,
        remark,
        transactionId,
        reference,
        outstanding,
        userId
      } = req.body;
  
      const apiUrl = `/wallet2/transfer`;
  
      const response = await httpClient(apiUrl, "POST", {
        fromAccount,
        uniqueSenderAccountId: "",
        fromClientId,
        fromClient,
        fromSavingsId,
        fromBvn,
        toClientId,
        toClient,
        toSavingsId,
        toSession,
        toBvn,
        toAccount,
        toBank,
        signature,
        amount,
        remark,
        transferType: "intra",
        reference
      });

      if(response.data) {
        const foundLoan = await findLoanById(transactionId);

        if (!foundLoan) {
          return res.status(404).json({
            status: "Loan not found.",
            data: null
          });
        }

        const loan = await updateLoan(foundLoan._id, { 
          loan_payment_status: (Number(outstanding) - Number(amount)) <= 0? "complete" : "in-progress", 
          outstanding: Number(outstanding) - Number(amount) 
        });

        const account = await httpClient(`/wallet2/account/enquiry?`, "GET");
        console.log({ account });
        
        const { accountNo } = account.data.data;

        const { admin } = req;

        if (!admin || !admin._id) {
          return res.status(404).json({
            status: "Admin not found.",
            data: null
          });
        }

        const user = await find({ _id: userId }, "one");

        if (!user || Array.isArray(user) || !user._id) {
          return res.status(404).json({
            status: "User not found.",
            data: null
          });
        }

        const newUser = await update(
          user._id,
          "user_metadata.wallet",
          String(Number(user?.user_metadata?.wallet) - Number(amount))
        );

        if(account.data && accountNo) {
          const transaction = await createTransaction(
            { 
              name: "Loan Repayment" + new Date().toDateString(), 
              category: "credit",
              type: "loan",
              user: user._id,
              details: "Loan Repayment",
              transaction_number: response.data.data.txnId ||  "no-txnId",
              bank: "Prime Finance",
              receiver: `Prime Finance`,
              account_number: accountNo,
              amount,
              outstanding: outstanding - amount,
              session_id: response.data.data.sessionId || "no-sessionId",
              status: "success"
            }
          );
        }
    
        return res.status(200).json({ status: "success", data: loan });
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
      const loan = await updateLoan("transactionId", transactionId);
  
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
