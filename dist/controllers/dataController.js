"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMessages = exports.messages = exports.message = exports.adminTransactions = exports.transactions = exports.transaction = void 0;
const services_1 = require("../services");
const exceptions_1 = require("../exceptions");
const { find, findByEmail, create, update } = new services_1.UserService();
const { create: createTransaction, findById: findTransactionId, find: findTransaction } = new services_1.TransactionService();
const { update: updateMessage, findById: findMessageId, find: findMessage, create: createMessage } = new services_1.MessageService();
const transaction = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { transactionId } = req.query;
        if (!transactionId)
            throw new exceptions_1.ConflictError("Missing required parameter of transactionId");
        const transaction = yield findTransactionId(String(transactionId));
        if (!transaction)
            throw new exceptions_1.NotFoundError("Transaction id not found");
        res.status(200).json({ status: "success", data: transaction });
    }
    catch (error) {
        console.log("Error getting transaction:", error);
        next(error);
    }
});
exports.transaction = transaction;
const transactions = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user } = req;
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        const transactions = yield findTransaction({ user: user._id }, "many");
        console.log({ transactions });
        if (!transactions)
            return res.status(200).json({ status: "success", data: [] });
        ;
        return res.status(200).json({ status: "success", data: transactions });
    }
    catch (error) {
        console.log("Error getting transactions:", error);
        next(error);
    }
});
exports.transactions = transactions;
const adminTransactions = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { admin } = req;
        if (!admin || !admin._id) {
            return res.status(404).json({
                status: "Admin not found.",
                data: null
            });
        }
        const transactions = yield findTransaction({}, "many");
        if (!transactions)
            return res.status(200).json({ status: "success", data: [] });
        ;
        return res.status(200).json({ status: "success", data: transactions });
    }
    catch (error) {
        console.log("Error getting transactions:", error);
        next(error);
    }
});
exports.adminTransactions = adminTransactions;
const message = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { messageId } = req.query;
        if (!messageId)
            throw new exceptions_1.ConflictError("Missing required parameter of messageId");
        const message = yield findMessageId(String(messageId));
        if (!message)
            throw new exceptions_1.NotFoundError("Message id not found");
        res.status(200).json({ status: "success", data: message });
    }
    catch (error) {
        console.log("Error getting message:", error);
        next(error);
    }
});
exports.message = message;
const messages = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user } = req;
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        const messages = yield findMessage({ user: user._id }, "many");
        console.log({ messages });
        if (!messages)
            return res.status(200).json({ status: "success", data: [] });
        ;
        return res.status(200).json({ status: "success", data: messages });
    }
    catch (error) {
        console.log("Error getting message:", error);
        next(error);
    }
});
exports.messages = messages;
const adminMessages = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { admin } = req;
        if (!admin || !admin._id) {
            return res.status(404).json({
                status: "Admin not found.",
                data: null
            });
        }
        const messages = yield findMessage({}, "many");
        if (!messages)
            return res.status(200).json({ status: "success", data: [] });
        ;
        return res.status(200).json({ status: "success", data: messages });
    }
    catch (error) {
        console.log("Error getting message:", error);
        next(error);
    }
});
exports.adminMessages = adminMessages;
