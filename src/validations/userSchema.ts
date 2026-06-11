import Joi from "joi";

export const createClientAccountSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  surname: Joi.string().required(),
  password: Joi.string().min(6).required(),
  phone: Joi.string()
    .pattern(/^(\+234|234|0)[789][01]\d{8}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone must be a valid Nigerian number",
    }),
  bvn: Joi.string().length(11).pattern(/^\d+$/).required(),
  pin: Joi.string().length(4).pattern(/^\d+$/).required(),
  nin: Joi.string().length(11).pattern(/^\d+$/).required(),
  address: Joi.string().required(),
  dob: Joi.string()
    .pattern(/^([0-2][0-9]|3[0-1])\/(0[1-9]|1[0-2])\/\d{4}$/)
    .required()
    .messages({
      "string.pattern.base": "Date of Birth must be dd/mm/yyyy",
    }),
  referralCode: Joi.string().optional().allow('').max(20),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const updateUserSchema = Joi.object({
  field: Joi.string()
    .valid(
      "user_metadata.phone",
      "user_metadata.address",
      "user_metadata.profile_photo",
      "user_metadata.first_name",
      "user_metadata.surname"
    )
    .required(),
  value: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
});

export const initiateResetSchema = Joi.object({
  email: Joi.string().email().required(),
  type: Joi.string().valid("password", "pin").required(),
});

export const validateResetSchema = Joi.object({
  email: Joi.string().email().required(),
  pin: Joi.string().length(6).required(),
});

export const updatePasswordOrPinSchema = Joi.object({
  email: Joi.string().email().required(),
  newPassword: Joi.string().min(8),
  newPin: Joi.string().length(4).pattern(/^\d+$/),
}).or("newPassword", "newPin");

export const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

export const verifyPinSchema = Joi.object({
  pin: Joi.string().length(4).pattern(/^\d+$/).required(),
});
