import Joi from 'joi';
import JoiDate from "@joi/date";

Joi.extend(JoiDate)

export const createClientAccountSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Invalid email format",
  }),
  name: Joi.string().required().messages({
    "string.empty": "Name is required",
  }),
  surname: Joi.string().required().messages({
    "string.empty": "Surname is required",
  }),
  password: Joi.string().min(6).required().messages({
    "string.empty": "Password is required",
    "string.min": "Password must be at least 6 characters long",
  }),
  phone: Joi.string().pattern(/^\d+$/).required().messages({
    "string.empty": "Phone number is required",
    "string.pattern.base": "Phone number must contain only digits",
  }),
  bvn: Joi.string().length(11).pattern(/^\d+$/).required().messages({
    "string.empty": "BVN is required",
    "string.length": "BVN must be exactly 11 digits",
    "string.pattern.base": "BVN must contain only digits",
  }),
  nin: Joi.string().length(11).pattern(/^\d+$/).required().messages({
    "string.empty": "NIN is required",
    "string.length": "NIN must be exactly 11 digits",
    "string.pattern.base": "NIN must contain only digits",
  }),
  dob: Joi.string().pattern(/^([0-2][0-9]|3[0-1])\/(0[1-9]|1[0-2])\/\d{4}$/).required().messages({
    "string.pattern.base": "Date of Birth must be in the format dd/mm/yyyy",
    "any.required": "Date of Birth is required",
  })
});

export const createAdminAccountSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Invalid email format",
  }),
  name: Joi.string().required().messages({
    "string.empty": "Name is required",
  }),
  surname: Joi.string().required().messages({
    "string.empty": "Surname is required",
  }),
  password: Joi.string().min(6).required().messages({
    "string.empty": "Password is required",
    "string.min": "Password must be at least 6 characters long",
  }),
  phone: Joi.string().pattern(/^\d+$/).required().messages({
    "string.empty": "Phone number is required",
    "string.pattern.base": "Phone number must contain only digits",
  })
});

export const transferSchema = Joi.object({
    fromAccount: Joi.string().required().messages({
      "string.empty": "From Account is required",
    }),
    fromClientId: Joi.string().required().messages({
      "string.empty": "From Client ID is required",
    }),
    fromClient: Joi.string().required().messages({
      "string.empty": "From Client is required",
    }),
    fromSavingsId: Joi.string().required().messages({
      "string.empty": "From Savings ID is required",
    }),
    fromBvn: Joi.string().length(11).pattern(/^\d+$/).required().messages({
      "string.empty": "From BVN is required",
      "string.length": "From BVN must be exactly 11 digits",
      "string.pattern.base": "From BVN must contain only digits",
    }),
    toClient: Joi.string().required().messages({
      "string.empty": "To Client is required",
    }),
    toSession: Joi.string().required().messages({
      "string.empty": "To Session is required",
    }),
    toBvn: Joi.string().length(11).pattern(/^\d+$/).required().messages({
      "string.empty": "To BVN is required",
      "string.length": "To BVN must be exactly 11 digits",
      "string.pattern.base": "To BVN must contain only digits",
    }),
    toKyc: Joi.string().required().messages({
      "string.empty": "To KYC is required",
    }),
    bank: Joi.string().required().messages({
      "string.empty": "Bank is required",
    }),
    toAccount: Joi.string().required().messages({
      "string.empty": "To Account is required",
    }),
    toBank: Joi.string().required().messages({
      "string.empty": "To Bank is required",
    }),
    toSavingsId: Joi.string().required().messages({
      "string.empty": "To Savings ID is required",
    }),
    amount: Joi.string().required().messages({
      "string.empty": "Amount is required",
    }),
    remark: Joi.string(),
    reference: Joi.string().required().messages({
      "string.empty": "Reference is required",
    }),
});

// Joi validation schema for wallet alerts
export const walletAlertsSchema = Joi.object({
  reference: Joi.string().required().messages({
    'string.base': '"reference" should be a string',
    'string.empty': '"reference" cannot be empty',
    'any.required': '"reference" is required',
  }),
  amount: Joi.number().required().messages({
    'number.base': '"amount" should be a number',
    'any.required': '"amount" is required',
  }),
  account_number: Joi.string().required().messages({
    'string.base': '"account_number" should be a string',
    'string.empty': '"account_number" cannot be empty',
    'any.required': '"account_number" is required',
  }),
  originator_account_number: Joi.string().required().messages({
    'string.base': '"originator_account_number" should be a string',
    'string.empty': '"originator_account_number" cannot be empty',
    'any.required': '"originator_account_number" is required',
  }),
  originator_account_name: Joi.string().required().messages({
    'string.base': '"originator_account_name" should be a string',
    'string.empty': '"originator_account_name" cannot be empty',
    'any.required': '"originator_account_name" is required',
  }),
  originator_bank: Joi.string().required().messages({
    'string.base': '"originator_bank" should be a string',
    'string.empty': '"originator_bank" cannot be empty',
    'any.required': '"originator_bank" is required',
  }),
  bank: Joi.string().required().messages({
    'string.base': '"bank" should be a string',
    'string.empty': '"bank" cannot be empty',
    'any.required': '"bank" is required',
  }),
  originator_narration: Joi.string().required().messages({
    'string.base': '"originator_narration" should be a string',
    'string.empty': '"originator_narration" cannot be empty',
    'any.required': '"originator_narration" is required',
  }),
  timestamp: Joi.string().isoDate().required().messages({
    'string.base': '"timestamp" should be a string',
    'string.empty': '"timestamp" cannot be empty',
    'string.isoDate': '"timestamp" must be a valid ISO date',
    'any.required': '"timestamp" is required',
  }),
  session_id: Joi.string().required().messages({
    'string.base': '"session_id" should be a string',
    'string.empty': '"session_id" cannot be empty',
    'any.required': '"session_id" is required',
  }),
});

export const loginReqBodySchema = Joi.object({
    password: Joi.string().min(8).required(),
    email: Joi.string().email(),
});

export const updateUserSchema = Joi.object({
  data: Joi.string().required(),
  updateField: Joi.string().required(),
});

export const changePasswordSchema = Joi.object({
    oldPassword: Joi.string().required().messages({
      "string.empty": "Old password is required",
    }),
    newPassword: Joi.string().min(8).required().messages({
      "string.empty": "New password is required",
      "string.min": "New password must be at least 8 characters long",
    }),
});
