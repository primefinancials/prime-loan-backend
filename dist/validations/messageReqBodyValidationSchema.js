"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const joi_1 = __importDefault(require("joi"));
// Joi schema for CREATEMESSAGE
const createMessageSchema = joi_1.default.object({
    name: joi_1.default.string().required(),
    user: joi_1.default.string().uuid().required(),
    message: joi_1.default.string().required(),
    type: joi_1.default.string().valid("loan").required(),
    status: joi_1.default.string().valid("unread", "read").required()
});
// Joi schema for UPDATEMESSAGE
const updateMessageSchema = joi_1.default.object({
    name: joi_1.default.string().optional(),
    message: joi_1.default.string().optional(),
    status: joi_1.default.string().valid("unread", "read").optional()
});
module.exports = { createMessageSchema, updateMessageSchema };
