import Joi from "joi";

// Joi validation schema for payBill
export const payBillSchema = Joi.object({
  name: Joi.string().required().messages({
    'string.base': '"name" should be a string',
    'string.empty': '"name" cannot be empty',
    'any.required': '"name" is required',
  }),
  category: Joi.string().required().messages({
    'string.base': '"category" should be a string',
    'string.empty': '"category" cannot be empty',
    'any.required': '"category" is required',
  }),
  details: Joi.string().required().messages({
    'string.base': '"details" should be a string',
    'string.empty': '"details" cannot be empty',
    'any.required': '"details" is required',
  }),
  customerId: Joi.string().required().messages({
    'string.base': '"customerId" should be a string',
    'string.empty': '"customerId" cannot be empty',
    'any.required': '"customerId" is required',
  }),
  amount: Joi.number().required().messages({
    'number.base': '"amount" should be a number',
    'any.required': '"amount" is required',
  }),
  reference: Joi.string().required().messages({
    'string.base': '"reference" should be a string',
    'string.empty': '"reference" cannot be empty',
    'any.required': '"reference" is required',
  }),
  bank: Joi.string().required().messages({
    'string.base': '"bank" should be a string',
    'string.empty': '"bank" cannot be empty',
    'any.required': '"bank" is required',
  }),
  division: Joi.string().required().messages({
    'string.base': '"division" should be a string',
    'string.empty': '"division" cannot be empty',
    'any.required': '"division" is required',
  }),
  paymentItem: Joi.string().required().messages({
    'string.base': '"paymentItem" should be a string',
    'string.empty': '"paymentItem" cannot be empty',
    'any.required': '"paymentItem" is required',
  }),
  productId: Joi.string().required().messages({
    'string.base': '"productId" should be a string',
    'string.empty': '"productId" cannot be empty',
    'any.required': '"productId" is required',
  }),
  billerId: Joi.string().required().messages({
    'string.base': '"billerId" should be a string',
    'string.empty': '"billerId" cannot be empty',
    'any.required': '"billerId" is required',
  }),
  phoneNumber: Joi.string()
    .optional()
    .allow(null)
    .messages({
      'string.base': '"phoneNumber" should be a string',
    }),
});
