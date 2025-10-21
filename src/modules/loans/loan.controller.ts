/**
 * loan.controller.ts
 * V2 Loan Controller
 * - Handles loan application, repayment, status, listing
 * - Leverages LoanService (business logic) and LoanEligibilityService (rules)
 * - Transaction + Idempotency aware
 */

import { Request, Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { LoanService, CreateLoanParams, RepayParams } from "./loan.service";
import { LoanEligibilityService } from "./loan-eligibility";
import { LoanLadder } from "./loan-ladder.model";
import { SettingsService } from "../admin/settings.service";
import { checkPermission, getMailsByPermission } from "../../shared/utils/checkPermission";
import { NotificationService } from "../notifications/notification.service";
import { UserService } from "../users/user.service";
import { ProfitService } from "../profits/profits.service";
import { UnauthorizedError } from "../../exceptions";
import crypto from "crypto";

export class LoanController {
  private static profitService = new ProfitService();

  /**
   * ────────────────────────────────────────────────
   * 🧾 USER: Request a new loan
   * ────────────────────────────────────────────────
   */
  static async requestLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id;
      const idempotencyKey = req.idempotencyKey;

      const {
        first_name,
        last_name,
        dob,
        nin,
        email,
        bvn,
        phone,
        address,
        company,
        company_address,
        annual_income,
        guarantor_1_name,
        guarantor_1_phone,
        guarantor_2_name,
        guarantor_2_phone,
        amount,
        reason,
        documentType,
        repayment_date,
        repayment_amount,
        loan_date,
        base64Image,
        faceVideoBase64,
        category,
        type,
        duration,
        percentage,
      } = req.body;

      const loan = await LoanService.createLoan({
        userId,
        first_name,
        last_name,
        dob,
        nin,
        email,
        bvn,
        phone,
        address,
        company,
        company_address,
        annual_income,
        guarantor_1_name,
        guarantor_1_phone,
        guarantor_2_name,
        guarantor_2_phone,
        amount,
        reason,
        documentType,
        base64Image,
        faceVideoBase64,
        repayment_date,
        repayment_amount,
        loan_date,
        category,
        type,
        duration,
        percentage,
        acknowledgment: true,
        idempotencyKey,
      } as CreateLoanParams);

      const settings = await SettingsService.getSettings();

      if (!settings.autoLoanApproval) {
        return res.status(201).json({ status: "success", data: loan });
      }

      // Eligibility check
      const eligibility = await LoanEligibilityService.calculateEligibility(req.user!, amount);
      const admins = await getMailsByPermission("manage_loans");

      if (eligibility.eligible) {
        if (eligibility.notifyAdmin) {
          await NotificationService.sendLoanApplicationAdmin(
            req.user!,
            `New Urgent Loan Application Notification from ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname}`,
            `User ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname} has applied for a loan of ${amount}. System requires admin intervention because: ${eligibility.reason}.`,
            admins,
            loan
          );
        } else {
          const ladder = await LoanLadder.findOne({ step: req.user?.user_metadata.ladderIndex || 0 });
          if (ladder) {
            return res.status(201).json({ status: "success", data: loan });
          }

          await NotificationService.sendLoanApplicationAdmin(
            req.user!,
            `Invalid Loan Ladder Configuration`,
            `User ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname} applied for a loan but ladder score ${req.user?.user_metadata.ladderIndex} was invalid.`,
            admins,
            loan
          );
        }
      } else {
        if (eligibility.notifyAdmin) {
          await NotificationService.sendLoanApplicationAdmin(
            req.user!,
            `Ineligible Loan Application Requiring Review`,
            `User ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname} applied for a loan of ${amount} and is not eligible. Reason: ${eligibility.reason}.`,
            admins,
            loan
          );
        } else {
          await LoanService.rejectLoan("system", loan._id, eligibility.reason || "");
          return res.status(400).json({ status: "failed", message: eligibility.reason });
        }
      }

      res.status(201).json({ status: "success", data: loan });
    } catch (error) {
      next(error);
    }
  }

  /**
   * ────────────────────────────────────────────────
   * 💸 USER: Repay an existing loan
   * ────────────────────────────────────────────────
   */
  static async repayLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { amount, mandatory } = req.body;
      const userId = req.user!._id;
      const idempotencyKey = req.idempotencyKey;

      const result = await LoanService.repayLoan({
        loanId: id,
        userId,
        amount: Number(amount),
        mandatory,
        idempotencyKey,
      } as RepayParams);

      const profit = await LoanController.profitService.getProfitByReference(id);

      if ((profit?.amount || 0) >= amount) {
        await LoanController.profitService.deleteProfit(id);
        await LoanController.profitService.recordProfit({
          amount,
          source: "loan",
          userId: result.loan.userId,
          reference: result.loan._id,
          type: "realized",
        });
      } else {
        const [figure, outstanding] = [amount, (profit?.amount || 0) - amount];

        await LoanController.profitService.deleteProfit(id);

        await LoanController.profitService.recordProfit({
          amount: figure,
          source: "loan",
          userId: result.loan.userId,
          reference: crypto.randomUUID(),
          type: "realized",
        });

        await LoanController.profitService.recordProfit({
          amount: outstanding,
          source: "loan",
          userId: result.loan.userId,
          reference: result.loan._id,
          type: "unrealized",
        });
      }

      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * ────────────────────────────────────────────────
   * 🏦 ADMIN: Disburse a loan
   * ────────────────────────────────────────────────
   */
  static async disburseLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      if (!checkPermission(admin, "manage_loans")) {
        throw new UnauthorizedError("You do not have permission to disburse loans.");
      }

      const { loanId, amount } = req.body;
      const idempotencyKey = req.idempotencyKey;

      const result = await LoanService.disburseLoan({
        adminId: admin!._id,
        loanId,
        amount,
        idempotencyKey,
      });

      const profit = await SettingsService.calculateProfit("loan", "send", amount);

      await LoanController.profitService.recordProfit({
        amount: profit,
        source: "loan",
        userId: result.loan.userId,
        reference: result.loan._id,
        type: "unrealized",
      });

      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 🛑 ADMIN: Reject a loan
   */
  static async rejectLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const admin = req.admin;

      if (!checkPermission(admin, "manage_loans")) {
        throw new UnauthorizedError("You do not have permission to reject loans.");
      }

      const loan = await LoanService.rejectLoan(admin?._id || "", id, reason);
      res.status(200).json({ status: "success", data: loan });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 👤 USER: Cancel a loan
   */
  static async cancelLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const user = req.user;

      const loan = await LoanService.cancelLoan(user?._id || "", id, reason);
      res.status(200).json({ status: "success", data: loan });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 📄 Get single loan status
   */
  static async getLoanStatus(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const loan = await LoanService.getLoanById(id);
      if (!loan) return res.status(404).json({ status: "failed", message: "Loan not found" });
      res.status(200).json({ status: "success", data: loan });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 📋 USER: List user's loans (paginated)
   */
  static async listUserLoans(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const result = await LoanService.listLoansForUser(userId, page, limit);
      res.status(200).json({ status: "success", ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 🧾 ADMIN: List all loans with fallback permissions
   */
  static async listAllLoans(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      if (checkPermission(admin, "view_loans")) {
        const result = await LoanService.listAllLoans(page, limit);
        return res.status(200).json({ status: "success", ...result });
      }

      if (checkPermission(admin, "view_pending")) {
        const result = await LoanService.getLoansByCategory("pending", page, limit);
        return res.status(200).json({ status: "success", ...result });
      }

      if (checkPermission(admin, "view_overdue")) {
        const result = await LoanService.getLoansByCategory("overdue", page, limit);
        return res.status(200).json({ status: "success", ...result });
      }

      throw new UnauthorizedError("You do not have permission to view loans.");
    } catch (error) {
      next(error);
    }
  }

  /**
   * 🧾 ADMIN: Single loan history + user info
   */
  static async singleLoanHistory(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const admin = req.admin;

      if (!checkPermission(admin, ["view_loans", "view_pending", "view_overdue"])) {
        throw new UnauthorizedError("You do not have permission to view loan history.");
      }

      const loan = await LoanService.getLoanById(id);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const history = await LoanService.listLoansForUser(loan?.userId || "", page, limit);
      const user = await UserService.getUser(loan?.userId || "");

      if (history.data.length > 0) {
        history.data = history.data.filter((item) => item._id !== id);
      }

      res.status(200).json({ status: "success", data: { loan, user, history } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 📊 ADMIN: Get loan statistics
   */
  static async getAdminLoanStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      if (!checkPermission(admin, ["view_loans", "manage_loans"])) {
        throw new UnauthorizedError("You do not have permission to view loan statistics.");
      }

      const stats = await LoanService.getAdminLoanStats();
      res.status(200).json({ status: "success", data: stats });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 🧾 ADMIN: Get loans by category
   */
  static async getLoansByCategory(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const category = req.query.category as
        | "active"
        | "due"
        | "overdue"
        | "completed"
        | "pending"
        | "rejected"
        | undefined;
      const search = req.query.search as string | undefined;

      // Determine what subset the admin can view
      const canView = checkPermission(admin, "view_loans");
      const viewPending = checkPermission(admin, "view_pending");
      const viewOverdue = checkPermission(admin, "view_overdue");

      if (!canView && !viewPending && !viewOverdue) {
        throw new UnauthorizedError("You do not have permission to view loans.");
      }

      const data = await LoanService.getLoansByCategory(
        canView
          ? category
          : viewPending
          ? "pending"
          : viewOverdue
          ? "overdue"
          : "active",
        page,
        limit,
        search
      );

      res.status(200).json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * ────────────────────────────────────────────────
   * 📈 Loan Ladder Management (Admin)
   * ────────────────────────────────────────────────
   */
  static async createLoanLadder(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      if (!checkPermission(admin, "manage_loans")) {
        throw new UnauthorizedError("You do not have permission to manage loan ladders.");
      }

      const { step, amount, adminNotes } = req.body;
      const ladder = await LoanService.createLoanLadder(admin?._id || "", Number(step), Number(amount), adminNotes);
      res.status(201).json({ status: "success", message: "Loan ladder step created successfully", data: ladder });
    } catch (error) {
      next(error);
    }
  }

  static async updateLoanLadder(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      if (!checkPermission(admin, "manage_loans")) {
        throw new UnauthorizedError("You do not have permission to update loan ladders.");
      }

      const { id } = req.params;
      const updates = req.body;
      const ladder = await LoanService.updateLoanLadder(admin?._id || "", id, updates);
      res.status(200).json({ status: "success", message: "Loan ladder updated successfully", data: ladder });
    } catch (error) {
      next(error);
    }
  }

  static async deleteLoanLadder(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      if (!checkPermission(admin, "manage_loans")) {
        throw new UnauthorizedError("You do not have permission to delete loan ladders.");
      }

      const { id } = req.params;
      const result = await LoanService.deleteLoanLadder(admin?._id || "", id);
      res.status(200).json({ status: "success", message: result.message });
    } catch (error) {
      next(error);
    }
  }

  static async getLoanLadders(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ladders = await LoanService.getLoanLadders(page, limit);
      res.status(200).json({ status: "success", ...ladders });
    } catch (error) {
      next(error);
    }
  }

  static async getLoanLadderById(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const ladder = await LoanService.getLoanLadderById(id);
      res.status(200).json({ status: "success", data: ladder });
    } catch (error) {
      next(error);
    }
  }
}
