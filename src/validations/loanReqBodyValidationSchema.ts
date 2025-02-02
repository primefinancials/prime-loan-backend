import Joi from "joi";

export const createAndDisburseLoanSchema = Joi.object({
  amount: Joi.number().required().positive().label("Loan amount"),
  duration: Joi.number().required().positive().integer().label("Loan duration (months)"),
  transactionId: Joi.string().required().label("Transaction ID"),
});

export const createClientLoanSchema = Joi.object({
  first_name: Joi.string().required().label("First Name"),
  last_name: Joi.string().required().label("Last Name"),
  dob: Joi.string().required().label("Date of Birth"),
  nin: Joi.string().length(11).required().label("National Identification Number"),
  email: Joi.string().email().required().label("Email"),
  bvn: Joi.string().length(11).required().label("BVN"),
  phone: Joi.string().required().label("Phone Number"),
  address: Joi.string().required().label("Address"),
  company: Joi.string().required().label("Company"),
  company_address: Joi.string().required().label("Company Address"),
  annual_income: Joi.string().required().label("Annual Income"),
  guarantor_1_name: Joi.string().required().label("Guarantor 1 Name"),
  guarantor_1_phone: Joi.string().required().label("Guarantor 1 Phone"),
  guarantor_2_name: Joi.string().optional().label("Guarantor 2 Name"),
  guarantor_2_phone: Joi.string().optional().label("Guarantor 2 Phone"),
  amount: Joi.string().required().label("Loan Amount"),
  reason: Joi.string().required().label("Loan Reason"),
  base64Image: Joi.string().optional().label("Image"),
  outstanding: Joi.string().optional().label("Outstanding Amount"),
  category: Joi.string().required().label("Loan Category"),
  type: Joi.string().required().label("Loan Type"),
  status: Joi.string().required().label("Loan Status"),
  duration: Joi.string().required().label("Duration"),
  repayment_amount: Joi.string().required().label("Repayment Amount"),
  percentage: Joi.string().required().label("Percentage"),
  loan_date: Joi.string().required().label("Loan Date"),
  repayment_date: Joi.string().required().label("Repayment Date"),
  acknowledgment: Joi.boolean().required().label("Acknowledgment"),
});

export const repayLoanSchema = Joi.object({
  fromAccount: Joi.string().required().label("From Account"),
  fromClientId: Joi.string().required().label("From Client ID"),
  fromClient: Joi.string().required().label("From Client"),
  fromSavingsId: Joi.string().required().label("From Savings ID"),
  fromBvn: Joi.string().length(11).required().label("From BVN"),
  toClientId: Joi.string().required().label("To Client ID"),
  toClient: Joi.string().required().label("To Client"),
  toSavingsId: Joi.string().required().label("To Savings ID"),
  toSession: Joi.string().required().label("To Session"),
  toBvn: Joi.string().length(11).required().label("To BVN"),
  toAccount: Joi.string().required().label("To Account"),
  toBank: Joi.string().required().label("To Bank"),
  signature: Joi.string().required().label("Signature"),
  amount: Joi.number().positive().required().label("Amount"),
  remark: Joi.string().required().label("Remark"),
  reference: Joi.string().required().label("Reference"),
  userId: Joi.string().required().label("User ID"),
  outstanding: Joi.number().required().positive().label("Outstanding Amount"),
});

export const rejectLoanSchema = Joi.object({
  transactionId: Joi.string().required().label("Transaction ID"),
});

export const loanTransactionStatusSchema = Joi.object({
  transactionId: Joi.string().required().label("Transaction ID"),
});
