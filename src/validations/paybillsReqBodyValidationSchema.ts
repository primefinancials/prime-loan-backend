import Joi from "joi";

// Airtime
export const airtimeSchema = Joi.object({
  amount: Joi.number().positive().required(),
  mobileNumber: Joi.string().required(),
  mobileNetwork: Joi.string().required(),
  bonusType: Joi.string().optional()
});

// Data
export const dataSchema = Joi.object({
  dataPlan: Joi.string().required(),
  mobileNumber: Joi.string().required(),
  mobileNetwork: Joi.string().required(),
  amount: Joi.number().positive().required()
});

// WAEC
export const waecSchema = Joi.object({
  examType: Joi.string().required(),
  phoneNo: Joi.string().required(),
  amount: Joi.number().positive().required()
});

// TV
export const tvSchema = Joi.object({
  cableTV: Joi.string().required(),
  pkg: Joi.string().required(),
  smartCardNo: Joi.string().required(),
  phoneNo: Joi.string().required(),
  amount: Joi.number().positive().required()
});

// Power
export const powerSchema = Joi.object({
  electricCompany: Joi.string().required(),
  meterType: Joi.string().valid("01", "02").required(),
  meterNo: Joi.string().required(),
  amount: Joi.number().positive().required(),
  phoneNo: Joi.string().required()
});

// Betting
export const bettingSchema = Joi.object({
  bettingCompany: Joi.string().required(),
  customerId: Joi.string().required(),
  amount: Joi.number().positive().required()
});

// Internet
export const internetSchema = Joi.object({
  mobileNetwork: Joi.string().required(),
  dataPlan: Joi.string().required(),
  mobileNumber: Joi.string().required(),
  amount: Joi.number().positive().required()
});

// JAMB
export const jambSchema = Joi.object({
  examType: Joi.string().required(),
  phoneNo: Joi.string().required(),
  amount: Joi.number().positive().required()
});
