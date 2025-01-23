"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePasswordSchema = exports.updateUserSchema = exports.loginReqBodySchema = exports.walletAlertsSchema = exports.transferSchema = exports.createAdminAccountSchema = exports.createClientAccountSchema = void 0;
const joi_1 = __importDefault(require("joi"));
const date_1 = __importDefault(require("@joi/date"));
joi_1.default.extend(date_1.default);
exports.createClientAccountSchema = joi_1.default.object({
    email: joi_1.default.string().email().required().messages({
        "string.empty": "Email is required",
        "string.email": "Invalid email format",
    }),
    name: joi_1.default.string().required().messages({
        "string.empty": "Name is required",
    }),
    surname: joi_1.default.string().required().messages({
        "string.empty": "Surname is required",
    }),
    password: joi_1.default.string().min(6).required().messages({
        "string.empty": "Password is required",
        "string.min": "Password must be at least 6 characters long",
    }),
    phone: joi_1.default.string().pattern(/^\d+$/).required().messages({
        "string.empty": "Phone number is required",
        "string.pattern.base": "Phone number must contain only digits",
    }),
    bvn: joi_1.default.string().length(11).pattern(/^\d+$/).required().messages({
        "string.empty": "BVN is required",
        "string.length": "BVN must be exactly 11 digits",
        "string.pattern.base": "BVN must contain only digits",
    }),
    nin: joi_1.default.string().length(11).pattern(/^\d+$/).required().messages({
        "string.empty": "NIN is required",
        "string.length": "NIN must be exactly 11 digits",
        "string.pattern.base": "NIN must contain only digits",
    }),
    dob: joi_1.default.string().pattern(/^([0-2][0-9]|3[0-1])\/(0[1-9]|1[0-2])\/\d{4}$/).required().messages({
        "string.pattern.base": "Date of Birth must be in the format dd/mm/yyyy",
        "any.required": "Date of Birth is required",
    })
});
exports.createAdminAccountSchema = joi_1.default.object({
    email: joi_1.default.string().email().required().messages({
        "string.empty": "Email is required",
        "string.email": "Invalid email format",
    }),
    name: joi_1.default.string().required().messages({
        "string.empty": "Name is required",
    }),
    surname: joi_1.default.string().required().messages({
        "string.empty": "Surname is required",
    }),
    password: joi_1.default.string().min(6).required().messages({
        "string.empty": "Password is required",
        "string.min": "Password must be at least 6 characters long",
    }),
    phone: joi_1.default.string().pattern(/^\d+$/).required().messages({
        "string.empty": "Phone number is required",
        "string.pattern.base": "Phone number must contain only digits",
    }),
    dob: joi_1.default.string().pattern(/^([0-2][0-9]|3[0-1])\/(0[1-9]|1[0-2])\/\d{4}$/).required().messages({
        "string.pattern.base": "Date of Birth must be in the format dd/mm/yyyy",
        "any.required": "Date of Birth is required",
    })
});
exports.transferSchema = joi_1.default.object({
    fromAccount: joi_1.default.string().required().messages({
        "string.empty": "From Account is required",
    }),
    fromClientId: joi_1.default.string().required().messages({
        "string.empty": "From Client ID is required",
    }),
    fromClient: joi_1.default.string().required().messages({
        "string.empty": "From Client is required",
    }),
    fromSavingsId: joi_1.default.string().required().messages({
        "string.empty": "From Savings ID is required",
    }),
    fromBvn: joi_1.default.string().length(11).pattern(/^\d+$/).required().messages({
        "string.empty": "From BVN is required",
        "string.length": "From BVN must be exactly 11 digits",
        "string.pattern.base": "From BVN must contain only digits",
    }),
    toClient: joi_1.default.string().required().messages({
        "string.empty": "To Client is required",
    }),
    toSession: joi_1.default.string().required().messages({
        "string.empty": "To Session is required",
    }),
    toBvn: joi_1.default.string().length(11).pattern(/^\d+$/).required().messages({
        "string.empty": "To BVN is required",
        "string.length": "To BVN must be exactly 11 digits",
        "string.pattern.base": "To BVN must contain only digits",
    }),
    toKyc: joi_1.default.string().required().messages({
        "string.empty": "To KYC is required",
    }),
    bank: joi_1.default.string().required().messages({
        "string.empty": "Bank is required",
    }),
    toAccount: joi_1.default.string().required().messages({
        "string.empty": "To Account is required",
    }),
    toBank: joi_1.default.string().required().messages({
        "string.empty": "To Bank is required",
    }),
    toSavingsId: joi_1.default.string().required().messages({
        "string.empty": "To Savings ID is required",
    }),
    amount: joi_1.default.string().required().messages({
        "string.empty": "Amount is required",
    }),
    remark: joi_1.default.string(),
    reference: joi_1.default.string().required().messages({
        "string.empty": "Reference is required",
    }),
});
// Joi validation schema for wallet alerts
exports.walletAlertsSchema = joi_1.default.object({
    reference: joi_1.default.string().required().messages({
        'string.base': '"reference" should be a string',
        'string.empty': '"reference" cannot be empty',
        'any.required': '"reference" is required',
    }),
    amount: joi_1.default.number().required().messages({
        'number.base': '"amount" should be a number',
        'any.required': '"amount" is required',
    }),
    account_number: joi_1.default.string().required().messages({
        'string.base': '"account_number" should be a string',
        'string.empty': '"account_number" cannot be empty',
        'any.required': '"account_number" is required',
    }),
    originator_account_number: joi_1.default.string().required().messages({
        'string.base': '"originator_account_number" should be a string',
        'string.empty': '"originator_account_number" cannot be empty',
        'any.required': '"originator_account_number" is required',
    }),
    originator_account_name: joi_1.default.string().required().messages({
        'string.base': '"originator_account_name" should be a string',
        'string.empty': '"originator_account_name" cannot be empty',
        'any.required': '"originator_account_name" is required',
    }),
    originator_bank: joi_1.default.string().required().messages({
        'string.base': '"originator_bank" should be a string',
        'string.empty': '"originator_bank" cannot be empty',
        'any.required': '"originator_bank" is required',
    }),
    bank: joi_1.default.string().required().messages({
        'string.base': '"bank" should be a string',
        'string.empty': '"bank" cannot be empty',
        'any.required': '"bank" is required',
    }),
    originator_narration: joi_1.default.string().required().messages({
        'string.base': '"originator_narration" should be a string',
        'string.empty': '"originator_narration" cannot be empty',
        'any.required': '"originator_narration" is required',
    }),
    timestamp: joi_1.default.string().isoDate().required().messages({
        'string.base': '"timestamp" should be a string',
        'string.empty': '"timestamp" cannot be empty',
        'string.isoDate': '"timestamp" must be a valid ISO date',
        'any.required': '"timestamp" is required',
    }),
    session_id: joi_1.default.string().required().messages({
        'string.base': '"session_id" should be a string',
        'string.empty': '"session_id" cannot be empty',
        'any.required': '"session_id" is required',
    }),
});
exports.loginReqBodySchema = joi_1.default.object({
    password: joi_1.default.string().min(8).required(),
    email: joi_1.default.string().email(),
});
exports.updateUserSchema = joi_1.default.object({
    bvn: joi_1.default.string().optional(),
    nin: joi_1.default.string().optional(),
    sub: joi_1.default.string().optional(),
    email: joi_1.default.string().email().optional(),
    phone: joi_1.default.string().optional(),
    surname: joi_1.default.string().optional(),
    first_name: joi_1.default.string().optional(),
    dateOfBirth: joi_1.default.string().optional(),
    email_verified: joi_1.default.boolean().optional(),
    phone_verified: joi_1.default.boolean().optional(),
    accountNo: joi_1.default.string().optional(),
    address: joi_1.default.string().optional(),
    wallet: joi_1.default.string().optional(),
    pin: joi_1.default.string().optional(),
    profile_photo: joi_1.default.string().optional(),
    file: joi_1.default.string().optional(),
    types: joi_1.default.string().optional(),
    verified_address: joi_1.default.string()
        .valid("verified", "pending", "unverified")
        .optional(),
});
exports.changePasswordSchema = joi_1.default.object({
    oldPassword: joi_1.default.string().required().messages({
        "string.empty": "Old password is required",
    }),
    newPassword: joi_1.default.string().min(8).required().messages({
        "string.empty": "New password is required",
        "string.min": "New password must be at least 8 characters long",
    }),
});
