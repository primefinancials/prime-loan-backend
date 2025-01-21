import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";
import { generateRandomString } from "../utils/generateRef";
import { sha512 } from "js-sha512";
import { ProtectedRequest } from "../interfaces";
import { UserService, TransactionService, MessageService } from "../services";
import { NotFoundError } from "../exceptions";

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction, findById: findTransactionId, find: findTransaction } = new TransactionService();
const { update: updateMessage, findById: findMessageId, find: findMessage, create: createMessage } = new MessageService();

export const transaction = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
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

export const transactions = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { user }= req;

    if (!user || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

    const loan = await findLoan({ userId: user._id }, "many");

    if(!loan) throw new NotFoundError("Loan not found");

    res.status(200).json({ status: "success", data: loan });
  } catch (error: any) {
    console.log("Error getting repayment schedule:", error);
    next(error);
  }
};

export const message = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
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
  
export const messages = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
      const { user }= req;
  
      if (!user || !user._id) {
        return res.status(404).json({
          status: "User not found.",
          data: null
        });
      }
  
      const loan = await findLoan({ userId: user._id }, "many");
  
      if(!loan) throw new NotFoundError("Loan not found");
  
      res.status(200).json({ status: "success", data: loan });
    } catch (error: any) {
      console.log("Error getting repayment schedule:", error);
      next(error);
    }
};
