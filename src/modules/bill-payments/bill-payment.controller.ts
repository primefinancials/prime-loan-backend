/**
 * Bill Payment Controller (Flutterwave-backed)
 *
 * - Provides endpoints to interact with Flutterwave bill payment APIs
 * - Replaces all ClubConnectsService references with BillPaymentService (Flutterwave orchestration)
 * - Fully Express-compatible (no NestJS decorators)
 * - Includes permission checks for admin routes
 */

import { Request, Response, NextFunction } from "express";
import BillPaymentService from "./bill.payment.service";
import { ProtectedRequest } from "../../interfaces";
import { ProfitService } from "../profits/profits.service";
import { SettingsService } from "../admin/settings.service";
import { InfluencerService } from "../influencer/influencer.service";
import { checkPermission } from "../../shared/utils/checkPermission";
import { UnauthorizedError } from "../../exceptions";

export class BillPaymentController {
  private static profitService = new ProfitService();

  /**
   * 🔹 Initiate a bill payment
   * Delegates to BillPaymentService.initiateBillPayment (orchestrates via VFD + Flutterwave)
   */
  static async initiate(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { amount, serviceType, serviceId, customerReference, itemCode, extras, referralCode } = req.body;
      const userId = req.user!._id as any;
      const idempotencyKey = req.idempotencyKey!;

      const result = await BillPaymentService.initiateBillPayment({
        userId,
        amount,
        serviceType,
        serviceId,
        customerReference,
        itemCode,
        idempotencyKey,
      });

      // Background non-critical hooks to improve endpoint speed
      SettingsService.calculateProfit("bill-payment", "send", amount)
        .then(profit => 
          BillPaymentController.profitService.recordProfit({
            amount: profit,
            source: "bill-payment",
            userId,
            reference: result.traceId,
            type: "realized",
          })
        ).catch(err => console.error('Profit recording failed (non-fatal):', err.message));

      InfluencerService.recordCommissionForUser(userId, 'bill-payment', amount, undefined, referralCode)
        .catch(err => console.warn('Influencer commission recording failed (non-fatal):', err.message));

      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🔹 FLUTTERWAVE BILLER DISCOVERY ENDPOINTS
  // ───────────────────────────────────────────────────────────────

  /** Get supported categories (Airtime, Power, TV, etc.) */
  static async getCategories(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const data = await BillPaymentService.getSupportedCategories("NG");
      res.status(200).json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }

  /** Get billers by category */
  static async getBillers(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { categoryCode } = req.params;
      const data = await BillPaymentService.getBillersByCategory(categoryCode, "NG");
      res.status(200).json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }

  /** Get bill items/products for a biller */
  static async getBillItems(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { billerCode } = req.params;
      const data = await BillPaymentService.getBillItems(billerCode);
      res.status(200).json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }

  /** Validate customer account (meter number, smartcard, etc.) */
  static async validateAccount(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { itemCode, customerReference, serviceType, provider } = req.body;
      const data = await BillPaymentService.validateServiceAccount(itemCode, customerReference, serviceType, provider);
      res.status(200).json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🔹 BILL PAYMENT HISTORY + STATUS
  // ───────────────────────────────────────────────────────────────

  /** Retrieve user bill payments (paginated) */
  static async getUserPayments(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 20, status, type, search } = req.query;
      const userId = req.user!._id as any;

      const result = await BillPaymentService.getUserBillPayments(
        String(userId),
        Number(page),
        Number(limit),
        status ? String(status) : undefined,
        type ? String(type) : undefined,
        search ? String(search) : undefined
      );

      res.status(200).json({ status: "success", ...result });
    } catch (error) {
      next(error);
    }
  }

  /** Retrieve all bill payments (admin) */
  static async getAllPayments(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      const { page = 1, limit = 20, status, type, search } = req.query;

      // Permission Hierarchy
      if (checkPermission(admin, "view_bill_payments")) {
        const result = await BillPaymentService.getBillPayments(
          Number(page),
          Number(limit),
          status ? String(status) : undefined,
          type ? String(type) : undefined,
          search ? String(search) : undefined
        );
        return res.status(200).json({ status: "success", ...result });
      }

      throw new UnauthorizedError("You do not have permission to view bill payments.");
    } catch (error) {
      next(error);
    }
  }

  /** Check if a biller has downtime */
  static async checkDowntime(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      const { billerCode } = req.params;

      if (
        !checkPermission(admin, "view_bill_payments") &&
        !checkPermission(admin, "manage_bill_payments")
      ) {
        throw new UnauthorizedError("You do not have permission to check biller status.");
      }

      const result = await BillPaymentService.checkServiceDowntime(billerCode);
      res.status(200).json({ status: "success", downtime: result });
    } catch (error) {
      next(error);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🔹 PROVIDER STATUS / HEALTHCHECKS
  // ───────────────────────────────────────────────────────────────

  /** Healthcheck: Confirm Flutterwave connectivity */
  static async flutterwaveHealth(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      if (
        !checkPermission(admin, "manage_bill_payments") &&
        !checkPermission(admin, "view_bill_payments")
      ) {
        throw new UnauthorizedError("You do not have permission to access Flutterwave health status.");
      }

      const data = await BillPaymentService.getSupportedCategories("NG");
      res.status(200).json({ status: "success", message: "Flutterwave is reachable", data });
    } catch (error) {
      next(error);
    }
  }
}

export default BillPaymentController;
