import { supabase } from "../utils/supabaseClient";
import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { convertDate } from "../utils/convertDate";
import { httpClient } from "../utils/httpClient";

export const createClientAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name, surname, password, phone, bvn, nin, dob } = req.body;

    // Validate required parameters
    validateRequiredParams(
        { bvn, dob, password, surname, email, name, phone, nin }, 
        [ "bvn", "dob", "password", "phone", "nin", "email", "name", "surname" ]
    );

    const apiUrl = `/wallet2/client/create?bvn=${bvn}&dateOfBirth=${convertDate(dob)}`;

    const response = await httpClient(apiUrl, "POST", { });

    console.log({ response })

    if(response.data) {
        const { data: { user }, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { first_name: name, surname, phone, bvn, nin, dateOfBirth: convertDate(dob), accountNo: response.data.data.accountNo },
          },
        });

        if (error) {
            throw new Error(`Error storing to supabase: ${error.message}`);
        } 

        res.status(response.status).json({ status: "success", data: { ...response.data.data, user } });
    }

    res.status(400).json({ status: "error", message: response.data.message });
  } catch (error: any) {
    console.log({ error });
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const accountEnquiry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { accountNo, bank, transferType } = req.query;
  
      // Validate required parameters
      validateRequiredParams(
          { accountNo, bank, transferType }, 
          [ "accountNo", "bank", "transferType" ]
      );
  
      const response = await httpClient(`/wallet2/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`, "GET");
  
      res.status(400).json({ status: "error", message: response.data.message });
    } catch (error: any) {
      console.log("Error getting account enquiry:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const bankListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await httpClient(`/wallet2/bank`, "GET");
  
      res.status(response.status).json({ status: "success", message: response.data.data });
    } catch (error: any) {
      console.log("Error creating client account:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const transfer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        fromAccount,
        fromClientId,
        fromClient,
        fromSavingsId,
        fromBvn,
        toClient,
        toSession,
        toBvn,
        toKyc,
        toAccount,
        toBank,
        signature,
        amount,
        remark,
        reference,
        userId
      } = req.body;
  
      // Validate required parameters
      validateRequiredParams(
          { ...req.body }, 
          [ 
            "fromAccount", "fromClientId", "fromClient", "fromSavingsId", "fromBvn", "toClientId", "toClient",
            "toBvn", "toAccount", "toBank", "signature", "amount", "reference", "userId", "toKyc"
          ]
      );
  
      const apiUrl = `/wallet2/client/create`;
  
      const response = await httpClient(apiUrl, "POST", {
        fromAccount,
        uniqueSenderAccountId: "",
        fromClientId,
        fromClient,
        fromSavingsId,
        fromBvn,
        toClient,
        toSession,
        toBvn,
        toKyc,
        toAccount,
        toBank,
        signature,
        amount,
        remark,
        transferType: "inter",
        reference
      });
  
      if(response.data) {
        const { data: transaction, error } = await supabase
            .from('transactions')
            .insert([
            { 
                name: "Withdrawal-" + reference, 
                category: "credit",
                type: "loan",
                user: userId,
                details: remark,
                transaction_number: response.data.data.txnId || "no-txnId",
                amount,
                outstanding: 0.0,
                session_id: response.data.data.sessionId || "no-sessionId",
                status: "success"
            },
            ])
            .select()
        ;
  
        if (error) {
            throw new Error(`Error storing to supabase: ${error.message}`);
        } 
  
        res.status(response.status).json({ status: "success", data: { ...response.data.data, transaction } });
      }
  
      res.status(400).json({ status: "error", message: response.data.message });
    } catch (error: any) {
      console.log("Error creating client account:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};


