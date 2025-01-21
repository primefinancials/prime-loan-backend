import Joi from "joi";

// Joi validation schemas
export const livenessCheckSchema = Joi.object({
  base64Image: Joi.string().required().label("Base64 Image").messages({
    "any.required": "Base64 Image is required",
    "string.empty": "Base64 Image cannot be empty",
  }),
});

export const ninVerificationSchema = Joi.object({
  idNumber: Joi.string().required().label("ID Number").messages({
    "any.required": "ID Number is required",
    "string.empty": "ID Number cannot be empty",
  }),
});
