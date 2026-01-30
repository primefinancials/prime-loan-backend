/**
 * Savings Controller - V2 savings endpoints
 * Handles savings plan creation, withdrawals, and admin analytics
 */
import { Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { SavingsService } from "./savings.service";
import { SettingsService } from "../admin/settings.service";
import { checkPermission } from "../../shared/utils/checkPermission";

export class SavingsController {
  /**
   * Create a savings plan
   */
  static async createPlan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const {
        planType,
        planName,
        targetAmount,
        durationDays,
        amount,
        interestRate,
        renew,
      } = req.body;

      const userId = req.user!._id;
      const idempotencyKey = req.idempotencyKey!;

      const setting = await SettingsService.getSettings();
      if (!setting.savingsEnabled) {
        return res.status(400).json({
          status: "failed",
          message: "Savings is currently inactive, try again later.",
        });
      }

      const result = await SavingsService.createPlan({
        userId: userId as any,
        planType,
        planName,
        targetAmount,
        durationDays,
        amount,
        interestRate,
        renew,
        idempotencyKey,
      });

      res.status(201).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Top-up an existing savings plan
   */
  static async topUp(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { amount } = req.body;
      const userId = req.user!._id;
      const idempotencyKey = req.idempotencyKey!;

      const setting = await SettingsService.getSettings();
      if (!setting.savingsEnabled) {
        return res.status(400).json({
          status: "failed",
          message: "Savings is currently inactive, try again later.",
        });
      }

      const result = await SavingsService.topUpPlan({
        planId: id,
        userId: userId as any,
        amount,
        idempotencyKey,
      });

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Withdraw from a savings plan
   */
  static async withdraw(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const amount = Number(req.body?.amount || 0);
      const userId = req.user!._id;
      const idempotencyKey = req.idempotencyKey!;

      const setting = await SettingsService.getSettings();
      if (!setting.savingsEnabled) {
        return res.status(400).json({
          status: "failed",
          message: "Savings is currently inactive, try again later.",
        });
      }

      const result = await SavingsService.completePlan({
        planId: id,
        userId: userId as any,
        amount,
        idempotencyKey,
      });

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all savings plans for the logged-in user
   */
  static async getUserPlans(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id;

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const plans = await SavingsService.getUserPlans(userId as any, page, limit);

      res.status(200).json({
        status: "success",
        data: plans,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get all users' savings plans
   */
  static async getPlans(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;

      // 🔐 Permission chain: view_savings → view_active_savings → manage_savings
      if (
        !checkPermission(admin!, "view_savings") &&
        !checkPermission(admin!, "manage_savings")
      ) {
        return res.status(403).json({
          status: "failed",
          message: "You are not authorized to view savings plans.",
        });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const plans = await SavingsService.getAllPlans(page, limit);

      res.status(200).json({
        status: "success",
        data: plans,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get portfolio savings statistics
   */
  static async getAdminStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;

      // 🔐 Permission chain: view_savings_stats → view_savings → manage_savings
      if (
        !checkPermission(admin!, "view_savings") &&
        !checkPermission(admin!, "manage_savings")
      ) {
        return res.status(403).json({
          status: "failed",
          message: "You are not authorized to view savings statistics.",
        });
      }

      const stats = await SavingsService.getAdminSavingsStats();

      res.status(200).json({
        status: "success",
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get savings plans by category (active, matured, withdrawn)
   */
  static async getSavingsByCategory(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;

      // 🔐 Permission chain: view_savings → view_active_savings → manage_savings
      if (
        !checkPermission(admin!, "view_savings") &&
        !checkPermission(admin!, "manage_savings")
      ) {
        return res.status(403).json({
          status: "failed",
          message: "You are not authorized to view savings by category.",
        });
      }

      const category = String(req.query.category || "active") as
        | "active"
        | "matured"
        | "withdrawn";
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const result = await SavingsService.getSavingsByCategory(category, page, limit);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Savings Configuration (Public/User)
   * Returns interest rates, penalty rates, min duration, and early withdrawal rules.
   */
  static async getSavingsConfig(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const settings = await SettingsService.getSettings();

      // Return only safe/relevant settings for the user
      const config = {
        savingsEnabled: settings.savingsEnabled,
        fixed: settings.savings.fixed,
        flexible: settings.savings.flexible,
        autoSave: settings.savings.autoSave
      };

      res.status(200).json({
        status: "success",
        data: config,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a savings plan (only if balance is 0)
   */
  static async deletePlan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user!._id;

      const result = await SavingsService.deletePlan(userId as any, id);

      res.status(200).json({
        status: "success",
        message: result.message
      });
    } catch (error) {
      next(error);
    }
  }
}

export default SavingsController;
