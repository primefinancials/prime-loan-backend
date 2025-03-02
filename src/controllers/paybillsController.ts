import { NextFunction, Request, Response } from "express";
import { httpClient } from "../utils/httpClient";
import { validateRequiredParams } from "../utils/validateParams";
import { sha512 } from "js-sha512";
import { generateRandomString } from "../utils/generateRef";
import { ProtectedRequest } from "../interfaces";
import { UserService, TransactionService } from "../services";

const { update } = new UserService();
const { create: createTransaction } = new TransactionService();

export const getBillerCategories = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await httpClient("/billspaymentstore/billercategory", "GET");

    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    next(error);
  }
};

export const getBillerList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categoryName } = req.query;
    
    validateRequiredParams(
      { categoryName }, 
      [ "categoryName" ]
    );

    const response = await httpClient(`/billspaymentstore/billerlist?categoryName=${categoryName}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    next(error);
  }
};

export const getBillerItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { billerId, divisionId, productId } = req.query;
    
    validateRequiredParams(
      { billerId, divisionId, productId }, 
      [ "billerId", "divisionId", "productId" ]
    );

    const response = await httpClient(`/billspaymentstore/billerItems?billerId=${billerId}&divisionId=${divisionId}&productId=${productId}`, "GET");
    
    res.status(response.status || 200 ).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    next(error);
  }
};

export const validateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, divisionId, paymentItem, billerId } = req.query;
    
    validateRequiredParams(
      { customerId, divisionId, paymentItem, billerId }, 
      [ "customerId", "divisionId", "paymentItem", "billerId" ]
    );

    const response = await httpClient(`/billspaymentstore/customervalidate?divisionId=${divisionId}&paymentItem=${paymentItem}&customerId=${customerId}&billerId=${billerId}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    next(error);
  }
};

export const payBill = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      category,
      details,
      customerId,
      amount,
      reference,
      bank,
      division,
      paymentItem,
      productId,
      billerId,
      phoneNumber
    } = req.body;
    
    const { user } = req;
    
    console.log({ user });

    if (!user || !user._id) {
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
        amount,
        remark: "Paybills",
        transferType: "intra",
        reference: ref
      }
      
      const response = await httpClient("/wallet2/transfer", "POST", body);

      console.log({ response });

      if(response.data && response.data.status === "00") {
        // Call the payment API
        const payResponse = await httpClient("/billspaymentstore/pay", "POST", req.body);

        if (payResponse.data) {
          const newUser = await update(
            user._id,
            "user_metadata.wallet",
            String(Number(user?.user_metadata?.wallet) - Number(amount)) 
          );

          const transactionStatus = payResponse.data.status === "00" ? "success" : "failed";

          // Insert transaction record into database
          const transaction = await createTransaction(
            {
              name,
              category,
              type: "paybills",
              user: user._id,
              details,
              transaction_number: reference,
              amount,
              bank,
              receiver: customerId,
              account_number: customerId,
              outstanding: 0.0,
              session_id: reference,
              status: transactionStatus,
              message: payResponse.data.status,
              ...(phoneNumber && { phoneNumber }),
            },
          )

          // Respond with cleaned-up data
          res.status(payResponse.status || 200).json({
            status: payResponse.data.message,
            data: {
              ...payResponse.data.data, // Only include essential data
              transaction // Transaction data from database
            }
          });
        }
      } else {
        res.status(400).json({
          status: "failed",
          message: "Service unavailable, try again later!",
        });
      }
    } else {
      res.status(404).json({
        status: "failed",
        message: "Login, and try again",
      });
    }
  } catch (error: any) {
    console.error({ error });
    next(error);
  }
};

export const transactionStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.query;
    
    validateRequiredParams(
      { transactionId }, 
      [ "transactionId" ]
    );

    const response = await httpClient(`/billspaymentstore/transactionStatus?transactionId=${transactionId}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    next(error);
  }
};
