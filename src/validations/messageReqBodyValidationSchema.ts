import Joi from "joi";

// Joi schema for CREATEMESSAGE
const createMessageSchema = Joi.object({
  name: Joi.string().required(),
  user: Joi.string().uuid().required(),
  message: Joi.string().required(),
  type: Joi.string().valid("loan").required(),
  status: Joi.string().valid("unread", "read").required()
});

// Joi schema for UPDATEMESSAGE
const updateMessageSchema = Joi.object({
  name: Joi.string().optional(),
  message: Joi.string().optional(),
  status: Joi.string().valid("unread", "read").optional()
});

module.exports = { createMessageSchema, updateMessageSchema };
