import { Request, Response } from "express";
import { httpClient } from "../utils/httpClient";
import { supabase } from "../utils/supabaseClient";
import { validateRequiredParams } from "../utils/validateParams";
import { sha512 } from "js-sha512";
import { generateRandomString } from "../utils/generateRef";

export const getBillerCategories = async (_req: Request, res: Response) => {
  try {
    const response = await httpClient("/billspaymentstore/billercategory", "GET");

    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const getBillerList = async (req: Request, res: Response) => {
  try {
    const { categoryName } = req.query;
    
    validateRequiredParams(
      { categoryName }, 
      [ "categoryName" ]
    );

    const response = await httpClient(`/billspaymentstore/billerlist?categoryName=${categoryName}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const getBillerItems = async (req: Request, res: Response) => {
  try {
    const { billerId, divisionId, productId } = req.query;
    
    validateRequiredParams(
      { billerId, divisionId, productId }, 
      [ "billerId", "divisionId", "productId" ]
    );

    const response = await httpClient(`/billspaymentstore/billerItems?billerId=${billerId}&divisionId=${divisionId}&productId=${productId}`, "GET");
    
    res.status(response.status || 200 ).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const validateCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId, divisionId, paymentItem, billerId } = req.query;
    
    validateRequiredParams(
      { customerId, divisionId, paymentItem, billerId }, 
      [ "customerId", "divisionId", "paymentItem", "billerId" ]
    );

    const response = await httpClient(`/billspaymentstore/customervalidate?divisionId=${divisionId}&paymentItem=${paymentItem}&customerId=${customerId}&billerId=${billerId}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const payBill = async (req: Request, res: Response) => {
  try {
    const {
      userId,
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

    // Validate required parameters
    validateRequiredParams(
      { ...req.body },
      [
        "userId",
        "name",
        "category",
        "amount",
        "reference",
        "customerId",
        "division",
        "paymentItem",
        "productId",
        "billerId",
      ]
    );
    
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    
    console.log({ user });

    if (!user || !user.id) {
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
          const { data: { user: newUser }, error: newError } = await supabase.auth.admin.updateUserById(
            user.id,
            { user_metadata: { ...user.user_metadata, wallet: Number(user?.user_metadata?.wallet) - Number(amount)  }}
          );

          const transactionStatus = payResponse.data.status === "00" ? "success" : "failed";

          // Insert transaction record into Supabase
          const { data, error } = await supabase
            .from("transactions")
            .insert([
              {
                name,
                category,
                type: "paybills",
                user: userId,
                details,
                transaction_number: customerId,
                amount,
                bank,
                reciever: customerId,
                account_number: customerId,
                outstanding: 0.0,
                session_id: reference,
                status: transactionStatus,
                message: payResponse.data.status,
                ...(phoneNumber && { phoneNumber }),
              },
            ])
            .select();

          if (error) {
            throw new Error(`Failed to log transaction: ${error.message}`);
          }

          // Respond with cleaned-up data
          res.status(payResponse.status || 200).json({
            status: payResponse.data.message,
            data: {
              ...payResponse.data.data, // Only include essential data
              transaction: data[0], // Transaction data from Supabase
            }
          });
        }
      } else {
        res.status(400).json({
          status: "error",
          message: "Service unavailable, try again later!",
        });
      }
    } else {
      res.status(404).json({
        status: "error",
        message: "Login, and try again",
      });
    }
  } catch (error: any) {
    console.error({ error });
    res.status(error.status || 500).json({
      status: "error",
      message: error.message || "An error occurred",
    });
  }
};

export const transactionStatus = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.query;
    
    validateRequiredParams(
      { transactionId }, 
      [ "transactionId" ]
    );

    const response = await httpClient(`/billspaymentstore/transactionStatus?transactionId=${transactionId}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};
