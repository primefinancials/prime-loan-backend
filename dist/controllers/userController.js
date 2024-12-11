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
exports.transfer = exports.bankListing = exports.accountEnquiry = exports.createClientAccount = void 0;
const supabaseClient_1 = require("../utils/supabaseClient");
const validateParams_1 = require("../utils/validateParams");
const convertDate_1 = require("../utils/convertDate");
const httpClient_1 = require("../utils/httpClient");
const createClientAccount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, surname, password, phone, bvn, nin, dob } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ bvn, dob, password, surname, email, name, phone, nin }, ["bvn", "dob", "password", "phone", "nin", "email", "name", "surname"]);
        const apiUrl = `/wallet2/client/create?bvn=${bvn}&dateOfBirth=${(0, convertDate_1.convertDate)(dob)}`;
        const response = yield (0, httpClient_1.httpClient)(apiUrl, "POST", {});
        console.log({ response });
        if (response.data) {
            const { data: { user }, error } = yield supabaseClient_1.supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { first_name: name, surname, phone, bvn, nin, dateOfBirth: (0, convertDate_1.convertDate)(dob), accountNo: response.data.data.accountNo },
                },
            });
            if (error) {
                throw new Error(`Error storing to supabase: ${error.message}`);
            }
            res.status(response.status).json({ status: "success", data: Object.assign(Object.assign({}, response.data.data), { user }) });
        }
        res.status(400).json({ status: "error", message: response.data.message });
    }
    catch (error) {
        console.log({ error });
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.createClientAccount = createClientAccount;
const accountEnquiry = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { accountNo, bank, transferType } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ accountNo, bank, transferType }, ["accountNo", "bank", "transferType"]);
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`, "GET");
        res.status(400).json({ status: "error", message: response.data.message });
    }
    catch (error) {
        console.log("Error getting account enquiry:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.accountEnquiry = accountEnquiry;
const bankListing = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/bank`, "GET");
        res.status(response.status).json({ status: "success", message: response.data.data });
    }
    catch (error) {
        console.log("Error creating client account:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.bankListing = bankListing;
const transfer = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { fromAccount, fromClientId, fromClient, fromSavingsId, fromBvn, toClient, toSession, toBvn, toKyc, toAccount, toBank, signature, amount, remark, reference, userId } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)(Object.assign({}, req.body), [
            "fromAccount", "fromClientId", "fromClient", "fromSavingsId", "fromBvn", "toClientId", "toClient",
            "toBvn", "toAccount", "toBank", "signature", "amount", "reference", "userId", "toKyc"
        ]);
        const apiUrl = `/wallet2/client/create`;
        const response = yield (0, httpClient_1.httpClient)(apiUrl, "POST", {
            fromAccount,
            uniqueSenderAccountId: "",
            fromClientId,
            fromClient,
            fromSavingsId,
            fromBvn,
            toClient,
            toSession,
            toBvn,
            toKyc,
            toAccount,
            toBank,
            signature,
            amount,
            remark,
            transferType: "inter",
            reference
        });
        if (response.data) {
            const { data: transaction, error } = yield supabaseClient_1.supabase
                .from('transactions')
                .insert([
                {
                    name: "Withdrawal-" + reference,
                    category: "credit",
                    type: "loan",
                    user: userId,
                    details: remark,
                    transaction_number: response.data.data.txnId || "no-txnId",
                    amount,
                    outstanding: 0.0,
                    session_id: response.data.data.sessionId || "no-sessionId",
                    status: "success"
                },
            ])
                .select();
            if (error) {
                throw new Error(`Error storing to supabase: ${error.message}`);
            }
            res.status(response.status).json({ status: "success", data: Object.assign(Object.assign({}, response.data.data), { transaction }) });
        }
        res.status(400).json({ status: "error", message: response.data.message });
    }
    catch (error) {
        console.log("Error creating client account:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.transfer = transfer;
