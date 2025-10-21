import { Request, Response } from "express";
import { profitService } from "./profits.service";
import { checkPermission } from "../../shared/utils/checkPermission";
import { ProtectedRequest } from "../../interfaces";

export class ProfitController {
  /**
   * GET /profits/user/:userId?page=&limit=&type=
   * 🔐 Admin-only: requires view_profits or manage_profits
   */
  async getUserProfits(req: ProtectedRequest, res: Response) {
    try {
      const admin = req.admin;

      if (
        !checkPermission(admin!, "view_profits") &&
        !checkPermission(admin!, "manage_settings")
      ) {
        return res.status(403).json({
          status: "failure",
          message: "You are not authorized to view user profits.",
        });
      }

      const { type, source, page = 1, limit = 10 } = req.query;
      const result = await profitService.getUserProfits(
        req.params.userId,
        type as "realized" | "unrealized",
        source as "transaction" | "bill-payment" | "loan" | "savings" | "escrow",
        Number(page),
        Number(limit)
      );

      res.json({
        status: "success",
        data: result,
      });
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching profits", error });
    }
  }

  /**
   * GET /profits/type?type=realized|unrealized&page=&limit=
   * 🔐 Admin-only: requires view_profits or manage_profits
   */
  async getProfitByType(req: ProtectedRequest, res: Response) {
    try {
      const admin = req.admin;

      if (
        !checkPermission(admin!, "view_profits") &&
        !checkPermission(admin!, "manage_settings")
      ) {
        return res.status(403).json({
          status: "failure",
          message: "You are not authorized to view profits by type.",
        });
      }

      const { type, source, page = 1, limit = 10 } = req.query;
      const result = await profitService.getProfitByType(
        type as "realized" | "unrealized",
        source as "transaction" | "bill-payment" | "loan" | "savings" | "escrow",
        Number(page),
        Number(limit)
      );

      res.json({
        status: "success",
        data: result,
      });
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching profits", error });
    }
  }

  /**
   * GET /profits/reference?reference=abc123
   * 🔐 Admin-only: requires view_profits or manage_profits
   */
  async getProfitByReference(req: ProtectedRequest, res: Response) {
    try {
      const admin = req.admin;

      if (
        !checkPermission(admin!, "view_profits") &&
        !checkPermission(admin!, "manage_settings")
      ) {
        return res.status(403).json({
          status: "failure",
          message: "You are not authorized to view profit details by reference.",
        });
      }

      const data = await profitService.getProfitByReference(req.query.reference as string);

      res.json({
        status: data ? "success" : "failure",
        data,
      });
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching profit", error });
    }
  }

  /**
   * GET /profits/total
   * 🔐 Admin-only: requires view_profits or manage_profits
   */
  async getTotalProfit(req: ProtectedRequest, res: Response) {
    try {
      const admin = req.admin;

      if (
        !checkPermission(admin!, "view_profits") &&
        !checkPermission(admin!, "manage_settings")
      ) {
        return res.status(403).json({
          status: "failure",
          message: "You are not authorized to view total profits.",
        });
      }

      const result = await profitService.getTotalProfits(req.query);

      res.json({
        status: "success",
        data: result,
      });
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching total profit", error });
    }
  }

  /**
   * PATCH /profits/:reference/realize
   * 🔐 Admin-only: requires manage_profits or update_profits
   */
  async markProfitAsRealized(req: ProtectedRequest, res: Response) {
    try {
      const admin = req.admin;

      if (
        !checkPermission(admin!, "manage_settings")
      ) {
        return res.status(403).json({
          status: "failure",
          message: "You are not authorized to update profit records.",
        });
      }

      const { reference } = req.params;
      const profit = await profitService.markAsRealized(reference);

      if (!profit)
        return res.status(404).json({ status: "failure", message: "Profit not found" });

      res.json({
        status: "success",
        message: "Profit marked as realized",
        profit,
      });
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error updating profit", error });
    }
  }
}

export const profitController = new ProfitController();
