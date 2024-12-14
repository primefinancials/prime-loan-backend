import { supabase } from "../utils/supabaseClient";
import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { convertDate } from "../utils/convertDate";
import { httpClient } from "../utils/httpClient";
import { sha512 } from "js-sha512";

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
    const { accountNumber } = req.query;

    // Validate required parameters
    validateRequiredParams(
      { accountNumber }, 
      [ "accountNumber" ]
    );

    const response = await httpClient(`/wallet2/account/enquiry?accountNumber=${accountNumber}`, "GET");

    res.status(response.status).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log("Error getting account enquiry:", error);
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const beneficiaryEnquiry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { accountNo, bank, transferType } = req.query;
  
      // Validate required parameters
      validateRequiredParams(
          { accountNo, bank, transferType }, 
          [ "accountNo", "bank", "transferType" ]
      );
  
      const response = await httpClient(`/wallet2/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error getting account enquiry:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const bankListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await httpClient(`/wallet2/bank`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
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
      toSavingsId,
      amount,
      remark,
      reference,
      userId
    } = req.body;

    console.log({ ...req.body })

    // Validate required parameters
    validateRequiredParams(
      { ...req.body }, 
      [ 
        "fromAccount", "fromClientId", "fromClient", "fromSavingsId", "fromBvn", "toClientId", "toClient", 
        "toBvn", "toAccount", "toBank", "amount", "reference", "toSavingsId", "userId", "toKyc"
      ]
    );

    const apiUrl = `/wallet2/transfer`;

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
      toSavingsId,
      toBank,
      signature: sha512.hex(`${fromAccount}${toAccount}`),
      amount,
      remark,
      transferType: "Inter",
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

// Function to handle wallet alerts
export const walletAlerts = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    console.log({ body })

    // Validate required parameters
    validateRequiredParams(body, [
      "reference",
      "amount",
      "account_number",
      "originator_account_number",
      "originator_account_name",
      "originator_bank",
      "originator_narration",
      "timestamp",
      // "transaction_channel",
      "session_id",
    ]);
    
    
    // retrieve all identites linked to a user
    const { data: { users }, error } = await supabase.auth.admin.listUsers();

    if (error) {
      throw new Error(`Failed to get users: ${error.message}`);
    }

    console.log({ users })

    users.map((user) =>{
      console.log({ userPin: user.user_metadata?.accountNo })
    })

    console.log({ myPin: body.account_number })

      // find the google identity 
    if(users.length) {
      const user = users.find(
        identity => String(identity.user_metadata?.accountNo) === String(body.account_number)
      )

      console.log({ user });

      if (!user || !user.id) {
        throw new Error("User not found.");
      }

      const { data: { user: newUser }, error: newError } = await supabase.auth.admin.updateUserById(
        user.id,
        { user_metadata: { wallet: Number(user.user_metadata?.wallet? user?.user_metadata?.wallet : 0) + Number(body.amount).toFixed(0), ...user.user_metadata  }}
      )

      if (newError) {
        throw new Error(`Failed to update user wallet: ${newError.message}`);
      }

      // Insert transaction into database
      const { data, error: insertError } = await supabase
        .from("transactions")
        .insert([
          {
            name: `Transfer from ${body.originator_account_name}`,
            category: "credit",
            type: "transfer",
            user: user.id,
            details: body.originator_narration,
            transaction_number: String(body.reference),
            amount: Number(body.amount).toFixed(0),
            outstanding: 0.0,
            session_id: body.session_id,
            status: "success",
          },
        ]);

        console.log({ data })

      if (insertError) {
        throw new Error(`Failed to insert transaction: ${insertError.message}`);
      }

      return res.status(200).json({ status: "Success", data });
    }

    res.status(404).json({ status: "Failed", message: "User not found" });
  } catch (error: any) {
    console.error("Error handling wallet alerts:", error);
    res.status(400).json({ status: 400, message: error.message });
  }
};



