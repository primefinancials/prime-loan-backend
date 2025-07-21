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
  pin: Joi.string().length(4).pattern(/^\d+$/).required().messages({
    "string.empty": "PIN is required",
    "string.length": "PIN must be exactly 4 digits",
    "string.pattern.base": "PIN must contain only digits",
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
  fromBvn: Joi.string().required().messages({
    "string.empty": "From BVN is required",
  }),
  toClientId: Joi.string(),
  toClient: Joi.string().required().messages({
    "string.empty": "To Client is required",
  }),
  toSession: Joi.string().required().messages({
    "string.empty": "To Session is required",
  }),
  toBvn: Joi.string().required().messages({
    "string.empty": "To BVN is required",
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
  reference: Joi.string().required(),
  amount: Joi.number().required(),
  account_number: Joi.string().required(),
  originator_account_number: Joi.string().required(),
  originator_account_name: Joi.string().required(),
  originator_bank: Joi.string().required(),
  initialCreditRequest: Joi.boolean(),
  originator_narration: Joi.string().required(),
  timestamp: Joi.string().required(),
  session_id: Joi.string().required(),
});

export const loginReqBodySchema = Joi.object({
    password: Joi.string().min(6).required(),
    email: Joi.string().email(),
});

export const activateUserReqBodySchema = Joi.object({
  status: Joi.string().allow("active", "inactive").required(),
  userId: Joi.string().required(),
});

export const activateAdminReqBodySchema = Joi.object({
  status: Joi.string().allow("active", "inactive").required(),
  adminId: Joi.string().required(),
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

export const linkedAccountSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  ref: Joi.string().required(),
  bank: Joi.string().required(),
  account_number: Joi.string().required(),
});

export const initiateAccountLinking = Joi.object({
  customer: Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
  }).required(),
  meta: Joi.object({
    ref: Joi.string().required(),
  }).required(),
  scope: Joi.string().valid("auth").required(),
  redirect_url: Joi.string().uri().required(),
});

export const confirmAccountLinking = Joi.object({
  code: Joi.string().required(),
});
