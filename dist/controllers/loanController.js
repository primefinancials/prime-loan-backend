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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loans = exports.loanPortfolio = exports.loanTransactionStatus = exports.rejectLoan = exports.repayLoan = exports.UpdateLoanAmount = exports.createClientLoan = exports.createAndDisburseLoan = void 0;
const validateParams_1 = require("../utils/validateParams");
const httpClient_1 = require("../utils/httpClient");
const generateRef_1 = require("../utils/generateRef");
const js_sha512_1 = require("js-sha512");
const services_1 = require("../services");
const exceptions_1 = require("../exceptions");
const axios_1 = __importDefault(require("axios"));
const { find, findByEmail, create, update } = new services_1.UserService();
const { create: createTransaction } = new services_1.TransactionService();
const { update: updateLoan, findById: findLoanById, find: findLoan, create: createLoan } = new services_1.LoanService();
const httpRequest = (bvn) => __awaiter(void 0, void 0, void 0, function* () {
    const url = `https://api.creditchek.africa/v1/credit/creditRegistry-premium?bvn=${bvn}`;
    const accessToken = `M9/lR4xLUzwA+k4lnVWL40j98i96FtJmmPAfAQBktaL2BfhpEHqWIrmqORGzodK1`;
    const headers = {
        "Content-Type": "application/json",
        "token": accessToken,
    };
    const options = {
        url,
        method: "GET",
        headers
    };
    try {
        const response = yield (0, axios_1.default)(options);
        console.log({ response });
        if (![200, 202].includes(response.status)) {
            throw new Error(`Client creation failed: ${response.data.message}`);
        }
        console.log({ httpClient: "passed" });
        return response.data.data;
    }
    catch (error) {
        if (error.response.data.message == "Insufficient funds, minimum wallet balance of ₦538 is required"
            || error.message == "Insufficient funds, minimum wallet balance of ₦538 is required") {
            return ({ error: "Unable to create loan cause credit check can't be performed at this time" });
        }
        else {
            return ({ error });
        }
    }
});
const createAndDisburseLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const amount = Number(req.body.amount); // Ensure amount is a number
        const { duration, transactionId, userId } = req.body;
        const { admin } = req;
        console.log({ admin });
        if (!admin || !admin._id) {
            return res.status(404).json({
                status: "Admin not found.",
                data: null
            });
        }
        const user = yield find({ _id: userId }, "one");
        if (!user)
            throw new exceptions_1.NotFoundError(`Invalid user ID provided`);
        const foundLoan = yield findLoanById(transactionId);
        if (!foundLoan) {
            return res.status(404).json({
                status: "Loan not found.",
                data: null
            });
        }
        if (foundLoan.status === "accepted") {
            return res.status(400).json({
                status: "Loan already accepted.",
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
            // Processing Fee Calculation
            const processing_fee = (amount * 3) / 100;
            const total_amount = foundLoan.category === "working" ? amount - processing_fee : amount;
            console.log({ request_amount: req.body.amount, amount, processing_fee, total_amount });
            const response = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", {
                fromAccount: accountNo,
                uniqueSenderAccountId: "",
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
                amount: String(total_amount),
                remark: "Loan Disbursement",
                transferType: "intra",
                reference
            });
            console.log({ response });
            if (response.data) {
                const fee = Number(500);
                const loan_per = foundLoan.category === "working" ? 4 : 10;
                const percentage = duration / 30 >= 1
                    ? ((amount * loan_per) / 100) * (duration / 30)
                    : (amount * loan_per) / 100;
                const total = Number(Number(amount) + Number(fee + percentage));
                const loan = yield updateLoan(transactionId, Object.assign(Object.assign(Object.assign({}, (duration ? { duration } : {})), (amount ? { amount } : {})), { outstanding: total, status: "accepted" }));
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
            throw new exceptions_1.NotFoundError("User not found.");
        }
        // const credit = await httpRequest(bvn);
        // console.log({ credit });
        // if(credit.error) {
        //   throw new BadRequestError(credit.error);
        // }
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
            requested_amount: amount,
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
            loan_payment_status: "not-started",
            // credit_score: {
            //   loanId: credit._id,
            //   lastReported: "",
            //   creditorName: credit.name,
            //   totalDebt: credit.score.totalBorrowed,
            //   accountype: "",
            //   outstandingBalance: credit.score.totalOutstanding,
            //   activeLoan: credit.score.totalNoOfActiveLoans,
            //   loansTaken: credit.score.totalNoOfLoans,
            //   income: 0,
            //   repaymentHistory: credit.score.totalNoOfPerformingLoans,
            //   openedDate: credit.score.totalNoOfActiveLoans,
            //   lengthOfCreditHistory: credit.score.totalNoOfLoans,
            //   remarks: "",
            //   creditors: credit.score.creditors,
            //   loan_details: credit.score.loanPerformance,
            // }
        });
        if (!loan)
            throw new exceptions_1.NotFoundError("Loan not created");
        res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error getting loan transaction status:", error);
        next(error);
    }
});
exports.createClientLoan = createClientLoan;
const UpdateLoanAmount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { amount, transactionId, userId, } = req.body;
        const { admin } = req;
        if (!admin || !admin._id) {
            return res.status(403).json({
                status: "User Unauthorized.",
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
        if (Number(user.user_metadata.wallet) < Number(amount)) {
            return res.status(409).json({
                status: "Insufficient Funds.",
                data: null
            });
        }
        const foundLoan = yield findLoanById(transactionId);
        if (!foundLoan) {
            return res.status(404).json({
                status: "Loan not found.",
                data: null
            });
        }
        const loan = yield updateLoan(foundLoan._id, {
            amount
        });
        return res.status(200).json({ status: "success", data: loan });
    }
    catch (error) {
        console.log("Error creating disbursing loan:", error);
        next(error);
    }
});
exports.UpdateLoanAmount = UpdateLoanAmount;
const repayLoan = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { amount, transactionId, outstanding, } = req.body;
        const { user } = req;
        console.log({ user });
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        if (Number(user.user_metadata.wallet) < Number(outstanding)) {
            return res.status(409).json({
                status: "Insufficient Funds.",
                data: null
            });
        }
        const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
        console.log({ account, data: account.data.data });
        const useraccount = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
        console.log({ useraccount, data: useraccount.data.data });
        if (account.data && useraccount.data) {
            const { accountNo: userAccountNumber, accountBalance: userAccountBalance, accountId: userAccountId, client: userClient, clientId: userClientId, savingsProductName: userSavingsProductName } = useraccount.data.data;
            const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
            const ref = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
            if (userAccountBalance) {
                yield update(user._id, "user_metadata.wallet", String(userAccountBalance));
            }
            const body = {
                fromAccount: userAccountNumber,
                uniqueSenderAccountId: userAccountId,
                fromClientId: userClientId,
                fromClient: userClient,
                fromSavingsId: userAccountId,
                // fromBvn: "Rolandpay-birght 221552585559",
                toClientId: clientId,
                toClient: client,
                toSavingsId: accountId,
                toSession: accountId,
                // toBvn: "11111111111",
                toAccount: accountNo,
                toBank: "999999",
                signature: js_sha512_1.sha512.hex(`${userAccountNumber}${accountNo}`),
                amount: outstanding,
                remark: "Loan",
                transferType: "intra",
                reference: ref
            };
            const response = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", body);
            console.log({ response });
            if (response.data && response.data.status === "00") {
                const foundLoan = yield findLoanById(transactionId);
                if (!foundLoan) {
                    return res.status(404).json({
                        status: "Loan not found.",
                        data: null
                    });
                }
                const loan = yield updateLoan(foundLoan._id, {
                    loan_payment_status: (Number(outstanding) - Number(foundLoan.outstanding)) <= 0 ? "complete" : "in-progress",
                    outstanding: Number(outstanding) - Number(foundLoan.outstanding) <= 0 ? 0 : Number(outstanding) - Number(foundLoan.outstanding),
                    repayment_history: [...(foundLoan.repayment_history || []), { amount: Number(outstanding), outstanding: Number(outstanding) - Number(foundLoan.outstanding) <= 0 ? 0 : Number(outstanding) - Number(foundLoan.outstanding), action: "repayment", date: new Date().toLocaleString() }]
                });
                const newUser = yield update(user._id, "user_metadata.wallet", String(Number((_a = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) - Number(outstanding)));
                const transaction = yield createTransaction({
                    name: "Loan Repayment" + new Date().toDateString(),
                    category: "debit",
                    type: "loan",
                    user: user._id,
                    details: "Loan Repayment",
                    transaction_number: response.data.data.txnId || "no-txnId",
                    bank: "Prime Finance",
                    receiver: `Prime Finance`,
                    account_number: accountNo,
                    amount: outstanding,
                    outstanding: Number(outstanding) - Number(foundLoan.outstanding),
                    session_id: response.data.data.sessionId || "no-sessionId",
                    status: "success"
                });
                return res.status(200).json({ status: "success", data: loan });
            }
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
        const foundLoan = yield findLoanById(transactionId);
        if (!foundLoan) {
            return res.status(404).json({
                status: "Loan not found.",
                data: null
            });
        }
        if (foundLoan.status === "accepted") {
            return res.status(400).json({
                status: "Can not reject accepted loan.",
                data: null
            });
        }
        if (foundLoan.status === "rejected") {
            return res.status(400).json({
                status: "Loan already rejected.",
                data: null
            });
        }
        const loan = yield updateLoan(transactionId, {
            outstanding: 0,
            status: "rejected"
        });
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
