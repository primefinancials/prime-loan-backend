import { Request, Response } from "express";
import { profitService } from "./profits.service";

export class ProfitController {
  /**
   * GET /profits/user/:userId?page=&limit=&type=
   */
  async getUserProfits(req: Request, res: Response) {
    try {
      const { type, page = 1, limit = 10 } = req.query;
      const result = await profitService.getUserProfits(
        req.params.userId,
        type as "realized" | "unrealized",
        Number(page),
        Number(limit)
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching profits", error });
    }
  }

  /**
   * GET /profits/type?type=realized|unrealized&page=&limit=
   */
  async getProfitByType(req: Request, res: Response) {
    try {
      const { type, page = 1, limit = 10 } = req.query;
      const result = await profitService.getProfitByType(
        type as "realized" | "unrealized",
        Number(page),
        Number(limit)
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching profits", error });
    }
  }

  /**
   * GET /profits/reference?reference=abc123
   */
  async getProfitByReference(req: Request, res: Response) {
    try {
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
   */
  async getTotalProfit(req: Request, res: Response) {
    try {
      const result = await profitService.getTotalProfits(req.query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error fetching total profit", error });
    }
  }

  /**
   * PATCH /profits/:reference/realize
   */
  async markProfitAsRealized(req: Request, res: Response) {
    try {
      const { reference } = req.params;
      const profit = await profitService.markAsRealized(reference);

      if (!profit)
        return res.status(404).json({ status: "failure", message: "Profit not found" });

      res.json({ status: "success", message: "Profit marked as realized", profit });
    } catch (error) {
      res.status(500).json({ status: "failure", message: "Error updating profit", error });
    }
  }
}

export const profitController = new ProfitController();
