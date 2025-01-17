"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ninVerificationSchema = exports.livenessCheckSchema = void 0;
const joi_1 = __importDefault(require("joi"));
// Joi validation schemas
exports.livenessCheckSchema = joi_1.default.object({
    base64Image: joi_1.default.string().required().label("Base64 Image").messages({
        "any.required": "Base64 Image is required",
        "string.empty": "Base64 Image cannot be empty",
    }),
});
exports.ninVerificationSchema = joi_1.default.object({
    idNumber: joi_1.default.string().required().label("ID Number").messages({
        "any.required": "ID Number is required",
        "string.empty": "ID Number cannot be empty",
    }),
});
