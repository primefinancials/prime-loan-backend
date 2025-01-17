"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageModel = exports.LoanModel = exports.TransactionModel = exports.UserModel = void 0;
var user_model_1 = require("./user.model");
Object.defineProperty(exports, "UserModel", { enumerable: true, get: function () { return __importDefault(user_model_1).default; } });
var transaction_model_1 = require("./transaction.model");
Object.defineProperty(exports, "TransactionModel", { enumerable: true, get: function () { return __importDefault(transaction_model_1).default; } });
var loan_model_1 = require("./loan.model");
Object.defineProperty(exports, "LoanModel", { enumerable: true, get: function () { return __importDefault(loan_model_1).default; } });
var message_model_1 = require("./message.model");
Object.defineProperty(exports, "MessageModel", { enumerable: true, get: function () { return __importDefault(message_model_1).default; } });
