import Joi from "joi";

export const createAndDisburseLoanSchema = Joi.object({
  amount: Joi.string().required().label("Loan amount"),
  duration: Joi.string().required().label("Loan duration (months)"),
  transactionId: Joi.string().required().label("Transaction ID"),
  userId: Joi.string().required().label("User ID"),
});

export const createClientLoanSchema = Joi.object({
  first_name: Joi.string().required().label("First Name"),
  last_name: Joi.string().required().label("Last Name"),
  dob: Joi.string().required().label("Date of Birth"),
  doi: Joi.string().label("Date of Incorperation"),
  nin: Joi.string().length(11).required().label("National Identification Number"),
  tin: Joi.string().label("Tax Identification Number"),
  email: Joi.string().email().required().label("Email"),
  bvn: Joi.string().length(11).required().label("BVN"),
  phone: Joi.string().required().label("Phone Number"),
  address: Joi.string().required().label("Address"),
  // debit_account: Joi.string().required().label("Link Debit Mandate"),
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
  transactionId: Joi.string().required().label("Transaction ID"),
  amount: Joi.string().required().label("Amount"),
  outstanding: Joi.string().required().label("Outstanding Amount"),
});

export const updateLoanAmountSchema = Joi.object({
  transactionId: Joi.string().required().label("Transaction ID"),
  amount: Joi.string().required().label("Amount"),
  userId: Joi.string().required().label("User ID"),
});

export const rejectLoanSchema = Joi.object({
  transactionId: Joi.string().required().label("Transaction ID"),
  reason: Joi.string().required().label("Reason For Rejection"),
});

export const loanTransactionStatusSchema = Joi.object({
  transactionId: Joi.string().required().label("Transaction ID"),
});
