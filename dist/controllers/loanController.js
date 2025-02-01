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
exports.loans = exports.loanPortfolio = exports.loanTransactionStatus = exports.rejectLoan = exports.repayLoan = exports.createClientLoan = exports.createAndDisburseLoan = void 0;
const validateParams_1 = require("../utils/validateParams");
const httpClient_1 = require("../utils/httpClient");
const generateRef_1 = require("../utils/generateRef");
const js_sha512_1 = require("js-sha512");
const services_1 = require("../services");
const exceptions_1 = require("../exceptions");
const { find, findByEmail, create, update } = new services_1.UserService();
const { create: createTransaction } = new services_1.TransactionService();
const { update: updateLoan, findById: findLoanById, find: findLoan, create: createLoan } = new services_1.LoanService();
const createAndDisburseLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { amount, duration, transactionId } = req.body;
        const { user } = req;
        console.log({ user });
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
        console.log({ account });
        const useraccount = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
        console.log({ useraccount });
        if (account.data && useraccount.data) {
            const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
            const { accountNo: uan, accountBalance: uab, accountId: uai, bn, client: uc, clientId: uci, savingsProductName: uspn } = useraccount.data.data;
            const reference = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
            const response = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", {
                fromAccount: accountNo,
                uniqueSenderAccountId: accountId,
                fromClientId: clientId,
                fromClient: client,
                fromSavingsId: accountId,
                toClientId: uci,
                toClient: uc,
                toSavingsId: uai,
                toSession: uai,
                toAccount: uan,
                toBank: "999999",
                signature: js_sha512_1.sha512.hex(`${accountNo}${uan}`),
                amount,
                remark: "Loan Disbursement",
                transferType: "intra",
                reference
            });
            console.log({ response });
            if (response.data) {
                const loan = yield updateLoan("transactionId", transactionId);
                const transaction = yield createTransaction({
                    name: "Loan Withdrawal-" + new Date().toDateString(),
                    category: "credit",
                    type: "loan",
                    user: user._id,
                    details: "Loan Disbursement",
                    transaction_number: response.data.data.txnId || "no-txnId",
                    amount,
                    bank: "Prime Finance",
                    receiver: `${user.user_metadata.first_name} ${user.user_metadata.surname}`,
                    account_number: user.user_metadata.accountNo || "",
                    outstanding: 0.0,
                    session_id: response.data.data.sessionId || "no-sessionId",
                    status: "success"
                });
                res.status(response.status).json({ status: "success", data: response.data.data });
            }
            return res.status(400).json({ status: "failed", message: 'Unable to approve loan' });
        }
        return res.status(400).json({ status: "failed", message: 'Unable to get users information' });
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        next(error);
    }
});
exports.createAndDisburseLoan = createAndDisburseLoan;
const createClientLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { first_name, last_name, dob, nin, email, bvn, phone, address, company, company_address, annual_income, guarantor_1_name, guarantor_1_phone, guarantor_2_name, guarantor_2_phone, amount, reason, base64Image, outstanding, category, type, status, duration, repayment_amount, percentage, loan_date, repayment_date, acknowledgment } = req.body;
        const { user } = req;
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        const loan = yield createLoan({
            first_name,
            last_name,
            dob,
            nin,
            email,
            bvn,
            phone,
            address,
            company,
            company_address,
            annual_income,
            guarantor_1_name,
            guarantor_1_phone,
            guarantor_2_name,
            guarantor_2_phone,
            amount,
            reason,
            base64Image,
            outstanding,
            category, type,
            status,
            userId: user._id,
            duration,
            repayment_amount,
            percentage,
            loan_date,
            repayment_date,
            acknowledgment,
            loan_payment_status: "not-started"
        });
        if (!loan)
            throw new exceptions_1.NotFoundError("Loan id not found");
        res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error getting loan transaction status:", error);
        next(error);
    }
});
exports.createClientLoan = createClientLoan;
const repayLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { fromAccount, fromClientId, fromClient, fromSavingsId, fromBvn, toClientId, toClient, toSavingsId, toSession, toBvn, toKyc, toAccount, toBank, signature, amount, remark, transactionId, reference, outstanding, userId } = req.body;
        const apiUrl = `/wallet2/transfer`;
        const response = yield (0, httpClient_1.httpClient)(apiUrl, "POST", {
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
        if (response.data) {
            const foundLoan = yield findLoanById(transactionId);
            if (!foundLoan) {
                return res.status(404).json({
                    status: "Loan not found.",
                    data: null
                });
            }
            const loan = yield updateLoan(foundLoan._id, {
                loan_payment_status: (Number(outstanding) - Number(amount)) <= 0 ? "complete" : "in-progress",
                outstanding: Number(outstanding) - Number(amount)
            });
            const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
            console.log({ account });
            const { accountNo } = account.data.data;
            const { admin } = req;
            if (!admin || !admin._id) {
                return res.status(404).json({
                    status: "Admin not found.",
                    data: null
                });
            }
            const user = yield find({ _id: userId }, "one");
            if (!user || Array.isArray(user) || !user._id) {
                return res.status(404).json({
                    status: "User not found.",
                    data: null
                });
            }
            const newUser = yield update(user._id, "user_metadata.wallet", String(Number((_a = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) - Number(amount)));
            if (account.data && accountNo) {
                const transaction = yield createTransaction({
                    name: "Loan Repayment" + new Date().toDateString(),
                    category: "credit",
                    type: "loan",
                    user: user._id,
                    details: "Loan Repayment",
                    transaction_number: response.data.data.txnId || "no-txnId",
                    bank: "Prime Finance",
                    receiver: `Prime Finance`,
                    account_number: accountNo,
                    amount,
                    outstanding: outstanding - amount,
                    session_id: response.data.data.sessionId || "no-sessionId",
                    status: "success"
                });
            }
            return res.status(200).json({ status: "success", data: loan });
        }
        return res.status(400).json({ status: "failed", message: 'Unable to get users information' });
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        next(error);
    }
});
exports.repayLoan = repayLoan;
const rejectLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { transactionId } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ transactionId }, ["transactionId"]);
        const loan = yield updateLoan("transactionId", transactionId);
        res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        next(error);
    }
});
exports.rejectLoan = rejectLoan;
const loanTransactionStatus = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { transactionId } = req.body;
        const loan = yield findLoanById(transactionId);
        if (!loan)
            throw new exceptions_1.NotFoundError("Loan id not found");
        res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error getting loan transaction status:", error);
        next(error);
    }
});
exports.loanTransactionStatus = loanTransactionStatus;
const loanPortfolio = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user } = req;
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        const loan = yield findLoan({ userId: user._id }, "many");
        if (!loan)
            return res.status(200).json({ status: "success", data: [] });
        ;
        return res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error getting repayment schedule:", error);
        next(error);
    }
});
exports.loanPortfolio = loanPortfolio;
const loans = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { admin } = req;
        if (!admin || !admin._id) {
            return res.status(404).json({
                status: "Admin not found.",
                data: null
            });
        }
        const loan = yield findLoan({}, "many");
        if (!loan)
            throw new exceptions_1.NotFoundError("Loan not found");
        res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error getting repayment schedule:", error);
        next(error);
    }
});
exports.loans = loans;
