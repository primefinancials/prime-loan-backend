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
const mongoose_1 = require("mongoose");
const transactionSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true, // Transaction name or description
    },
    user: {
        type: String,
        required: true, // User ID (UUID)
    },
    type: {
        type: String,
        required: true,
    },
    category: {
        type: String,
        required: true,
    },
    amount: {
        type: Number,
        required: true, // Amount involved in the transaction
    },
    outstanding: {
        type: Number,
        required: true, // Outstanding amount, if any
    },
    activity: {
        type: Number,
        required: false, // Optional activity status
    },
    details: {
        type: String,
        required: true, // Details or description of the transaction
    },
    transaction_number: {
        type: String,
        required: true, // Unique transaction number
        unique: true, // Ensures uniqueness
    },
    session_id: {
        type: String,
        required: true, // Session ID associated with the transaction
    },
    status: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: false, // Additional message (optional)
    },
    receiver: {
        type: String,
        required: true, // Receiver information
    },
    bank: {
        type: String,
        required: true, // Bank details
    },
    account_number: {
        type: String,
        required: true, // Account number
    },
}, { timestamps: true });
const Transaction = (0, mongoose_1.model)('transactions', transactionSchema);
// Sync indexes with the database
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield Transaction.syncIndexes();
}))();
exports.default = Transaction;
