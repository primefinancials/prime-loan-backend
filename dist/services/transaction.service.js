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
exports.TransactionService = void 0;
const model_1 = require("../model");
const exceptions_1 = require("../exceptions");
class TransactionService {
    create(transactionData) {
        return __awaiter(this, void 0, void 0, function* () {
            const newTransaction = yield model_1.TransactionModel.create(transactionData);
            return newTransaction;
        });
    }
    ;
    update(uid, updateFields) {
        return __awaiter(this, void 0, void 0, function* () {
            const transaction = yield model_1.TransactionModel.findById(uid);
            if (!transaction)
                throw new exceptions_1.NotFoundError(`No transaction found with the id ${uid}`);
            return yield model_1.TransactionModel.findByIdAndUpdate(uid, updateFields).then(transaction => transaction);
        });
    }
    ;
    fetchAll(limitValue, offsetValue) {
        return __awaiter(this, void 0, void 0, function* () {
            const transactions = yield model_1.TransactionModel.find().limit(limitValue).skip(offsetValue);
            return transactions;
        });
    }
    ;
    find(fields, option) {
        return __awaiter(this, void 0, void 0, function* () {
            if (option === 'one') {
                const transaction = yield model_1.TransactionModel.findOne(fields).exec();
                return transaction;
            }
            else if (option === 'many') {
                const transactions = yield model_1.TransactionModel.find(fields).lean();
                if (transactions.length < 1)
                    return null;
                return transactions;
            }
            ;
        });
    }
    ;
    findById(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const transaction = yield model_1.TransactionModel.findById(uid);
            // if (!transaction) throw new NotFoundError(`No transaction found with id ${uid}`)
            return transaction;
        });
    }
    ;
    countDocuments(countQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const count = yield model_1.TransactionModel.countDocuments(countQuery !== null && countQuery !== void 0 ? countQuery : {});
            return count;
        });
    }
    ;
    deleteTransaction(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            yield model_1.TransactionModel.deleteOne({
                _id: uid,
            });
        });
    }
    ;
}
exports.TransactionService = TransactionService;
;
