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
exports.sendMessageForLoan = void 0;
exports.checkLoansAndSendEmails = checkLoansAndSendEmails;
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const services_1 = require("../services");
const config_1 = require("../config");
const generateRef_1 = require("../utils/generateRef");
const httpClient_1 = require("../utils/httpClient");
const js_sha512_1 = require("js-sha512");
const mongoose_1 = __importDefault(require("mongoose"));
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
function checkLoansAndSendEmails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            console.log('Checking overdue loans');
            const today = new Date();
            const formattedToday = today.toISOString().split("T")[0];
            const overdueLoans = yield findLoan({
                $expr: {
                    $and: [
                        {
                            $lt: [
                                {
                                    $dateFromString: {
                                        dateString: "$repayment_date",
                                        format: "%b %d, %Y",
                                        timezone: "UTC"
                                    }
                                },
                                {
                                    $dateFromParts: {
                                        year: { $year: "$$NOW" },
                                        month: { $month: "$$NOW" },
                                        day: { $dayOfMonth: "$$NOW" },
                                        timezone: "UTC"
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
            if (!overdueLoans || !Array.isArray(overdueLoans) || overdueLoans.length <= 0) {
                console.log("No overdue loans found.");
                return;
            }
            for (const loan of overdueLoans) {
                try {
                    const user = yield find({ _id: loan.userId }, "one");
                    if (!user || Array.isArray(user))
                        throw new Error(`User not found for loan ${loan._id}`);
                    const userAccountRes = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?accountNumber=${user === null || user === void 0 ? void 0 : user.user_metadata.accountNo}`, "GET");
                    if (!userAccountRes.data)
                        throw new Error(`User account not found for loan ${loan._id}`);
                    const userAccountData = userAccountRes.data.data;
                    const userBalance = Number(userAccountData.accountBalance);
                    const adminAccountRes = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry?`, "GET");
                    if (!adminAccountRes.data)
                        throw new Error("Admin account not found");
                    const adminAccountData = adminAccountRes.data.data;
                    const ref = `Prime-Finance-${(0, generateRef_1.generateRandomString)(9)}`;
                    // Add overdue fee before repayment attempt
                    yield addOnePercentToOverdueLoan(loan);
                    const deductionAmount = userBalance >= loan.outstanding ? loan.outstanding : userBalance;
                    const remainingOutstanding = loan.outstanding - deductionAmount;
                    if (deductionAmount > 0) {
                        const transferBody = {
                            fromAccount: userAccountData.accountNo,
                            uniqueSenderAccountId: userAccountData.accountId,
                            fromClientId: userAccountData.clientId,
                            fromClient: userAccountData.client,
                            fromSavingsId: userAccountData.accountId,
                            toClientId: adminAccountData.clientId,
                            toClient: adminAccountData.client,
                            toSavingsId: adminAccountData.accountId,
                            toSession: adminAccountData.accountId,
                            toAccount: adminAccountData.accountNo,
                            toBank: "999999",
                            signature: js_sha512_1.sha512.hex(`${userAccountData.accountNo}${adminAccountData.accountNo}`),
                            amount: deductionAmount,
                            remark: "Loan Repayment",
                            transferType: "intra",
                            reference: ref
                        };
                        const transferRes = yield (0, httpClient_1.httpClient)("/wallet2/transfer", "POST", transferBody);
                        const transactionStatus = ((_a = transferRes.data) === null || _a === void 0 ? void 0 : _a.status) === "00" ? "success" : "failed";
                        if (transferRes.data) {
                            yield updateLoan(loan._id, {
                                loan_payment_status: remainingOutstanding <= 0 ? "complete" : "in-progress",
                                outstanding: remainingOutstanding,
                                repayment_history: [
                                    ...(loan.repayment_history || []),
                                    { amount: deductionAmount, outstanding: remainingOutstanding, action: "repayment", date: new Date().toISOString() }
                                ]
                            });
                            yield update(user._id, "user_metadata.wallet", String(userBalance - deductionAmount));
                            yield createTransaction({
                                name: "Loan Repayment",
                                category: "debit",
                                type: "loan",
                                user: user._id,
                                details: "Loan mandatory repayment",
                                transaction_number: ref,
                                amount: deductionAmount,
                                bank: "Prime Finance - VFD",
                                receiver: adminAccountData.accountNo,
                                account_number: adminAccountData.accountNo,
                                outstanding: remainingOutstanding,
                                session_id: ref,
                                status: transactionStatus,
                                message: ((_b = transferRes.data) === null || _b === void 0 ? void 0 : _b.status) || "Unknown",
                            });
                            console.log(`Loan ${loan._id}: Repayment of ${deductionAmount} successful.`);
                        }
                    }
                }
                catch (loanError) {
                    console.error(`Loan ${loan._id}: Skipping due to error -`, loanError);
                }
            }
        }
        catch (error) {
            console.error("Error checking overdue loans:", error);
        }
    });
}
function addOnePercentToOverdueLoan(loan) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield mongoose_1.default.startSession();
        try {
            yield session.withTransaction(() => __awaiter(this, void 0, void 0, function* () {
                const today = new Date().toISOString().split("T")[0]; // Get YYYY-MM-DD format
                const lastInterestDate = loan.lastInterestAdded ? loan.lastInterestAdded.split("T")[0] : null;
                if (lastInterestDate === today) {
                    console.log(`Loan ${loan._id}: Interest already added today.`);
                    return;
                }
                const overdueFee = Number(loan.amount) * 0.01;
                const newOutstanding = Number(loan.outstanding) + overdueFee;
                yield updateLoan(loan._id, {
                    outstanding: newOutstanding,
                    lastInterestAdded: today, // Update last interest added date
                    repayment_history: [
                        ...(loan.repayment_history || []),
                        { amount: overdueFee, outstanding: newOutstanding, action: "overdue_fee", date: new Date().toISOString() }
                    ]
                });
                const user = yield find({ _id: loan.userId }, "one");
                if (user && !Array.isArray(user))
                    yield sendEmail(user.email, 'Your Loan is Overdue', `Dear ${user.user_metadata.first_name}, Your loan payment of ${loan.outstanding} was due on ${loan.repayment_date}. Please make the payment immediately to avoid any futher late fees and penalties.`);
                console.log(`Loan ${loan._id}: 1% overdue fee added successfully.`);
            }));
        }
        catch (error) {
            console.error(`Loan ${loan._id}: Error adding overdue fee -`, error);
        }
        finally {
            yield session.endSession();
        }
    });
}
const sendMessageForLoan = () => __awaiter(void 0, void 0, void 0, function* () {
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
    const dueLoans = yield findLoan({
        repayment_date: todayStr,
        outstanding: { $gt: 0 }, // Condition for outstanding > 0
        status: "accepted"
    }, "many");
    if (dueLoans && Array.isArray(dueLoans) && dueLoans.length > 0) {
        console.log("In Upcoming Loans");
        for (const loan of dueLoans) {
            const user = yield find({ _id: loan.userId }, "one");
            if (user && !Array.isArray(user))
                yield sendEmail(user.email, 'Your Loan is Due Today', `Dear ${user.user_metadata.first_name}, Your loan payment of ${loan.outstanding} is due Today. Please make the payment immediately to avoid any futher late fees and penalties.`);
        }
    }
    const upcomingLoans = yield findLoan({
        repayment_date: tomorrowStr,
        outstanding: { $gt: 0 }, // Condition for outstanding > 0
        status: "accepted"
    }, "many");
    if (upcomingLoans && Array.isArray(upcomingLoans) && upcomingLoans.length > 0) {
        console.log("In Upcoming Loans");
        for (const loan of upcomingLoans) {
            const user = yield find({ _id: loan.userId }, "one");
            if (user && !Array.isArray(user))
                yield sendEmail(user.email, 'Your Loan will be Due Tomorrow', `Dear ${user.user_metadata.first_name}, Your loan payment of ${loan.outstanding} will be due tomorrow. Please make the payment immediately to avoid any futher late fees and penalties.`);
        }
    }
});
exports.sendMessageForLoan = sendMessageForLoan;
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
