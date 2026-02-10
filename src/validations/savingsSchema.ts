import Joi from "joi";

/**
 * Create Savings Plan Validation
 * - Fixed (LOCKED): targetAmount, durationMonths
 * - Flexible: maturityDate, contribution config
 */
export const createPlanSchema = Joi.object({
  planType: Joi.string().valid("LOCKED", "FLEXIBLE").required(),
  planName: Joi.string().min(3).max(100).required(),

  // Fixed plan fields
  targetAmount: Joi.number().positive().optional(),
  durationMonths: Joi.number().integer().min(1).optional(),

  // Flexible plan fields
  maturityDate: Joi.date().iso().optional(),
  contribution: Joi.object({
    frequency: Joi.string().valid("weekly", "monthly").required(),
    amount: Joi.number().positive().required(),
    dayOfWeek: Joi.number().integer().min(0).max(6).optional(),
    dayOfMonth: Joi.number().integer().min(1).max(31).optional(),
  }).optional(),

  // Deprecated (backward compat)
  durationDays: Joi.number().integer().positive().optional(),
  amount: Joi.number().positive().optional(),
  interestRate: Joi.number().min(0).optional(),
  renew: Joi.boolean().optional(),
});

/**
 * Withdraw from Savings Plan Validation
 */
export const withdrawSchema = Joi.object({
  amount: Joi.number().positive().required(),
});

/**
 * User Plans Query Validation
 */
export const userPlansQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

/**
 * Admin Plans Query Validation
 */
export const adminPlansQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

/**
 * Admin Savings By Category Query Validation
 */
export const savingsByCategoryQuerySchema = Joi.object({
  category: Joi.string().valid("active", "matured", "withdrawn").required(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});
