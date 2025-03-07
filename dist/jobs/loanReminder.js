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
exports.addOnePercentToOverdueLoan = addOnePercentToOverdueLoan;
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const services_1 = require("../services");
const config_1 = require("../config");
const generateRef_1 = require("../utils/generateRef");
const httpClient_1 = require("../utils/httpClient");
const js_sha512_1 = require("js-sha512");
console.log({ EMAIL_USERNAME: config_1.EMAIL_USERNAME, EMAIL_PASSWORD: config_1.EMAIL_PASSWORD });
const transporter = nodemailer_1.default.createTransport({
    host: "smtp.mailgun.org",
    port: 465, // Use 587 for STARTTLS, 465 for SSL/TLS
    secure: true, // Set to `true` for port 465, `false` for 587
    auth: {
        user: config_1.EMAIL_USERNAME, // Example: brad@primefinance.live
        pass: config_1.EMAIL_PASSWORD, // Your Mailgun SMTP password
    },
});
const { create: createTransaction } = new services_1.TransactionService();
const { find, update } = new services_1.UserService();
const { find: findLoan, update: updateLoan } = new services_1.LoanService();
function calculateDaysOverdue(repaymentDateStr, currentDate) {
    // Convert the date strings to Date objects
    const repaymentDate = new Date(repaymentDateStr);
    if (repaymentDate < currentDate) {
        const diffInTime = currentDate.getTime() - repaymentDate.getTime();
        const diffInDays = diffInTime / (1000 * 60 * 60 * 24);
        return Math.floor(diffInDays);
    }
    return 0.01;
}
function checkLoansAndSendEmails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log('Checking overdue loans');
        const overdueLoans = yield findLoan({
            $expr: {
                $and: [
                    {
                        $lt: [
                            {
                                $dateFromString: {
                                    dateString: "$repayment_date",
                                    format: "%b %d, %Y", // Matches "Mar 02, 2025"
                                    timezone: "UTC" // Optional: Align with your timezone
                                }
                            },
                            {
                                $dateFromParts: {
                                    year: { $year: "$$NOW" },
                                    month: { $month: "$$NOW" },
                                    day: { $dayOfMonth: "$$NOW" },
                                    timezone: "UTC" // Match your timezone
                                }
                            }
                        ]
                    },
                    { $gt: ["$outstanding", 0] },
                    { $eq: ["$status", "accepted"] }
                ]
            }
        }, "many");
        console.log({ overdueLoans });
        if (overdueLoans && Array.isArray(overdueLoans) && overdueLoans.length > 0) {
            console.log("In Overdue Loans");
            for (const loan of overdueLoans) {
                const user = yield find({ _id: loan.userId }, "one");
                if (user && !Array.isArray(user)) {
                    const days = loan.repayment_history.length - 1 > 0 ? calculateDaysOverdue(loan.repayment_history[loan.repayment_history.length - 1].date, (new Date)) : 0.01;
                    const amount = Number(user.user_metadata.wallet) >= Number(loan.outstanding) ?
                        Number(user.user_metadata.wallet) >= (Number(loan.outstanding) + Number(loan.amount * days)) ?
                            (Number(loan.outstanding) + Number(loan.amount * days))
                            :
                                Number(loan.outstanding)
                        :
                            Number(user.user_metadata.wallet);
                    console.log({ amount });
                    const account = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
                    console.log({ account, data: account.data.data });
                    const useraccount = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
                    console.log({ useraccount, data: useraccount.data.data });
                    if (account.data && useraccount.data) {
                        const { accountNo: userAccountNumber, accountBalance: userAccountBalance, accountId: userAccountId, client: userClient, clientId: userClientId, savingsProductName: userSavingsProductName } = useraccount.data.data;
                        const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
                        const ref = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
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
                        if (response.data) {
                            yield updateLoan(loan._id, {
                                loan_payment_status: (Number(loan.outstanding) - Number(amount)) <= 0 ? "complete" : "in-progress",
                                outstanding: Number(loan.outstanding) - Number(amount),
                                repayment_history: [...(loan.repayment_history || []), { amount: Number(amount), outstanding: Number(loan.outstanding) - Number(amount), action: "repayment", date: new Date().toLocaleString() }]
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
                                outstanding: Number(loan.outstanding) - Number(amount),
                                session_id: ref,
                                status: transactionStatus,
                                message: response.data.status,
                            });
                        }
                    }
                }
            }
            console.log({ overdueLoans, todays_date: new Date(new Date().toISOString()) });
        }
    });
}
function addOnePercentToOverdueLoan() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('Checking loans and adding percentage...');
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
            const overdueLoans = yield findLoan({
                $expr: {
                    $and: [
                        {
                            $lt: [
                                {
                                    $dateFromString: {
                                        dateString: "$repayment_date",
                                        format: "%b %d, %Y", // Matches "Mar 02, 2025"
                                        timezone: "UTC" // Optional: Align with your timezone
                                    }
                                },
                                {
                                    $dateFromParts: {
                                        year: { $year: "$$NOW" },
                                        month: { $month: "$$NOW" },
                                        day: { $dayOfMonth: "$$NOW" },
                                        timezone: "UTC" // Match your timezone
                                    }
                                }
                            ]
                        },
                        { $gt: ["$outstanding", 0] },
                        { $eq: ["$status", "accepted"] }
                    ]
                }
            }, "many");
            const dueLoans = yield findLoan({
                repayment_date: todayStr,
                outstanding: { $gt: 0 }, // Condition for outstanding > 0
                status: "accepted"
            }, "many");
            const upcomingLoans = yield findLoan({
                repayment_date: tomorrowStr,
                outstanding: { $gt: 0 }, // Condition for outstanding > 0
                status: "accepted"
            }, "many");
            if (dueLoans && Array.isArray(dueLoans) && dueLoans.length > 0) {
                console.log("In Upcoming Loans");
                for (const loan of dueLoans) {
                    const user = yield find({ _id: loan.userId }, "one");
                    if (user && !Array.isArray(user))
                        yield sendEmail(user.email, 'Loan is Due Today', `Your loan is due on Today. Please make your payment.`);
                }
            }
            if (upcomingLoans && Array.isArray(upcomingLoans) && upcomingLoans.length > 0) {
                console.log("In Upcoming Loans");
                for (const loan of upcomingLoans) {
                    const user = yield find({ _id: loan.userId }, "one");
                    if (user && !Array.isArray(user))
                        yield sendEmail(user.email, 'Loan Due Soon', `Your loan is due on ${loan.repayment_date}. Please make your payment.`);
                }
            }
            if (overdueLoans && Array.isArray(overdueLoans) && overdueLoans.length > 0) {
                console.log("In Overdue Loans");
                for (const loan of overdueLoans) {
                    const user = yield find({ _id: loan.userId }, "one");
                    if (user && !Array.isArray(user))
                        yield sendEmail(user.email, 'Loan Overdue', `Your loan was due on ${loan.repayment_date}. Please make the repayment immediately.`);
                }
            }
        }
        catch (error) {
            console.log({ error });
        }
    });
}
function sendEmail(to, subject, text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const info = yield transporter.sendMail({
                from: "primefinance@primefinance.live", // Must match Mailgun's verified domain
                to,
                subject,
                text,
            });
            console.log(`✅ Email sent to ${to}: ${subject}`, info.messageId);
        }
        catch (error) {
            console.error(`❌ Email sending failed:`, error.message);
        }
    });
}
