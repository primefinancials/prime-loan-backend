"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.payBillSchema = void 0;
const joi_1 = __importDefault(require("joi"));
// Joi validation schema for payBill
exports.payBillSchema = joi_1.default.object({
    name: joi_1.default.string().required().messages({
        'string.base': '"name" should be a string',
        'string.empty': '"name" cannot be empty',
        'any.required': '"name" is required',
    }),
    category: joi_1.default.string().required().messages({
        'string.base': '"category" should be a string',
        'string.empty': '"category" cannot be empty',
        'any.required': '"category" is required',
    }),
    details: joi_1.default.string().required().messages({
        'string.base': '"details" should be a string',
        'string.empty': '"details" cannot be empty',
        'any.required': '"details" is required',
    }),
    customerId: joi_1.default.string().required().messages({
        'string.base': '"customerId" should be a string',
        'string.empty': '"customerId" cannot be empty',
        'any.required': '"customerId" is required',
    }),
    amount: joi_1.default.number().required().messages({
        'number.base': '"amount" should be a number',
        'any.required': '"amount" is required',
    }),
    reference: joi_1.default.string().required().messages({
        'string.base': '"reference" should be a string',
        'string.empty': '"reference" cannot be empty',
        'any.required': '"reference" is required',
    }),
    bank: joi_1.default.string().required().messages({
        'string.base': '"bank" should be a string',
        'string.empty': '"bank" cannot be empty',
        'any.required': '"bank" is required',
    }),
    division: joi_1.default.string().required().messages({
        'string.base': '"division" should be a string',
        'string.empty': '"division" cannot be empty',
        'any.required': '"division" is required',
    }),
    paymentItem: joi_1.default.string().required().messages({
        'string.base': '"paymentItem" should be a string',
        'string.empty': '"paymentItem" cannot be empty',
        'any.required': '"paymentItem" is required',
    }),
    productId: joi_1.default.string().required().messages({
        'string.base': '"productId" should be a string',
        'string.empty': '"productId" cannot be empty',
        'any.required': '"productId" is required',
    }),
    billerId: joi_1.default.string().required().messages({
        'string.base': '"billerId" should be a string',
        'string.empty': '"billerId" cannot be empty',
        'any.required': '"billerId" is required',
    }),
    phoneNumber: joi_1.default.string()
        .optional()
        .allow(null)
        .messages({
        'string.base': '"phoneNumber" should be a string',
    }),
});
