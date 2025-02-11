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
exports.checkLoansAndSendEmails = checkLoansAndSendEmails;
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const services_1 = require("../services");
const config_1 = require("../config");
const generateRef_1 = require("../utils/generateRef");
const httpClient_1 = require("../utils/httpClient");
const js_sha512_1 = require("js-sha512");
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    auth: {
        user: config_1.EMAIL_USERNAME,
        pass: config_1.EMAIL_PASSWORD,
    },
});
const { create: createTransaction } = new services_1.TransactionService();
const { find, update } = new services_1.UserService();
const { find: findLoan, update: updateLoan } = new services_1.LoanService();
function checkLoansAndSendEmails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log('Checking loans and sending emails...');
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        const formatDate = (date) => {
            // Format the date as "DD MMM YYYY"
            const options = {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
            };
            return date.toLocaleDateString('en-US', options);
        };
        const todayStr = formatDate(today);
        const tomorrowStr = formatDate(tomorrow);
        const upcomingLoans = yield findLoan({ repayment_date: tomorrowStr }, "many");
        const overdueLoans = yield findLoan({
            $expr: {
                $lte: [
                    { $dateFromString: { dateString: "$repayment_date", format: "%d %b %Y" } },
                    new Date()
                ]
            }
        }, "many");
        console.log({ upcomingLoans, overdueLoans, tomorrowStr, todayStr });
        if (upcomingLoans && Array.isArray(upcomingLoans) && upcomingLoans.length > 0) {
            console.log("In Upcoming Loans");
            for (const loan of upcomingLoans) {
                const user = yield find({ _id: loan.userId }, "one");
                console.log({ loan });
                if (user && !Array.isArray(user))
                    yield sendEmail(user.email, 'Loan Due Soon', `Your loan is due on ${loan.repayment_date}. Please make your payment.`);
            }
        }
        if (overdueLoans && Array.isArray(overdueLoans) && overdueLoans.length > 0) {
            console.log("In Overdue Loans");
            for (const loan of overdueLoans) {
                const user = yield find({ _id: loan.userId }, "one");
                console.log({ loan });
                if (user && !Array.isArray(user)) {
                    const ref = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
                    const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
                    console.log({ account, data: account.data.data });
                    const useraccount = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
                    console.log({ useraccount, data: useraccount.data.data });
                    if (account.data && useraccount.data) {
                        const { accountNo: userAccountNumber, accountBalance: userAccountBalance, accountId: userAccountId, client: userClient, clientId: userClientId, savingsProductName: userSavingsProductName } = useraccount.data.data;
                        const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
                        const ref = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
                        const amount = Number(user.user_metadata.wallet) >= Number(loan.repayment_amount) ? Number(loan.repayment_amount) : Number(user.user_metadata.wallet);
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
                            amount,
                            remark: "Loan Repayment",
                            transferType: "intra",
                            reference: ref
                        };
                        const response = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", body);
                        console.log({ response });
                        if (response.data && response.data.status === "00") {
                            yield updateLoan(loan._id, {
                                loan_payment_status: (Number(loan.outstanding) - Number(amount)) <= 0 ? "complete" : "in-progress",
                                outstanding: Number(loan.outstanding) - Number(amount),
                                repayment_history: [...loan.repayment_history, { amount: Number(amount), outstanding: Number(loan.outstanding) - Number(amount), action: "repayment", date: new Date().toLocaleString() }]
                            });
                            yield update(user._id, "user_metadata.wallet", String(Number((_a = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) - Number(amount)));
                            const transactionStatus = response.data.status === "00" ? "success" : "failed";
                            // Insert transaction record into database
                            yield createTransaction({
                                name: "Loan Repayment",
                                category: "debit",
                                type: "loan",
                                user: user._id,
                                details: "Loan mandatory repayment",
                                transaction_number: ref,
                                amount,
                                bank: "Prime Finance - VFD",
                                receiver: accountNo,
                                account_number: accountNo,
                                outstanding: 0.0,
                                session_id: ref,
                                status: transactionStatus,
                                message: response.data.status,
                            });
                        }
                    }
                    yield sendEmail(user.email, 'Loan Overdue', `Your loan was due on ${loan.repayment_date}. Please make the repayment immediately.`);
                }
            }
        }
    });
}
function sendEmail(to, subject, text) {
    return __awaiter(this, void 0, void 0, function* () {
        yield transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            text,
        });
        console.log(`Email sent to ${to}: ${subject}`);
    });
}
