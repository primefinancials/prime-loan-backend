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
exports.LoanService = void 0;
const model_1 = require("../model");
const exceptions_1 = require("../exceptions");
class LoanService {
    create(loanData) {
        return __awaiter(this, void 0, void 0, function* () {
            const newLoan = yield model_1.LoanModel.create(loanData);
            return newLoan;
        });
    }
    ;
    update(uid, updateFields) {
        return __awaiter(this, void 0, void 0, function* () {
            const loan = yield model_1.LoanModel.findById(uid);
            if (!loan)
                throw new exceptions_1.NotFoundError(`No loan found with the id ${uid}`);
            return yield model_1.LoanModel.findByIdAndUpdate(uid, updateFields).then(loan => loan);
        });
    }
    ;
    fetchAll(limitValue, offsetValue) {
        return __awaiter(this, void 0, void 0, function* () {
            const loans = yield model_1.LoanModel.find().limit(limitValue).skip(offsetValue);
            return loans;
        });
    }
    ;
    find(fields, option) {
        return __awaiter(this, void 0, void 0, function* () {
            if (option === 'one') {
                const loan = yield model_1.LoanModel.findOne(fields).exec();
                return loan;
            }
            else if (option === 'many') {
                const loans = yield model_1.LoanModel.find(fields).lean();
                if (loans.length < 1)
                    return null;
                return loans;
            }
            ;
        });
    }
    ;
    findById(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const loan = yield model_1.LoanModel.findById(uid);
            // if (!loan) throw new NotFoundError(`No loan found with id ${uid}`)
            return loan;
        });
    }
    ;
    countDocuments(countQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const count = yield model_1.LoanModel.countDocuments(countQuery !== null && countQuery !== void 0 ? countQuery : {});
            return count;
        });
    }
    ;
    deleteLoan(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            yield model_1.LoanModel.deleteOne({
                _id: uid,
            });
        });
    }
    ;
}
exports.LoanService = LoanService;
;
