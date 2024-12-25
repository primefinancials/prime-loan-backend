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
exports.transactionStatus = exports.payBill = exports.validateCustomer = exports.getBillerItems = exports.getBillerList = exports.getBillerCategories = void 0;
const httpClient_1 = require("../utils/httpClient");
const supabaseClient_1 = require("../utils/supabaseClient");
const validateParams_1 = require("../utils/validateParams");
const js_sha512_1 = require("js-sha512");
const getBillerCategories = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield (0, httpClient_1.httpClient)("/billspaymentstore/billercategory", "GET");
        res.status(response.status || 200).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.getBillerCategories = getBillerCategories;
const getBillerList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { categoryName } = req.query;
        (0, validateParams_1.validateRequiredParams)({ categoryName }, ["categoryName"]);
        const response = yield (0, httpClient_1.httpClient)(`/billspaymentstore/billerlist?categoryName=${categoryName}`, "GET");
        res.status(response.status || 200).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.getBillerList = getBillerList;
const getBillerItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { billerId, divisionId, productId } = req.query;
        (0, validateParams_1.validateRequiredParams)({ billerId, divisionId, productId }, ["billerId", "divisionId", "productId"]);
        const response = yield (0, httpClient_1.httpClient)(`/billspaymentstore/billerItems?billerId=${billerId}&divisionId=${divisionId}&productId=${productId}`, "GET");
        res.status(response.status || 200).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.getBillerItems = getBillerItems;
const validateCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { customerId, divisionId, paymentItem, billerId } = req.query;
        (0, validateParams_1.validateRequiredParams)({ customerId, divisionId, paymentItem, billerId }, ["customerId", "divisionId", "paymentItem", "billerId"]);
        const response = yield (0, httpClient_1.httpClient)(`/billspaymentstore/customervalidate?divisionId=${divisionId}&paymentItem=${paymentItem}&customerId=${customerId}&billerId=${billerId}`, "GET");
        res.status(response.status || 200).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.validateCustomer = validateCustomer;
const payBill = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { userId, name, category, details, customerId, amount, reference, division, paymentItem, productId, billerId, phoneNumber } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)(Object.assign({}, req.body), [
            "userId",
            "name",
            "category",
            "amount",
            "reference",
            "customerId",
            "division",
            "paymentItem",
            "productId",
            "billerId",
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
            return res.status(409).json({
                status: "Insufficient Funds.",
                data: null
            });
        }
        const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
        console.log({ account });
        const useraccount = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
        console.log({ useraccount });
        if (account.data && useraccount.data) {
            const { accountNo, accountBalance, accountId, client, clientId, bvn, savingsProductName } = useraccount.data.data;
            const { accountNo: uan, accountBalance: uab, accountId: uai, client: uc, bvn: toBvn, clientId: uci, savingsProductName: uspn } = account.data.data;
            const response = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", {
                fromAccount: accountNo,
                uniqueSenderAccountId: accountId,
                fromClientId: clientId,
                fromClient: client,
                fromSavingsId: savingsProductName,
                fromBvn: bvn,
                toClientId: uci,
                toClient: uc,
                toSavingsId: uspn,
                toSession: uai,
                toBvn,
                toAccount: uan,
                toBank: "999999",
                signature: js_sha512_1.sha512.hex(`${accountNo}${uan}`),
                amount,
                remark: "Paybills",
                transferType: "intra",
                reference
            });
            console.log({ response });
            if (response.data && response.data.status === "00") {
                // Call the payment API
                const payResponse = yield (0, httpClient_1.httpClient)("/billspaymentstore/pay", "POST", req.body);
                if (payResponse.data) {
                    const { data: { user: newUser }, error: newError } = yield supabaseClient_1.supabase.auth.admin.updateUserById(user.id, { user_metadata: Object.assign(Object.assign({}, user.user_metadata), { wallet: Number((_a = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) - Number(amount) }) });
                    const transactionStatus = payResponse.data.status === "00" ? "success" : "failed";
                    // Insert transaction record into Supabase
                    const { data, error } = yield supabaseClient_1.supabase
                        .from("transactions")
                        .insert([
                        Object.assign({ name,
                            category, type: "paybills", user: userId, details, transaction_number: customerId, amount, outstanding: 0.0, session_id: reference, status: transactionStatus, message: payResponse.data.status }, (phoneNumber && { phoneNumber })),
                    ])
                        .select();
                    if (error) {
                        throw new Error(`Failed to log transaction: ${error.message}`);
                    }
                    // Respond with cleaned-up data
                    res.status(payResponse.status || 200).json({
                        status: payResponse.data.message,
                        data: Object.assign(Object.assign({}, payResponse.data.data), { transaction: data[0] })
                    });
                }
            }
            else {
                res.status(400).json({
                    status: "error",
                    message: "Service unavailable, try again later!",
                });
            }
        }
        else {
            res.status(404).json({
                status: "error",
                message: "Login, and try again",
            });
        }
    }
    catch (error) {
        console.error({ error });
        res.status(error.status || 500).json({
            status: "error",
            message: error.message || "An error occurred",
        });
    }
});
exports.payBill = payBill;
const transactionStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { transactionId } = req.query;
        (0, validateParams_1.validateRequiredParams)({ transactionId }, ["transactionId"]);
        const response = yield (0, httpClient_1.httpClient)(`/billspaymentstore/transactionStatus?transactionId=${transactionId}`, "GET");
        res.status(response.status || 200).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        res.status(error.status || 500).json({ status: "error", message: error.message });
    }
});
exports.transactionStatus = transactionStatus;
