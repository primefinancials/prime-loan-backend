/**
 * Admin Controller - Administrative operations and reporting
 * Provides admin tools for reconciliation, manual reviews, account management, and profit reporting
 */
import { Request, Response, NextFunction } from 'express';
import { ProtectedRequest } from '../../interfaces';
import { LedgerService } from '../ledger/LedgerService';
import { LedgerEntry } from '../ledger/LedgerEntry.model';
import { AdminService } from './admin.service'; // adjust path if needed
import { SavingsService } from '../savings/savings.service'; // adjust path if needed
import { checkPermission } from '../../shared/utils/checkPermission';
import { Transfer } from '../transfers/transfer.model';
import { BillPayment } from '../bill-payments/bill-payment.model';
import { TransferService } from '../transfers/transfer.service';
import { UserService } from '../users/user.service';
import { UnauthorizedError } from '../../exceptions';
import { SettingsService } from './settings.service';
import BillPaymentService from '../bill-payments/bill.payment.service';

const adminService = new AdminService();

function parsePageLimit(q: any) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  return { page, limit };
}

export class AdminController {
  /**
   * Create a new admin account
   */
  static async createAdminAccount(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const actingAdmin = req.admin;
      // original semantics: super-admin only
      if (!actingAdmin?.is_super_admin) {
        throw new UnauthorizedError('Only super admins can create admin accounts');
      }

      const admin = await adminService.createAdminAccount(req.body);

      res.status(201).json({
        status: 'success',
        data: admin
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetch a single admin by ID
   */
  static async getAdmin(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const actingAdmin = req.admin;
      checkPermission(actingAdmin!, 'view_users', { throwOnFail: true });

      const { adminId } = req.params;
      if (!adminId) return res.status(400).json({ status: 'failed', message: 'adminId is required' });

      const admin = await adminService.getAdmin(adminId);

      res.status(200).json({
        status: 'success',
        data: admin
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get list of admins
   */
  static async getAdmins(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const actingAdmin = req.admin;
      checkPermission(actingAdmin!, 'manage_users', { throwOnFail: true });

      const admin = await adminService.getAdmins();

      res.status(200).json({
        status: 'success',
        data: admin
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate / Deactivate an admin account
   */
  static async activateAndDeactivateAdmin(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const actingAdmin = req.admin;
      // original semantics: super-admin only
      if (!actingAdmin?.is_super_admin) {
        throw new UnauthorizedError('Only super admins can activate or deactivate admins');
      }

      const { status, adminId } = req.body;
      if (!adminId || !status) {
        return res.status(400).json({ status: 'failed', message: 'adminId and status are required' });
      }

      const updated = await adminService.activateAndDeactivateAdmin({ status, adminId });

      res.status(200).json({
        status: 'success',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate / Deactivate a user account
   */
  static async activateAndDeactivateUser(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const actingAdmin = req.admin;
      checkPermission(actingAdmin!, 'manage_users', { throwOnFail: true });

      const { status, userId } = req.body;
      if (!userId || !status) {
        return res.status(400).json({ status: 'failed', message: 'userId and status are required' });
      }

      const updated = await adminService.activateAndDeactivateUser({ status, userId });

      res.status(200).json({
        status: 'success',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get ledger & related entities by traceId (reconciliation helper)
   */
  static async getTransactionDetails(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "view_transactions", { throwOnFail: true });

      const { traceId } = req.params;
      if (!traceId) return res.status(400).json({ status: 'failed', message: 'traceId is required' });

      // Ledger entries for trace
      const ledgerEntries = await LedgerService.getByTraceId(traceId);

      // Try to find related transfers / bill payments by traceId (best-effort)
      const transfers = await Transfer.find({ traceId }).lean();
      const billPayments = await BillPayment.find({ traceId }).lean();

      res.status(200).json({
        status: 'success',
        data: {
          traceId,
          ledgerEntries,
          transfers,
          billPayments
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Re-query a transfer from provider and reconcile (best-effort)
   */
  static async requeryTransfer(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_transactions', { throwOnFail: true });

      const { id } = req.params;
      if (!id) return res.status(400).json({ status: 'failed', message: 'transfer id is required' });

      const transfer = await TransferService.transfer(id);
      if (!transfer) return res.status(404).json({ status: 'failed', message: 'transfer not found' });

      const user = await UserService.findByAccountNo(transfer.fromAccount);

      await TransferService.walletAlerts({
        account_number: transfer.toAccount,
        amount: transfer.amount,
        originator_account_name: `${user?.user_metadata?.first_name} ${user?.user_metadata?.surname}`,
        originator_account_number: transfer.fromAccount,
        originator_bank: "VFD - Prime Finance",
        originator_narration: transfer.naration || 'Transfer',
        reference: transfer.reference,
        session_id: transfer.traceId
      });

      res.status(200).json({
        status: 'success',
        message: 'Transfer requery triggered (best-effort).',
        data: transfer
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin dashboard: aggregated platform statistics
   */
  static async getDashboardStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_reports', { throwOnFail: true });

      const stats = await adminService.getDashboardStats();

      res.status(200).json({
        status: 'success',
        data: stats
      });
    } catch (error) {
      console.log('Dashboard Error: ', error);
      next(error);
    }
  }

  /**
   * System health check (DB, providers, workers hints)
   */
  static async getSystemHealth(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "view_reports", { throwOnFail: true });

      const health = await adminService.getSystemHealth();

      res.status(200).json({
        status: 'success',
        data: health
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List flagged transactions (transfers + loans) requiring manual review
   */
  static async getFlaggedTransactions(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_transactions', { throwOnFail: true });

      const result = await adminService.getFlaggedTransactions();

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List transactions (transfers) requiring manual review
   */
  static async getTransactions(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_transactions', { throwOnFail: true });

      const { search, type, status } = req.query;
      const { page, limit } = parsePageLimit(req.query);

      const result = await adminService.getTransactions(page, limit, status as string, type as string, search as string);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Bulk approve/reject loans
   */
  static async bulkLoanAction(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_loans', { throwOnFail: true });

      const { loanIds, action, reason } = req.body;
      if (!Array.isArray(loanIds) || loanIds.length === 0) return res.status(400).json({ status: 'failed', message: 'loanIds (array) is required' });
      if (!['approve', 'reject'].includes(action)) return res.status(400).json({ status: 'failed', message: 'action must be approve or reject' });

      const results = await adminService.bulkLoanAction(loanIds, action, String(admin!._id), reason);

      res.status(200).json({
        status: 'success',
        data: results
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate business / profit report
   */
  static async generateBusinessReport(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_reports', { throwOnFail: true });

      const { from, to } = req.query;
      const startDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(String(to)) : new Date();

      const report = await adminService.generateBusinessReport(startDate, endDate);

      res.status(200).json({
        status: 'success',
        data: report
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Profit report (ledger-driven)
   */
  static async getProfitReport(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_reports', { throwOnFail: true });

      const { from, to, service } = req.query;
      const startDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(String(to)) : new Date();

      const realizedProfits = await LedgerEntry.aggregate([
        {
          $match: {
            account: 'platform_revenue',
            entryType: 'CREDIT',
            status: 'COMPLETED',
            createdAt: { $gte: startDate, $lte: endDate },
            ...(service ? { category: service } : {})
          }
        },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]);

      const unrealizedProfits = await LedgerEntry.aggregate([
        {
          $match: {
            account: 'platform_revenue',
            entryType: 'CREDIT',
            status: 'PENDING',
            createdAt: { $gte: startDate, $lte: endDate },
            ...(service ? { category: service } : {})
          }
        },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          period: { from: startDate, to: endDate },
          realized: realizedProfits,
          unrealized: unrealizedProfits,
          totalRealized: realizedProfits.reduce((sum: number, item: any) => sum + (item.total || 0), 0),
          totalUnrealized: unrealizedProfits.reduce((sum: number, item: any) => sum + (item.total || 0), 0)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reconciliation: unbalanced traceIds
   */
  static async getReconciliationInconsistencies(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "manage_transactions", { throwOnFail: true });

      const inconsistencies = await LedgerService.findInconsistencies();

      res.status(200).json({
        status: 'success',
        data: {
          inconsistencies,
          count: inconsistencies.length
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Users Bill Payments (admin)
   */
  static async getBillPayment(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "manage_bill_payments", { throwOnFail: true });

      const { status, search, type } = req.query;

      const { page, limit } = parsePageLimit(req.query);

      const billPayments = await BillPaymentService.getBillPayments(page, limit, status as string, type as string, search as string);

      res.status(200).json({
        status: 'success',
        data: {
          ...billPayments
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update admin permissions
   */
  static async updateAdminPermissions(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const actingAdmin = req.admin;

      // original: only super admins can update admin permissions
      if (!actingAdmin?.is_super_admin) {
        throw new UnauthorizedError('Only super admins can update admin permissions');
      }

      const { permissions } = req.body;

      if (!Array.isArray(permissions)) return res.status(400).json({ status: 'failed', message: 'permissions must be an array' });

      const updated = await adminService.updateAdminPermissions(actingAdmin?._id || "", permissions);

      res.status(200).json({
        status: 'success',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin activity logs
   */
  static async getAdminActivityLogs(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;

      checkPermission(admin!, 'view_reports', { throwOnFail: true });

      const { page, limit } = parsePageLimit(req.query);

      const logs = await adminService.getAdminActivityLogs(admin?._id || undefined, page, limit);

      res.status(200).json({
        status: 'success',
        data: logs
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: savings portfolio statistics
   */
  static async getSavingsStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_savings', { throwOnFail: true });

      const stats = await SavingsService.getAdminSavingsStats();

      res.status(200).json({
        status: 'success',
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: list savings by category
   */
  static async getSavingsByCategory(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_savings', { throwOnFail: true });

      const category = req.query.category as 'active' | 'matured' | 'withdrawn' | undefined;
      const { page, limit } = parsePageLimit(req.query);

      const result = await SavingsService.getSavingsByCategory(category, page, limit);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List users (admin)
   */
  static async getUsers(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_users', { throwOnFail: true });

      const { status, search } = req.query;

      // optional debug left intact from original
      console.log({ status, search });

      const { page, limit } = parsePageLimit(req.query);

      const result = await adminService.listAllUsers(admin?._id || "", page, limit, status as string, search as string);

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get settings
   */
  static async getSettings(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "manage_settings", { throwOnFail: true });

      const settings = await SettingsService.getSettings();

      res.status(200).json({
        status: 'success',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update settings
   */
  static async updateSettings(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "manage_settings", { throwOnFail: true });

      const settings = await SettingsService.updateSettings(
        admin?._id || "",
        req.body
      );

      res.status(200).json({
        status: 'success',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Calculate profit (no permission check by request)
   */
  static async calculateProfit(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { category, action, amount } = req.query

      const settings = await SettingsService.calculateProfit(
        category as "bill-payment" | "transfer" | "loan" | "savings" | "escrow",
        action as "send" | "receive",
        Number(amount)
      );

      res.status(200).json({
        status: 'success',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get profit config (no permission check by request)
   */
  static async getProfitConfig(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { category } = req.body;

      const settings = await SettingsService.getProfitConfig(
        category as "bill-payment" | "transfer" | "loan" | "savings" | "escrow",
      );

      res.status(200).json({
        status: 'success',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;

      const admin = await UserService.findByEmail(email);

      if (!admin || admin.role !== "admin") {
        throw new UnauthorizedError("Access denied");
      }

      const result = await UserService.login(email, password);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user profile
   */
  static async profile(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { admin } = req;

      if (!admin || admin.role !== "admin") {
        throw new UnauthorizedError("Access denied");
      }

      const user = await UserService.getUser(admin!._id);

      res.status(200).json({
        status: "success",
        data: admin,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user fields
   */
  static async update(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { admin } = req;
      const { field, value } = req.body;

      if (!admin || admin.role !== "admin") {
        throw new UnauthorizedError("Access denied");
      }

      const updatedUser = await UserService.update(admin!._id, field, value);

      res.status(200).json({
        status: "success",
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Initiate password or pin reset (sends OTP)
   */
  static async initiateReset(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, type } = req.body;

      const userService = new UserService();

      const admin = await UserService.findByEmail(email);

      if (!admin || admin.role !== "admin") {
        throw new UnauthorizedError("Access denied");
      }

      const result = await userService.initiateReset(email, type);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
     * Update password or pin after validation
  */
  static async updatePasswordOrPin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, newPassword, newPin } = req.body;

      const admin = await UserService.findByEmail(email);

      if (!admin || admin.role !== "admin") {
        throw new UnauthorizedError("Access denied");
      }

      const userService = new UserService();
      const result = await userService.updatePasswordOrPin(email, newPassword, newPin);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate reset OTP
   */
  static async validateReset(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, pin } = req.body;

      const userService = new UserService();

      const admin = await UserService.findByEmail(email);

      if (!admin || admin.role !== "admin") {
        throw new UnauthorizedError("Access denied");
      }

      const result = await userService.validateReset(email, pin);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Change password for logged-in user
   */
  static async changePassword(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { admin } = req;

      if(!admin) {
        throw new UnauthorizedError("Access denied");
      }

      const { oldPassword, newPassword } = req.body;
      const userService = new UserService();
      const result = await userService.changePassword(req.admin!._id, oldPassword, newPassword);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default AdminController;
