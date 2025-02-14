"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loanTransactionStatusSchema = exports.rejectLoanSchema = exports.updateLoanAmountSchema = exports.repayLoanSchema = exports.createClientLoanSchema = exports.createAndDisburseLoanSchema = void 0;
const joi_1 = __importDefault(require("joi"));
exports.createAndDisburseLoanSchema = joi_1.default.object({
    amount: joi_1.default.string().required().label("Loan amount"),
    duration: joi_1.default.string().required().label("Loan duration (months)"),
    transactionId: joi_1.default.string().required().label("Transaction ID"),
    userId: joi_1.default.string().required().label("User ID"),
});
exports.createClientLoanSchema = joi_1.default.object({
    first_name: joi_1.default.string().required().label("First Name"),
    last_name: joi_1.default.string().required().label("Last Name"),
    dob: joi_1.default.string().required().label("Date of Birth"),
    doi: joi_1.default.string().label("Date of Incorperation"),
    nin: joi_1.default.string().length(11).required().label("National Identification Number"),
    tin: joi_1.default.string().label("Tax Identification Number"),
    email: joi_1.default.string().email().required().label("Email"),
    bvn: joi_1.default.string().length(11).required().label("BVN"),
    phone: joi_1.default.string().required().label("Phone Number"),
    address: joi_1.default.string().required().label("Address"),
    company: joi_1.default.string().required().label("Company"),
    company_address: joi_1.default.string().required().label("Company Address"),
    annual_income: joi_1.default.string().required().label("Annual Income"),
    guarantor_1_name: joi_1.default.string().required().label("Guarantor 1 Name"),
    guarantor_1_phone: joi_1.default.string().required().label("Guarantor 1 Phone"),
    guarantor_2_name: joi_1.default.string().optional().label("Guarantor 2 Name"),
    guarantor_2_phone: joi_1.default.string().optional().label("Guarantor 2 Phone"),
    amount: joi_1.default.string().required().label("Loan Amount"),
    reason: joi_1.default.string().required().label("Loan Reason"),
    base64Image: joi_1.default.string().optional().label("Image"),
    outstanding: joi_1.default.string().optional().label("Outstanding Amount"),
    category: joi_1.default.string().required().label("Loan Category"),
    type: joi_1.default.string().required().label("Loan Type"),
    status: joi_1.default.string().required().label("Loan Status"),
    duration: joi_1.default.string().required().label("Duration"),
    repayment_amount: joi_1.default.string().required().label("Repayment Amount"),
    percentage: joi_1.default.string().required().label("Percentage"),
    loan_date: joi_1.default.string().required().label("Loan Date"),
    repayment_date: joi_1.default.string().required().label("Repayment Date"),
    acknowledgment: joi_1.default.boolean().required().label("Acknowledgment"),
});
exports.repayLoanSchema = joi_1.default.object({
    transactionId: joi_1.default.string().required().label("Transaction ID"),
    amount: joi_1.default.string().required().label("Amount"),
    outstanding: joi_1.default.string().required().label("Outstanding Amount"),
});
exports.updateLoanAmountSchema = joi_1.default.object({
    transactionId: joi_1.default.string().required().label("Transaction ID"),
    amount: joi_1.default.string().required().label("Amount"),
    userId: joi_1.default.string().required().label("User ID"),
});
exports.rejectLoanSchema = joi_1.default.object({
    transactionId: joi_1.default.string().required().label("Transaction ID"),
});
exports.loanTransactionStatusSchema = joi_1.default.object({
    transactionId: joi_1.default.string().required().label("Transaction ID"),
});
