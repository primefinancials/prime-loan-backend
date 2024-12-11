import { supabase } from "../utils/supabaseClient";
import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";

export const createAndDisburseLoan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate required parameters
    validateRequiredParams(
        { ...req.body }, 
        [ "transactionId", "accountNo", "amount", "duration" ]
    );

    const response = await httpClient("/credit/loan/create-and-disburse", "POST", req.body);

    if(response.data) {
        const { transactionId } = req.body
        const { data: loan, error } = await supabase
            .from('loans')
            .update([{ status: "accepted" }])
            .eq("transactionId", transactionId)
            .select()
        ;

        if (error) {
            throw new Error(`Error storing to supabase: ${error.message}`);
        } 
    }

    res.status(response.status).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log("Error creating disbursing loan:", error);
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const repayLoan = async (req: Request, res: Response, next: NextFunction) => {
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
            reference,
            userId,
            outstanding
          } = req.body;
      
          // Validate required parameters
          validateRequiredParams(
              { ...req.body }, 
              [ 
                "fromAccount", "fromClientId", "fromClient", "fromSavingsId", "fromBvn", "toClientId", "toClient",
                "toSavingsId", "toBvn", "toAccount", "toBank", "signature", "amount", "reference", "userId", "outstanding"
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
            const { data: loan, error: loanError } = await supabase
                .from('loans')
                .update([{ outstanding: outstanding - amount }])
                .eq("transactionId", response.data.data.txnId || "")
                .select()
            ;

            if (loanError) {
                throw new Error(`Error storing transaction to supabase: ${loanError.message}`);
            } 

            const { data: transaction, error: transactionError } = await supabase
                .from('transactions')
                .insert([
                { 
                    name: "Loan Repayment" + userId, 
                    category: "credit",
                    type: "loan",
                    user: userId,
                    details: "Loan Repayment",
                    transaction_number: response.data.data.txnId ||  "no-txnId",
                    amount,
                    outstanding: outstanding - amount,
                    session_id: response.data.data.sessionId || "no-sessionId",
                    status: "success"
                },
                ])
                .select()
            ;

            if (transactionError) {
                throw new Error(`Error storing transaction to supabase: ${transactionError.message}`);
            } 
        
            res.status(200).json({ status: "success", data: loan });
        }
    } catch (error: any) {
      console.log("Error creating disbursing loan:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const rejectLoan = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId }= req.body;
      // Validate required parameters
      validateRequiredParams(
          { transactionId }, 
          [ "transactionId" ]
      );
      const { data: loan, error } = await supabase
        .from('loans')
        .update([{ status: "accepted" }])
        .eq("transactionId", transactionId)
        .select()
      ;

      if (error) {
        throw new Error(`Error storing to supabase: ${error.message}`);
      } 
  
      res.status(200).json({ status: "success", data: loan });
    } catch (error: any) {
      console.log("Error creating disbursing loan:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const loanTransactionStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identification } = req.query
      // Validate required parameters
      validateRequiredParams(
          { identification }, 
          [ "identification" ]
      );
  
      const response = await httpClient(`/credit/loan/transactions?identification=${identification}`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error getting loan transaction status:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const loanRepaymentSchedule = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identification } = req.query
      // Validate required parameters
      validateRequiredParams(
          { identification }, 
          [ "identification" ]
      );
  
      const response = await httpClient(`/credit/loan/repayment-schedule?identification=${identification}`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error getting loan transaction status:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const loanPortfolio = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate, page, size, filterBy, search } = req.query
      // Validate required parameters
      validateRequiredParams(
          { startDate, endDate }, 
          [ "startDate", "endDate" ]
      );

      const query = `startDate=${startDate}&endDate=${endDate}${(page && `&page=${page}`)}${(size && `&size=${size}`)}${(filterBy && `&filterBy=${filterBy}`)}${(search && `&search=${search}`)}`
  
      const response = await httpClient(`/credit/loan/portfolio?${query}`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error getting repayment schedule:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};
