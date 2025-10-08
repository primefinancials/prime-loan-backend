/**
 * src/modules/transfers/transfer.validation.ts
 *
 * Joi validation schemas and small middleware helpers for the Transfers module.
 */

import Joi from "joi";
import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

/**
 * Request body for /transfers/initiate
 * Matches the fields used by TransferController.initiate
 */
export const transferInitiateSchema = Joi.object({
  fromAccount: Joi.string().required().description("Sender account number"),
  fromClientId: Joi.string().optional(),
  fromClient: Joi.string().optional(),
  fromSavingsId: Joi.string().optional(),
  fromBvn: Joi.string().optional(),
  toClient: Joi.string().optional(),
  toClientId: Joi.string().optional(),
  toSession: Joi.string().optional(),
  toAccount: Joi.string().required().description("Beneficiary account number"),
  toSavingsId: Joi.string().optional(),
  toBvn: Joi.string().optional(),
  toBank: Joi.string().optional().description('Bank code; use "999999" for intra/provider internal transfers'),
  toKyc: Joi.alternatives().try(Joi.string(), Joi.object(), Joi.boolean()).optional(),
  amount: Joi.number().positive().required().description("Amount in Naira"),
  transferType: Joi.string().valid("intra", "inter").required(),
  remark: Joi.string().optional().allow(""),
  idempotencyKey: Joi.string().optional(),
});

/**
 * Query for /transfers/status
 * At least one of reference or sessionId is required.
 */
export const transferStatusQuerySchema = Joi.object({
  reference: Joi.string().optional(),
  sessionId: Joi.string().optional(),
}).or("reference", "sessionId");

/**
 * Query for listing transfers: /transfers?page=&limit=
 */
export const transfersListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

/**
 * Wallet alerts webhook body (public endpoint)
 */
export const walletAlertsSchema = Joi.object({
  account_number: Joi.string().required(),
  amount: Joi.number().positive().required(),
  originator_account_name: Joi.string().optional().allow(""),
  originator_account_number: Joi.string().optional().allow(""),
  originator_bank: Joi.string().optional().allow(""),
  originator_narration: Joi.string().optional().allow(""),
  reference: Joi.string().required(),
  session_id: Joi.string().optional().allow(""),
  timestamp: Joi.string().optional().allow(""),
});
