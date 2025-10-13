/**
 * loan.controller.ts
 * V2 Loan Controller
 * - Handles loan application, repayment, status, listing
 * - Leverages LoanService (business logic) and LoanEligibilityService (rules)
 * - Transaction + Idempotency aware
 */
import { Request, Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { LoanService, CreateLoanParams, RepayParams, DisburseParams } from "./loan.service";
import { LoanEligibilityService } from "./loan-eligibility";
import { LoanLadder } from "./loan-ladder.model";
import { SettingsService } from "../admin/settings.service";
import { checkPermission } from "../../shared/utils/checkPermission";
import { getMailsByPermission } from "../../shared/utils/checkPermission";
import { NotificationService } from "../notifications/notification.service";
import { UserService } from "../users/user.service";

export class LoanController {
  /**
   * Request a new loan
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
        res.status(201).json({
          status: "success",
          data: loan,
        });
      }

      // Eligibility check
      const eligibility = await LoanEligibilityService.calculateEligibility(req.user!, amount);
      const admins = await getMailsByPermission("manage_loans");

      if (eligibility.eligible) {
        if (eligibility.notifyAdmin) {
          await NotificationService.sendLoanApplicationAdmin(
            req.user!, 
            `New Urgent Loan Application Notification from ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname}`,
            `User ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname} has applied for a loan of ${amount} although eligible, system require admin intervention because: ${eligibility.reason}.`,
            admins,
            loan
          );
        } else {
          const amount = await LoanLadder.findOne({ step: req.user?.user_metadata.ladderIndex || 0 });

          if (amount) {
            const disburseLoan = await LoanService.disburseLoan({
              loanId: loan._id,
              adminId: "system",
              amount: amount.amount,
            });

            return res.status(201).json({
              status: "success",
              data: disburseLoan,
            });
          }

          await NotificationService.sendLoanApplicationAdmin(
            req.user!, 
            `New Urgent Loan Application Notification from ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname}`,
            `User ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname} has applied for a loan of ${amount} although eligible, system could not determine amount to disburse due to invalid ladder score: ${req.user?.user_metadata.ladderIndex}.`,
            admins,
            loan
          );
        }
      }

      if (!eligibility.eligible) {
        if (eligibility.notifyAdmin) {
          await NotificationService.sendLoanApplicationAdmin(
            req.user!, 
            `New Urgent Loan Application Notification from ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname}`,
            `User ${req.user?.user_metadata.first_name} ${req.user?.user_metadata.surname} has applied for a loan of ${amount} and is not eligible, but system require admin intervention because: ${eligibility.reason}.`,
            admins,
            loan
          );
        } else {
          await LoanService.rejectLoan("system", loan._id, eligibility?.reason || "");

          return res.status(400).json({
            status: "failed",
            message: eligibility.reason,
          });
        }
      }

      res.status(201).json({
        status: "success",
        data: loan,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Repay an existing loan
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
        amount,
        mandatory,
        idempotencyKey,
      } as RepayParams);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Disburse a loan
   */
  static async disburseLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { loanId, amount } = req.body;
      const admin = req.admin;
      const idempotencyKey = req.idempotencyKey;

      checkPermission(admin, "manage_loans");

      const result = await LoanService.disburseLoan({
        adminId: admin?._id || "",
        loanId,
        amount,
        idempotencyKey,
      } as DisburseParams);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Reject a loan
   */
  static async rejectLoan(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const admin = req.admin;

      checkPermission(admin, "manage_loans");

      const loan = await LoanService.rejectLoan(admin?._id || "", id, reason);

      res.status(200).json({
        status: "success",
        data: loan,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single loan status
   */
  static async getLoanStatus(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const loan = await LoanService.getLoanById(id);

      if (!loan) {
        return res.status(404).json({ status: "failed", message: "Loan not found" });
      }

      res.status(200).json({
        status: "success",
        data: loan,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List loans for a user (paginated)
   */
  static async listUserLoans(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const result = await LoanService.listLoansForUser(userId, page, limit);

      res.status(200).json({
        status: "success",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: List all loans (paginated, with filter)
   */
  static async listAllLoans(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const filter: any = req.query || {};

      checkPermission(admin, "view_loans");

      const result = await LoanService.listAllLoans(page, limit, filter);

      res.status(200).json({
        status: "success",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: single loan history (paginated)
   */
  static async singleLoanHistory(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const admin = req.admin;

      checkPermission(admin, "view_loans");

      const loan = await LoanService.getLoanById(id);

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      let history = await LoanService.listLoansForUser(loan?.userId || "trx-id", page, limit);

      let user = await UserService.getUser(loan?.userId || "ux-id");

      if (history.data.length > 0) {
        history.data = history.data.filter((item) => item._id !== id);
      }

      res.status(200).json({
        status: "success",
        data: {
          loan,
          user,
          history,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get Loan Statistics
   */
  static async getAdminLoanStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;

      checkPermission(admin, "view_loans");

      const loan = await LoanService.getAdminLoanStats();

      if (!loan) {
        return res.status(404).json({ status: "failed", message: "Loan not found" });
      }

      res.status(200).json({
        status: "success",
        data: loan,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get Loans By Category
   */
  static async getLoansByCategory(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const category = req.query.category as "active" | "due" | "overdue" | "completed" | "pending" | "rejected" | undefined;
      const search = req.query.search as string | undefined;

      checkPermission(admin, "view_loans");

      const data = await LoanService.getLoansByCategory(category, page, limit, search);

      res.status(200).json({
        status: "success",
        data
      });
    } catch (error) {
      next(error);
    }
  }
}
