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
exports.loanPortfolio = exports.loanRepaymentSchedule = exports.loanTransactionStatus = exports.rejectLoan = exports.repayLoan = exports.createAndDisburseLoan = void 0;
const supabaseClient_1 = require("../utils/supabaseClient");
const validateParams_1 = require("../utils/validateParams");
const httpClient_1 = require("../utils/httpClient");
const generateRef_1 = require("../utils/generateRef");
const js_sha512_1 = require("js-sha512");
const createAndDisburseLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { transactionId, amount, duration, userId } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)(Object.assign({}, req.body), ["transactionId", "amount", "duration", "userId"]);
        const { data: { user } } = yield supabaseClient_1.supabase.auth.admin.getUserById(userId);
        console.log({ user });
        const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
        console.log({ account });
        const useraccount = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
        console.log({ useraccount });
        if (account.data && useraccount.data) {
            const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
            const { accountNo: uan, accountBalance: uab, accountId: uai, client: uc, clientId: uci, savingsProductName: uspn } = useraccount.data.data;
            const reference = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
            const response = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", {
                fromAccount: accountNo,
                uniqueSenderAccountId: accountId,
                fromClientId: clientId,
                fromClient: client,
                fromSavingsId: savingsProductName,
                toClientId: uci,
                toClient: uc,
                toSavingsId: uspn,
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
                const { transactionId } = req.body;
                const { data: loan, error } = yield supabaseClient_1.supabase
                    .from('loans')
                    .update([{ status: "accepted" }])
                    .eq("transactionId", transactionId)
                    .select();
                if (error) {
                    throw new Error(`Error storing to supabase: ${error.message}`);
                }
                const { data: transaction, error: transactionError } = yield supabaseClient_1.supabase
                    .from('transactions')
                    .insert([
                    {
                        name: "Withdrawal-" + reference,
                        category: "credit",
                        type: "loan",
                        user: userId,
                        details: "Loan Disbursement",
                        transaction_number: response.data.data.txnId || "no-txnId",
                        amount,
                        outstanding: 0.0,
                        session_id: response.data.data.sessionId || "no-sessionId",
                        status: "success"
                    },
                ])
                    .select();
                if (transactionError) {
                    throw new Error(`Error storing tansaction to supabase: ${transactionError.message}`);
                }
            }
            res.status(response.status).json({ status: "success", data: response.data.data });
        }
        res.status(400).json({ status: "success", message: 'Unable to get users information' });
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.createAndDisburseLoan = createAndDisburseLoan;
const repayLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { fromAccount, fromClientId, fromClient, fromSavingsId, fromBvn, toClientId, toClient, toSavingsId, toSession, toBvn, toKyc, toAccount, toBank, signature, amount, remark, reference, userId, outstanding } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)(Object.assign({}, req.body), [
            "fromAccount", "fromClientId", "fromClient", "fromSavingsId", "fromBvn", "toClientId", "toClient",
            "toSavingsId", "toBvn", "toAccount", "toBank", "signature", "amount", "reference", "userId", "outstanding"
        ]);
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
            const { data: loan, error: loanError } = yield supabaseClient_1.supabase
                .from('loans')
                .update([{ outstanding: outstanding - amount }])
                .eq("transactionId", response.data.data.txnId || "")
                .select();
            if (loanError) {
                throw new Error(`Error storing transaction to supabase: ${loanError.message}`);
            }
            const { data: transaction, error: transactionError } = yield supabaseClient_1.supabase
                .from('transactions')
                .insert([
                {
                    name: "Loan Repayment" + userId,
                    category: "credit",
                    type: "loan",
                    user: userId,
                    details: "Loan Repayment",
                    transaction_number: response.data.data.txnId || "no-txnId",
                    amount,
                    outstanding: outstanding - amount,
                    session_id: response.data.data.sessionId || "no-sessionId",
                    status: "success"
                }
            ])
                .select();
            if (transactionError) {
                throw new Error(`Error storing transaction to supabase: ${transactionError.message}`);
            }
            res.status(200).json({ status: "success", data: loan });
        }
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.repayLoan = repayLoan;
const rejectLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { transactionId } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ transactionId }, ["transactionId"]);
        const { data: loan, error } = yield supabaseClient_1.supabase
            .from('loans')
            .update([{ status: "accepted" }])
            .eq("transactionId", transactionId)
            .select();
        if (error) {
            throw new Error(`Error storing to supabase: ${error.message}`);
        }
        res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.rejectLoan = rejectLoan;
const loanTransactionStatus = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { identification } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ identification }, ["identification"]);
        const response = yield (0, httpClient_1.httpClient)(`/credit/loan/transactions?identification=${identification}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting loan transaction status:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.loanTransactionStatus = loanTransactionStatus;
const loanRepaymentSchedule = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { identification } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ identification }, ["identification"]);
        const response = yield (0, httpClient_1.httpClient)(`/credit/loan/repayment-schedule?identification=${identification}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting loan transaction status:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.loanRepaymentSchedule = loanRepaymentSchedule;
const loanPortfolio = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { startDate, endDate, page, size, filterBy, search } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ startDate, endDate }, ["startDate", "endDate"]);
        const query = `startDate=${startDate}&endDate=${endDate}${(page && `&page=${page}`)}${(size && `&size=${size}`)}${(filterBy && `&filterBy=${filterBy}`)}${(search && `&search=${search}`)}`;
        const response = yield (0, httpClient_1.httpClient)(`/credit/loan/portfolio?${query}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting repayment schedule:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.loanPortfolio = loanPortfolio;
