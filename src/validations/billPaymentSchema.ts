import Joi from "joi";

/**
 * -----------------------------
 * BILL PAYMENT VALIDATION
 * - Generic `billPaymentSchema` matches BillPaymentService.initiateBillPayment
 * - extras enforced conditionally based on serviceType
 * -----------------------------
 */
export const billPaymentSchema = Joi.object({
  userId: Joi.string().required(),
  amount: Joi.number().positive().required().messages({
    "number.base": "amount must be a number",
    "number.positive": "amount must be greater than 0",
  }),
  serviceType: Joi.string()
    .valid("airtime", "data", "tv", "power", "betting", "internet", "waec", "jamb")
    .required(),
  serviceId: Joi.string().required(), // provider/service-specific id; may be required depending on serviceType (enforced in extras switch)
  customerReference: Joi.string().required().messages({
    "string.empty": "customerReference (target account/phone/meter) is required",
  }),
  itemCode: Joi.string().required(), // may be required depending on
  meterType: Joi.string(), // 01 = prepaid, 02 = postpaid
  idempotencyKey: Joi.string().optional(),
});