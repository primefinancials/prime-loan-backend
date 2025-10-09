import Joi from "joi";

/**
 * LOANS
 */
export const createClientLoanSchema = Joi.object({
  first_name: Joi.string().required(),
  last_name: Joi.string().required(),
  dob: Joi.string().required(),
  doi: Joi.string().optional(),
  nin: Joi.string().length(11).required(),
  tin: Joi.string().optional(),
  email: Joi.string().email().required(),
  bvn: Joi.string().length(11).required(),
  phone: Joi.string().required(),
  address: Joi.string().required(),
  company: Joi.string().required(),
  company_address: Joi.string().required(),
  annual_income: Joi.string().required(),
  guarantor_1_name: Joi.string().required(),
  guarantor_1_phone: Joi.string().required(),
  guarantor_2_name: Joi.string().optional(),
  guarantor_2_phone: Joi.string().optional(),
  amount: Joi.string().required(),
  reason: Joi.string().required(),
  documentType: Joi.string().required(),
  base64Image: Joi.string().required(),
  faceVideoBase64: Joi.string().required(),
  outstanding: Joi.string().optional(),
  category: Joi.string().required(),
  type: Joi.string().required(),
  status: Joi.string().required(),
  duration: Joi.string().required(),
  repayment_amount: Joi.string().required(),
  percentage: Joi.string().required(),
  loan_date: Joi.string().required(),
  repayment_date: Joi.string().required(),
  acknowledgment: Joi.boolean().required(),
});


export const repayLoanSchema = Joi.object({
  transactionId: Joi.string().required(),
  amount: Joi.string().required(),
  outstanding: Joi.string().required(),
});
