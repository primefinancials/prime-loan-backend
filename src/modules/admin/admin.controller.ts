/**
 * Admin Controller - Administrative operations and reporting
 * Provides admin tools for reconciliation, manual reviews, account management, and profit reporting
 */
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
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
import { Settings } from './settings.model';
import BillPaymentService from '../bill-payments/bill.payment.service';
import { WorkerControlService } from '../workers/worker-control.service';
import User from '../users/user.model';
import Loan from '../loans/loan.model';
import { SavingsPlan } from '../savings/savings.plan.model';
import { EscrowTransaction as Escrow } from '../escrow/escrow.model';

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

      const results = await adminService.bulkLoanAction(loanIds, action, String(admin!._id as any), reason);

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

      const { adminId } = req.params;
      const { permissions } = req.body;

      if (!Array.isArray(permissions)) return res.status(400).json({ status: 'failed', message: 'permissions must be an array' });

      const updated = await adminService.updateAdminPermissions(adminId || "", permissions);

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

      const logs = await adminService.getAdminActivityLogs(admin?._id as any || undefined, page, limit);

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
   * Admin: Get savings configuration
   */
  static async getSavingsSettings(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_settings', { throwOnFail: true });

      const settings = await SettingsService.getSettings();

      res.status(200).json({
        status: 'success',
        data: settings.savings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Update savings configuration
   */
  static async updateSavingsSettings(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_settings', { throwOnFail: true });

      // Expecting partial savings config in body
      const updates = req.body;

      // We need to merge with existing settings or SettingsService.updateSettings handles partial updates at root level?
      // updateSettings signature: updateSettings(adminId, updates: Partial<ISettings>)
      // So we should pass { savings: updates } or { savings: mergedSavings }

      // Ideally we fetch first to merge deep if needed, but Mongoose/Mongo updates might overwrite nested objects if not careful.
      // Let's assume the frontend sends the structure it wants to save for 'savings' key.
      // Ideally should validate 'updates' structure.

      const currentSettings = await SettingsService.getSettings();
      const currentSavings = currentSettings.savings || {};

      // Deep merge or spread (simplistic)
      // Assuming frontend sends the full savings object or we want to overwrite the specific keys provided
      // For safer updates, we might want to merge.
      // Let's rely on Mongoose to handle update if we pass { savings: ... }
      // But updateSettings uses findOneAndUpdate...

      // Let's construct the update object.
      // If we pass { savings: req.body }, it might replace the whole savings object if not using $set with dot notation?
      // But SettingsService.updateSettings does: { ...updates ... } in findOneAndUpdate.
      // Mongoose replace logic applies.

      // Better to fetch, merge in code, and save? Or rely on Service.
      // For now, let's assume we pass { savings: req.body } and careful frontend.

      // Wait, let's do a basic merge here to be safe
      const mergedSavings = { ...currentSavings, ...updates };

      const settings = await SettingsService.updateSettings(
        admin?._id as any || "",
        { savings: mergedSavings }
      );

      res.status(200).json({
        status: 'success',
        data: settings.savings
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
   * Admin: manually disburse a pending withdrawal
   */
  static async disburseSavingsWithdrawal(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_savings', { throwOnFail: true });

      const { planId, traceId } = req.params;

      const result = await SavingsService.adminDisburseWithdrawal(planId, traceId, admin?._id as any || "");

      res.status(200).json({
        status: 'success',
        message: 'Withdrawal disbursed successfully',
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

      const result = await adminService.listAllUsers(admin?._id as any || "", page, limit, status as string, search as string);

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
        admin?._id as any || "",
        req.body
      );

      // If worker configs were updated, dynamically restart active workers to apply changes
      if (req.body.workersConfig || req.body.defaulterCallConfig) {
        const statuses = await WorkerControlService.getStatuses();
        for (const status of statuses) {
          if (status.isRunning) {
            // Restart in background to not block response
            WorkerControlService.restart(status.name).catch(console.error);
          }
        }
      }

      res.status(200).json({
        status: 'success',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  // ───────────────────────────────────────────
  // Fee Management CRUD
  // ───────────────────────────────────────────

  /**
   * Get all fee configurations grouped by category
   */
  static async getFeeConfig(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_settings', { throwOnFail: true });

      // Use raw MongoDB query to detect entries truly missing _id in DB
      // (Mongoose auto-generates _id in memory with { _id: true } schema option,
      // making the hydrated document unreliable for detecting missing _ids)
      const rawDoc = await Settings.collection.findOne({ singleton: 'singleton' });
      if (rawDoc && rawDoc.profitRange) {
        let needsUpdate = false;
        const updatedRange = rawDoc.profitRange.map((f: any) => {
          if (!f._id) {
            f._id = new mongoose.Types.ObjectId();
            needsUpdate = true;
          }
          return f;
        });
        if (needsUpdate) {
          await Settings.collection.updateOne(
            { singleton: 'singleton' },
            { $set: { profitRange: updatedRange } }
          );
        }
      }

      // Now load via Mongoose — _ids are guaranteed to exist in DB
      const settings = await SettingsService.getSettings();
      const fees = settings.profitRange || [];

      // Group by category
      const grouped: Record<string, any[]> = {};
      for (const fee of fees) {
        const cat = fee.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(fee);
      }

      res.status(200).json({
        status: 'success',
        data: {
          fees,
          grouped
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add a new fee entry to profitRange
   */
  static async addFeeEntry(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_settings', { throwOnFail: true });

      const { category, type, amount, minAmount, maxAmount, action, description } = req.body;

      if (!category || !type || amount === undefined || !description) {
        return res.status(400).json({ status: 'error', message: 'category, type, amount, and description are required' });
      }

      const settings = await SettingsService.getSettings();
      const newEntry = {
        category,
        type,
        amount: Number(amount),
        minAmount: Number(minAmount || 0),
        maxAmount: Number(maxAmount || 10000000),
        action: action || 'send',
        description
      };

      settings.profitRange.push(newEntry as any);
      settings.updatedBy = admin?._id as any || '';
      await settings.save();

      res.status(201).json({
        status: 'success',
        data: settings.profitRange
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a fee entry by its _id
   */
  static async updateFeeEntry(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_settings', { throwOnFail: true });

      const { id } = req.params;
      const updates = req.body;

      const settings = await SettingsService.getSettings();

      // Debug: log the incoming id and available ids
      console.log('[updateFeeEntry] Looking for id:', id);
      console.log('[updateFeeEntry] Available ids:', settings.profitRange.map((f: any) => ({ _id: f._id?.toString(), desc: f.description })));

      // Try multiple lookup strategies
      let entry: any = null;

      // 1. Try Mongoose subdoc .id() (may throw on invalid ObjectId)
      try {
        entry = (settings.profitRange as any).id(id);
      } catch (e) {
        // .id() throws if id is not a valid ObjectId format
      }

      // 2. Fallback: compare _id.toString()
      if (!entry) {
        entry = settings.profitRange.find((f: any) => f._id && f._id.toString() === id);
      }

      // 3. Fallback: compare String(f._id)
      if (!entry) {
        entry = settings.profitRange.find((f: any) => String(f?._id || f.id) === String(id));
      }

      if (!entry) {
        return res.status(404).json({ status: 'error', message: 'Fee entry not found', debug: { lookingFor: id, available: settings.profitRange.map((f: any) => f._id?.toString()) } });
      }

      // Update allowed fields
      if (updates.description !== undefined) entry.description = updates.description;
      if (updates.type !== undefined) entry.type = updates.type;
      if (updates.amount !== undefined) entry.amount = Number(updates.amount);
      if (updates.minAmount !== undefined) entry.minAmount = Number(updates.minAmount);
      if (updates.maxAmount !== undefined) entry.maxAmount = Number(updates.maxAmount);
      if (updates.action !== undefined) entry.action = updates.action;
      if (updates.category !== undefined) entry.category = updates.category;

      settings.updatedBy = admin?._id as any || '';
      settings.markModified('profitRange');
      await settings.save();

      res.status(200).json({
        status: 'success',
        data: settings.profitRange
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a fee entry by its _id
   */
  static async deleteFeeEntry(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'manage_settings', { throwOnFail: true });

      const { id } = req.params;

      const settings = await SettingsService.getSettings();

      // Try Mongoose subdoc .id() first, fallback to manual find
      let entry = (settings.profitRange as any).id(id);
      if (!entry) {
        entry = settings.profitRange.find((f: any) => String(f._id) === id);
      }

      if (!entry) {
        return res.status(404).json({ status: 'error', message: 'Fee entry not found' });
      }

      // Remove the entry
      if (typeof entry.deleteOne === 'function') {
        entry.deleteOne();
      } else {
        settings.profitRange = settings.profitRange.filter((f: any) => String(f._id) !== id) as any;
      }

      settings.updatedBy = admin?._id as any || '';
      settings.markModified('profitRange');
      await settings.save();

      res.status(200).json({
        status: 'success',
        data: settings.profitRange
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
        category as "bill-payment" | "transfer" | "loan" | "savings" | "escrow" | "marketplace",
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
      const { category } = req.query;

      const settings = await SettingsService.getProfitConfig(
        category as "bill-payment" | "transfer" | "loan" | "savings" | "escrow" | "marketplace",
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

      const user = await UserService.getUser(admin!._id as any);

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

      const updatedUser = await UserService.update(admin!._id as any, field, value);

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

      if (!admin) {
        throw new UnauthorizedError("Access denied");
      }

      const { oldPassword, newPassword } = req.body;
      const userService = new UserService();
      const result = await userService.changePassword(req.admin!._id as any, oldPassword, newPassword);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetch users for push notifications
   */
  static async getNotificationRecipients(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      checkPermission(req.admin!, 'manage_users', { throwOnFail: true });
      const { category } = req.query;
      let users: any[] = [];

      if (category === 'all') {
        users = await User.find({ role: 'user', status: 'active' })
          .select('email user_metadata.first_name user_metadata.surname user_metadata.phone')
          .lean();
      } else if (category === 'active_loans') {
        const loans = await Loan.find({ status: 'accepted', loan_payment_status: { $in: ['not-started', 'in-progress'] } }).distinct('userId');
        users = await User.find({ _id: { $in: loans } }).select('email user_metadata.first_name user_metadata.surname user_metadata.phone').lean();
      } else if (category === 'overdue_loans') {
        const now = new Date();
        const loans = await Loan.find({
          status: 'accepted',
          loan_payment_status: { $in: ['not-started', 'in-progress'] },
          $expr: { $lt: [{ $toDate: "$repayment_date" }, now] }
        }).distinct('userId');
        users = await User.find({ _id: { $in: loans } }).select('email user_metadata.first_name user_metadata.surname user_metadata.phone').lean();
      } else if (category === 'due_loans') {
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const loans = await Loan.find({
          status: 'accepted',
          loan_payment_status: { $in: ['not-started', 'in-progress'] },
          $expr: {
            $and: [
              { $gte: [{ $toDate: "$repayment_date" }, today] },
              { $lt: [{ $toDate: "$repayment_date" }, tomorrow] }
            ]
          }
        }).distinct('userId');
        users = await User.find({ _id: { $in: loans } }).select('email user_metadata.first_name user_metadata.surname user_metadata.phone').lean();
      } else if (category === 'active_savings') {
        const plans = await SavingsPlan.find({ status: 'ACTIVE' }).distinct('userId');
        users = await User.find({ _id: { $in: plans } }).select('email user_metadata.first_name user_metadata.surname user_metadata.phone').lean();
      } else if (category === 'active_escrow') {
        try {
          const escrows = await Escrow.find({ status: { $in: ['pending', 'funded', 'in_progress', 'disputed'] } });
          const userIds = [...new Set(escrows.flatMap((e: any) => [e.buyerId, e.sellerId]).filter(Boolean))];
          users = await User.find({ _id: { $in: userIds } }).select('email user_metadata.first_name user_metadata.surname user_metadata.phone').lean();
        } catch (e) {
          // Ignore if Escrow is not loaded
        }
      }

      const formatted = users.map(u => ({
        id: u._id,
        email: u.email,
        name: `${u.user_metadata?.first_name || ''} ${u.user_metadata?.surname || ''}`.trim(),
        phone: u.user_metadata?.phone
      }));

      res.json({ status: 'success', data: formatted });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Broadcast messages to subsets of users
   */
  static async sendBroadcast(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      checkPermission(req.admin!, 'manage_users', { throwOnFail: true });
      const { userIds, channels, subject, message } = req.body;
      if (!userIds || !Array.isArray(userIds) || !channels || !message) {
        throw new Error('Invalid payload');
      }

      const users = await User.find({ _id: { $in: userIds } }).lean();
      const emails = users.map((u: any) => u.email).filter(Boolean);
      const phones = users.map((u: any) => u.user_metadata?.phone).filter(Boolean);

      const { NotificationService } = require('../notifications/notification.service');

      if (channels.includes('email') && emails.length > 0) {
        NotificationService.sendBulkEmail(emails, subject || 'Notification', message).catch(console.error);
      }
      if (channels.includes('sms') && phones.length > 0) {
        phones.forEach((phone: any) => NotificationService.sendActionSms(phone, message));
      }
      if (channels.includes('call') && phones.length > 0) {
        phones.forEach((phone: any) => NotificationService.sendVoiceCall(phone, message));
      }

      res.json({ status: 'success', message: 'Broadcast initiated successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export default AdminController;
