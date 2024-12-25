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
exports.walletAlerts = exports.transfer = exports.bankListing = exports.beneficiaryEnquiry = exports.accountEnquiry = exports.createClientAccount = void 0;
const supabaseClient_1 = require("../utils/supabaseClient");
const validateParams_1 = require("../utils/validateParams");
const convertDate_1 = require("../utils/convertDate");
const httpClient_1 = require("../utils/httpClient");
const js_sha512_1 = require("js-sha512");
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
        const { accountNumber } = req.query;
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry${accountNumber ? `?accountNumber=${accountNumber}` : "?"}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting account enquiry:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.accountEnquiry = accountEnquiry;
const beneficiaryEnquiry = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { accountNo, bank, transferType } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ accountNo, bank, transferType }, ["accountNo", "bank", "transferType"]);
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting account enquiry:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.beneficiaryEnquiry = beneficiaryEnquiry;
const bankListing = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/bank`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error creating client account:", error);
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.bankListing = bankListing;
const transfer = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { fromAccount, fromClientId, fromClient, fromSavingsId, fromBvn, toClient, toSession, toBvn, toKyc, toAccount, toBank, toSavingsId, amount, remark, reference, userId } = req.body;
        console.log(Object.assign({}, req.body));
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)(Object.assign({}, req.body), [
            "fromAccount", "fromClientId", "fromClient", "fromSavingsId", "fromBvn", "toClientId", "toClient",
            "toBvn", "toAccount", "toBank", "amount", "reference", "toSavingsId", "userId"
        ]);
        const { data: { user } } = yield supabaseClient_1.supabase.auth.admin.getUserById(userId);
        console.log({ user });
        if (!user || !user.id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        if (!Number(user.user_metadata.wallet) >= amount) {
            throw new Error("Insufficient Funds.");
        }
        const apiUrl = `/wallet2/transfer`;
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
            toSavingsId,
            toBank,
            signature: js_sha512_1.sha512.hex(`${fromAccount}${toAccount}`),
            amount,
            remark,
            transferType: "inter",
            reference
        });
        if (response.data && response.data.status === "00") {
            const { data: { user: newUser }, error: newError } = yield supabaseClient_1.supabase.auth.admin.updateUserById(user.id, { user_metadata: Object.assign(Object.assign({}, user.user_metadata), { wallet: Number((_a = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) - Number(amount) }) });
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
// Function to handle wallet alerts
const walletAlerts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const body = req.body;
        console.log({ body });
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)(body, [
            "reference",
            "amount",
            "account_number",
            "originator_account_number",
            "originator_account_name",
            "originator_bank",
            "originator_narration",
            "timestamp",
            // "transaction_channel",
            "session_id",
        ]);
        // retrieve all identites linked to a user
        const { data: { users }, error } = yield supabaseClient_1.supabase.auth.admin.listUsers();
        if (error) {
            throw new Error(`Failed to get users: ${error.message}`);
        }
        console.log({ users });
        users.map((user) => {
            var _a;
            console.log({ userPin: (_a = user.user_metadata) === null || _a === void 0 ? void 0 : _a.accountNo });
        });
        console.log({ myPin: body.account_number });
        // find the google identity 
        if (users.length) {
            const user = users.find(identity => { var _a; return String((_a = identity.user_metadata) === null || _a === void 0 ? void 0 : _a.accountNo) === String(body.account_number); });
            console.log({ user });
            if (!user || !user.id) {
                throw new Error("User not found.");
            }
            const { data: { user: newUser }, error: newError } = yield supabaseClient_1.supabase.auth.admin.updateUserById(user.id, { user_metadata: Object.assign(Object.assign({}, user.user_metadata), { wallet: (((_a = user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) ? Number((_b = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _b === void 0 ? void 0 : _b.wallet) : 0) + Number(body.amount) }) });
            console.log({ newUser });
            if (newError) {
                throw new Error(`Failed to update user wallet: ${newError.message}`);
            }
            // Insert transaction into database
            const { data, error: insertError } = yield supabaseClient_1.supabase
                .from("transactions")
                .insert([
                {
                    name: `Transfer from ${body.originator_account_name}`,
                    category: "credit",
                    type: "transfer",
                    user: user.id,
                    details: body.originator_narration,
                    transaction_number: String(body.reference),
                    amount: Number(body.amount).toFixed(0),
                    outstanding: 0.0,
                    session_id: body.session_id,
                    status: "success",
                },
            ]);
            console.log({ data });
            if (insertError) {
                throw new Error(`Failed to insert transaction: ${insertError.message}`);
            }
            return res.status(200).json({ status: "Success", data });
        }
        res.status(404).json({ status: "Failed", message: "User not found" });
    }
    catch (error) {
        console.error("Error handling wallet alerts:", error);
        res.status(400).json({ status: 400, message: error.message });
    }
});
exports.walletAlerts = walletAlerts;
