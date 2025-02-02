"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loanTransactionStatusSchema = exports.rejectLoanSchema = exports.repayLoanSchema = exports.createClientLoanSchema = exports.createAndDisburseLoanSchema = void 0;
const joi_1 = __importDefault(require("joi"));
exports.createAndDisburseLoanSchema = joi_1.default.object({
    amount: joi_1.default.string().required().label("Loan amount"),
    duration: joi_1.default.string().required().label("Loan duration (months)"),
    transactionId: joi_1.default.string().required().label("Transaction ID"),
});
exports.createClientLoanSchema = joi_1.default.object({
    first_name: joi_1.default.string().required().label("First Name"),
    last_name: joi_1.default.string().required().label("Last Name"),
    dob: joi_1.default.string().required().label("Date of Birth"),
    nin: joi_1.default.string().length(11).required().label("National Identification Number"),
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
    fromAccount: joi_1.default.string().required().label("From Account"),
    fromClientId: joi_1.default.string().required().label("From Client ID"),
    fromClient: joi_1.default.string().required().label("From Client"),
    fromSavingsId: joi_1.default.string().required().label("From Savings ID"),
    fromBvn: joi_1.default.string().length(11).required().label("From BVN"),
    toClientId: joi_1.default.string().required().label("To Client ID"),
    toClient: joi_1.default.string().required().label("To Client"),
    toSavingsId: joi_1.default.string().required().label("To Savings ID"),
    toSession: joi_1.default.string().required().label("To Session"),
    toBvn: joi_1.default.string().length(11).required().label("To BVN"),
    toAccount: joi_1.default.string().required().label("To Account"),
    toBank: joi_1.default.string().required().label("To Bank"),
    signature: joi_1.default.string().required().label("Signature"),
    amount: joi_1.default.string().required().label("Amount"),
    remark: joi_1.default.string().required().label("Remark"),
    reference: joi_1.default.string().required().label("Reference"),
    userId: joi_1.default.string().required().label("User ID"),
    outstanding: joi_1.default.string().required().label("Outstanding Amount"),
});
exports.rejectLoanSchema = joi_1.default.object({
    transactionId: joi_1.default.string().required().label("Transaction ID"),
});
exports.loanTransactionStatusSchema = joi_1.default.object({
    transactionId: joi_1.default.string().required().label("Transaction ID"),
});
