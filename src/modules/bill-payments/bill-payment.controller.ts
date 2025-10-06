/**
 * Bill Payment Controller (Flutterwave-backed)
 *
 * - Provides endpoints to interact with Flutterwave bill payment APIs
 * - Replaces all ClubConnectsService references with BillPaymentService (Flutterwave orchestration)
 * - Fully Express-compatible (no NestJS decorators)
 * - Each route wraps Flutterwave endpoints for Airtime, Data, TV, Power, Internet, WAEC, JAMB, etc.
 */

import { Request, Response, NextFunction } from "express";
import BillPaymentService from "./bill.payment.service";
import { ProtectedRequest } from "../../interfaces";

export class BillPaymentController {
  /**
   * 🔹 Initiate a bill payment
   * Delegates to BillPaymentService.initiateBillPayment (orchestrates via VFD + Flutterwave)
   */
  static async initiate(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { amount, serviceType, serviceId, customerReference, extras } = req.body;
      const userId = req.user!._id;
      const idempotencyKey = req.idempotencyKey!;

      const result = await BillPaymentService.initiateBillPayment({
        userId,
        amount,
        serviceType,
        serviceId,
        customerReference,
        extras,
        idempotencyKey,
      });

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
      const { itemCode, customerReference } = req.body;
      const data = await BillPaymentService.validateServiceAccount(itemCode, customerReference);
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
      const userId = req.user!._id;

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
  static async getAllPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 20, status, type, search } = req.query;

      const result = await BillPaymentService.getBillPayments(
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

  /** Check if a biller has downtime */
  static async checkDowntime(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { billerCode } = req.params;
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
  static async flutterwaveHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await BillPaymentService.getSupportedCategories("NG");
      res.status(200).json({ status: "success", message: "Flutterwave is reachable", data });
    } catch (error) {
      next(error);
    }
  }
}

export default BillPaymentController;
