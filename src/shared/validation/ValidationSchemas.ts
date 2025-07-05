import Joi from 'joi';

export const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  surname: Joi.string().required(),
  password: Joi.string().min(6).required(),
  phone: Joi.string().pattern(/^\d+$/).required(),
  bvn: Joi.string().length(11).pattern(/^\d+$/).required(),
  nin: Joi.string().length(11).pattern(/^\d+$/).required(),
  dob: Joi.string().pattern(/^([0-2][0-9]|3[0-1])\/(0[1-9]|1[0-2])\/\d{4}$/).required(),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

export const createLoanSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  dateOfBirth: Joi.string().required(),
  bvn: Joi.string().length(11).required(),
  nin: Joi.string().length(11).required(),
  address: Joi.string().required(),
  company: Joi.string().optional(),
  companyAddress: Joi.string().optional(),
  annualIncome: Joi.string().optional(),
  guarantor1Name: Joi.string().optional(),
  guarantor1Phone: Joi.string().optional(),
  guarantor2Name: Joi.string().optional(),
  guarantor2Phone: Joi.string().optional(),
  amount: Joi.number().positive().required(),
  reason: Joi.string().required(),
  category: Joi.string().valid('personal', 'working').required(),
  type: Joi.string().valid('request', 'repay').required(),
  duration: Joi.number().positive().required(),
  repaymentAmount: Joi.number().positive().required(),
  percentage: Joi.number().min(0).required(),
  loanDate: Joi.string().required(),
  repaymentDate: Joi.string().required(),
  base64Image: Joi.string().required(),
  acknowledgment: Joi.boolean().required(),
  debitAccount: Joi.string().optional(),
});

export const disburseLoanSchema = Joi.object({
  loanId: Joi.string().required(),
  userId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  duration: Joi.number().positive().required(),
});