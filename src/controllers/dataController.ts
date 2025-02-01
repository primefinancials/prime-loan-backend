import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";
import { generateRandomString } from "../utils/generateRef";
import { sha512 } from "js-sha512";
import { ProtectedRequest } from "../interfaces";
import { UserService, TransactionService, MessageService } from "../services";
import { ConflictError, NotFoundError } from "../exceptions";

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction, findById: findTransactionId, find: findTransaction } = new TransactionService();
const { update: updateMessage, findById: findMessageId, find: findMessage, create: createMessage } = new MessageService();

export const transaction = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { transactionId }= req.query;

    if(!transactionId) throw new ConflictError("Missing required parameter of transactionId")
    
    const transaction = await findTransactionId(String(transactionId));

    if(!transaction) throw new NotFoundError("Transaction id not found");

    res.status(200).json({ status: "success", data: transaction });
  } catch (error: any) {
    console.log("Error getting transaction:", error);
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

    const transactions = await findTransaction({ user: user._id }, "many");

    console.log({ transactions })

    if(!transactions) return res.status(200).json({ status: "success", data: [] });;

    return res.status(200).json({ status: "success", data: transactions });
  } catch (error: any) {
    console.log("Error getting transactions:", error);
    next(error);
  }
};

export const adminTransactions = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { admin }= req;

    if (!admin || !admin._id) {
      return res.status(404).json({
        status: "Admin not found.",
        data: null
      });
    }

    const transactions = await findTransaction({ }, "many");

    if(!transactions) return res.status(200).json({ status: "success", data: [] });;

    return res.status(200).json({ status: "success", data: transactions });
  } catch (error: any) {
    console.log("Error getting transactions:", error);
    next(error);
  }
};

export const message = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { messageId }= req.query;

    if(!messageId) throw new ConflictError("Missing required parameter of messageId")
    
    const message = await findMessageId(String(messageId));

    if(!message) throw new NotFoundError("Message id not found");

    res.status(200).json({ status: "success", data: message });
  } catch (error: any) {
    console.log("Error getting message:", error);
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

    const messages = await findMessage({ user: user._id }, "many");

    console.log({ messages })

    if(!messages) return res.status(200).json({ status: "success", data: [] });;

    return res.status(200).json({ status: "success", data: messages });
  } catch (error: any) {
    console.log("Error getting message:", error);
    next(error);
  }
};

export const adminMessages = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { admin }= req;

    if (!admin || !admin._id) {
      return res.status(404).json({
        status: "Admin not found.",
        data: null
      });
    }

    const messages = await findMessage({ }, "many");

    if(!messages) return res.status(200).json({ status: "success", data: [] });;

    return res.status(200).json({ status: "success", data: messages });
  } catch (error: any) {
    console.log("Error getting message:", error);
    next(error);
  }
};
