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
        originator_bank: "VFD - Prime Loan",
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
   * Generate and download a professional PDF compliance report for VFD
   */
  static async downloadComplianceReport(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, 'view_reports', { throwOnFail: true });

      const { from, to, targetCompany = 'VFD Tech' } = req.query;
      if (!from || !to) {
        return res.status(400).json({ status: 'failed', message: 'from and to dates are required' });
      }

      const startDate = new Date(String(from));
      const endDate = new Date(String(to));
      const users = await adminService.getComplianceUsers(startDate, endDate);

      // Lazy import pdfmake to avoid startup overhead
      const PdfPrinter: any = require('pdfmake/js/Printer.js').default;
      
      const fonts = {
        Helvetica: {
          normal: 'Helvetica',
          bold: 'Helvetica-Bold',
          italics: 'Helvetica-Oblique',
          bolditalics: 'Helvetica-BoldOblique'
        }
      };

      const urlResolver = {
        resolve: () => {},
        resolved: async () => {}
      };
      const printer = new PdfPrinter(fonts, null, urlResolver);

      const docDefinition: any = {
        content: [
          { text: 'PRIME FINANCE', style: 'header' },
          { text: 'Customer Onboarding Compliance Packet', style: 'subheader' },
          { text: '\n' },
          {
            columns: [
              {
                text: [
                  { text: 'Prepared for: ', bold: true, color: '#1B5E20' },
                  { text: `${targetCompany}\n` },
                  { text: 'Date Range: ', bold: true, color: '#1B5E20' },
                  { text: `${startDate.toDateString()} - ${endDate.toDateString()}\n` }
                ]
              },
              {
                text: [
                  { text: 'Generated on: ', bold: true, color: '#1B5E20' },
                  { text: `${new Date().toLocaleString()}\n` },
                  { text: 'Total Users: ', bold: true, color: '#1B5E20' },
                  { text: `${users.length}\n` }
                ],
                alignment: 'right'
              }
            ]
          },
          { text: '\n\n' },
          ...users.map((u, i) => ({
            unbreakable: true,
            margin: [0, 0, 0, 15],
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    fillColor: '#F1F8E9',
                    stack: [
                      { text: `${i + 1}. ${u.user_metadata?.first_name || ''} ${u.user_metadata?.surname || ''}`, style: 'cardTitle' },
                      {
                        columns: [
                          { text: [{ text: 'Email:\n', style: 'label' }, u.email] },
                          { text: [{ text: 'Phone:\n', style: 'label' }, u.user_metadata?.phone || 'N/A'] },
                          { text: [{ text: 'Date Joined:\n', style: 'label' }, new Date(u.created_at).toLocaleDateString()] }
                        ],
                        margin: [0, 0, 0, 8]
                      },
                      {
                        columns: [
                          { text: [{ text: 'BVN:\n', style: 'label' }, u.user_metadata?.bvn || 'N/A'] },
                          { text: [{ text: 'NIN:\n', style: 'label' }, u.user_metadata?.nin || 'N/A'] },
                          { text: '' } // empty column for alignment
                        ]
                      }
                    ]
                  }
                ]
              ]
            },
            layout: {
              defaultBorder: false,
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              hLineColor: () => '#C8E6C9',
              vLineColor: () => '#C8E6C9',
              paddingLeft: () => 15,
              paddingRight: () => 15,
              paddingTop: () => 15,
              paddingBottom: () => 15
            }
          })),
          { text: '\n\n' },
          { text: 'Declaration', style: 'subheader2' },
          {
            text: 'I hereby certify that the above list represents all customers onboarded within the specified period and that all KYC documentation has been verified in accordance with regulatory requirements.',
            style: 'small',
            margin: [0, 5, 0, 15]
          },
          {
            columns: [
              { text: '__________________________\nCompliance Officer Signature', style: 'small' },
              { text: '__________________________\nDate', style: 'small', alignment: 'right' }
            ]
          }
        ],
        footer: (currentPage: number, pageCount: number) => {
          return { text: `Page ${currentPage} of ${pageCount}`, alignment: 'center', style: 'footer' };
        },
        defaultStyle: {
          font: 'Helvetica',
          color: '#333333'
        },
        styles: {
          header: { fontSize: 24, bold: true, color: '#1B5E20' },
          subheader: { fontSize: 16, bold: true, color: '#4CAF50', marginBottom: 10 },
          subheader2: { fontSize: 14, bold: true, color: '#2E7D32' },
          cardTitle: { fontSize: 13, bold: true, color: '#2E7D32', marginBottom: 10 },
          label: { fontSize: 10, bold: true, color: '#388E3C' },
          small: { fontSize: 10, color: '#555555' },
          footer: { fontSize: 9, color: '#9E9E9E' }
        }
      };
      const pdfDoc = await printer.createPdfKitDocument(docDefinition);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=Compliance_Report_${startDate.toISOString().split('T')[0]}.pdf`);
      
      pdfDoc.pipe(res);
      pdfDoc.end();

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
   * Bill Payment aggregated stats (admin dashboard widgets)
   * GET /admin/billpayment/stats
   */
  static async getBillPaymentStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "manage_bill_payments", { throwOnFail: true });

      // Aggregate bill payments
      const [billAgg, profitAgg] = await Promise.all([
        BillPayment.aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    totalCount: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    completedCount: {
                      $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] }
                    },
                    completedAmount: {
                      $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, '$amount', 0] }
                    }
                  }
                }
              ],
              byServiceType: [
                {
                  $group: {
                    _id: '$serviceType',
                    count: { $sum: 1 },
                    amount: { $sum: '$amount' }
                  }
                },
                { $sort: { amount: -1 } }
              ],
              byStatus: [
                {
                  $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    amount: { $sum: '$amount' }
                  }
                }
              ]
            }
          }
        ]),
        // Profit from bill payments
        (await import('../profits/profits.model')).default.aggregate([
          { $match: { source: 'bill-payment' } },
          { $group: { _id: null, totalProfit: { $sum: '$amount' } } }
        ])
      ]);

      const totals = billAgg[0]?.totals?.[0] || { totalCount: 0, totalAmount: 0, completedCount: 0, completedAmount: 0 };
      const totalProfit = profitAgg[0]?.totalProfit || 0;
      const byServiceType: Record<string, { count: number; amount: number }> = {};
      for (const entry of billAgg[0]?.byServiceType || []) {
        byServiceType[entry._id || 'unknown'] = { count: entry.count, amount: entry.amount };
      }
      const byStatus: Record<string, { count: number; amount: number }> = {};
      for (const entry of billAgg[0]?.byStatus || []) {
        byStatus[entry._id || 'unknown'] = { count: entry.count, amount: entry.amount };
      }

      res.status(200).json({
        status: 'success',
        data: {
          ...totals,
          totalProfit,
          byServiceType,
          byStatus
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Transaction aggregated stats (admin dashboard widgets)
   * GET /admin/transactions/stats
   */
  static async getTransactionStats(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const admin = req.admin;
      checkPermission(admin!, "manage_transactions", { throwOnFail: true });

      const [transferAgg, profitAgg] = await Promise.all([
        Transfer.aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    totalCount: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                  }
                }
              ],
              byTransferType: [
                {
                  $group: {
                    _id: '$transferType',
                    count: { $sum: 1 },
                    amount: { $sum: '$amount' }
                  }
                }
              ],
              byStatus: [
                {
                  $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    amount: { $sum: '$amount' }
                  }
                }
              ]
            }
          }
        ]),
        // Profit from transactions
        (await import('../profits/profits.model')).default.aggregate([
          { $match: { source: 'transaction' } },
          { $group: { _id: null, totalProfit: { $sum: '$amount' } } }
        ])
      ]);

      const totals = transferAgg[0]?.totals?.[0] || { totalCount: 0, totalAmount: 0 };
      const totalProfit = profitAgg[0]?.totalProfit || 0;

      const byTransferType: Record<string, { count: number; amount: number }> = {};
      for (const entry of transferAgg[0]?.byTransferType || []) {
        byTransferType[entry._id || 'unknown'] = { count: entry.count, amount: entry.amount };
      }

      const byStatus: Record<string, { count: number; amount: number }> = {};
      for (const entry of transferAgg[0]?.byStatus || []) {
        byStatus[entry._id || 'unknown'] = { count: entry.count, amount: entry.amount };
      }

      res.status(200).json({
        status: 'success',
        data: {
          ...totals,
          totalProfit,
          inward: byTransferType['inter'] || { count: 0, amount: 0 },
          outward: byTransferType['intra'] || { count: 0, amount: 0 },
          byTransferType,
          byStatus
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

  private static async buildNotificationQueryMatch(category: any, search: any): Promise<any> {
    const userMatch: any = { status: 'active', role: 'user' };

    // Apply Search Filtering via native regex
    if (search && typeof search === 'string') {
      const regex = new RegExp(search, 'i');
      userMatch.$or = [
        { 'user_metadata.first_name': regex },
        { 'user_metadata.surname': regex },
        { email: regex },
        { 'user_metadata.phone': regex }
      ];
    }

    // Filter by category
    if (category === 'active_loans') {
      const loans = await Loan.find({ status: 'accepted', loan_payment_status: { $in: ['not-started', 'in-progress'] } }).distinct('userId');
      userMatch._id = { $in: loans };
    } else if (category === 'overdue_loans') {
      const now = new Date();
      const loans = await Loan.find({
        status: 'accepted',
        loan_payment_status: { $in: ['not-started', 'in-progress'] },
        $expr: { $lt: [{ $toDate: "$repayment_date" }, now] }
      }).distinct('userId');
      userMatch._id = { $in: loans };
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
      userMatch._id = { $in: loans };
    } else if (category === 'active_savings') {
      const plans = await SavingsPlan.find({ status: 'ACTIVE' }).distinct('userId');
      userMatch._id = { $in: plans };
    } else if (category === 'active_escrow') {
      try {
        const escrows = await Escrow.find({ status: { $in: ['pending', 'funded', 'in_progress', 'disputed'] } });
        const userIds = [...new Set(escrows.flatMap((e: any) => [e.buyerId, e.sellerId]).filter(Boolean))];
        userMatch._id = { $in: userIds };
      } catch (e) {
        // Ignore
      }
    } else if (category !== 'all') {
      return null; // Signals unknown category
    }

    return userMatch;
  }

  /**
   * Fetch users for push notifications
   */
  static async getNotificationRecipients(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      checkPermission(req.admin!, 'manage_users', { throwOnFail: true });
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const skip = (page - 1) * limit;
      const { category, search } = req.query;

      const userMatch = await AdminController.buildNotificationQueryMatch(category, search);
      
      if (!userMatch) {
        // Fallback for unknown categories, return empty
        return res.json({ status: 'success', data: { data: [], total: 0, page, pages: 0 } });
      }

      const [users, total] = await Promise.all([
        User.find(userMatch)
          .select('email user_metadata.first_name user_metadata.surname user_metadata.phone')
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(userMatch)
      ]);

      const formatted = users.map(u => ({
        id: u._id,
        email: u.email,
        name: `${u.user_metadata?.first_name || ''} ${u.user_metadata?.surname || ''}`.trim(),
        phone: u.user_metadata?.phone
      }));

      res.json({
        status: 'success',
        data: {
          data: formatted,
          total,
          page,
          pages: Math.ceil(total / limit)
        }
      });
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
      const { userIds, channels, subject, message, targetType, category, search } = req.body;
      
      if (!channels || !message || !targetType) {
        throw new Error('Invalid payload: channels, message, and targetType are required.');
      }

      let users: any[] = [];

      if (targetType === 'query') {
        // Query-based targeting (ignore userIds array, pull dynamically on the server)
        const userMatch = await AdminController.buildNotificationQueryMatch(category, search);
        if (userMatch) {
          users = await User.find(userMatch).select('email user_metadata.phone').lean();
        }
      } else if (targetType === 'selected') {
        // Array-based targeting (use the provided userIds array)
        if (!userIds || !Array.isArray(userIds)) throw new Error('userIds array required for selected targeting.');
        users = await User.find({ _id: { $in: userIds } }).select('email user_metadata.phone').lean();
      } else {
        throw new Error('Invalid targetType. Use "query" or "selected"');
      }
      const emails = users.map((u: any) => u.email).filter(Boolean);
      const phones = users.map((u: any) => u.user_metadata?.phone).filter(Boolean);

      const { NotificationService } = require('../notifications/notification.service');

      const results: { channel: string; attempted: number; succeeded: number; failed: number; errors: string[] }[] = [];

      // Email broadcast
      if (channels.includes('email') && emails.length > 0) {
        try {
          await NotificationService.sendBulkEmail(emails, subject || 'Notification', message);
          results.push({ channel: 'email', attempted: emails.length, succeeded: emails.length, failed: 0, errors: [] });
        } catch (err: any) {
          console.error('Email broadcast failed:', err.message);
          results.push({ channel: 'email', attempted: emails.length, succeeded: 0, failed: emails.length, errors: [err.message] });
        }
      }

      // SMS broadcast — use Promise.allSettled to track each SMS
      if (channels.includes('sms') && phones.length > 0) {
        const smsResults = await Promise.allSettled(
          phones.map((phone: string) => NotificationService.sendActionSms(phone, message))
        );
        const succeeded = smsResults.filter(r => r.status === 'fulfilled').length;
        const failed = smsResults.filter(r => r.status === 'rejected').length;
        const errors = smsResults
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(r => r.reason?.message || 'Unknown SMS error')
          .slice(0, 5); // Limit error samples
        results.push({ channel: 'sms', attempted: phones.length, succeeded, failed, errors });
      }

      // Voice call broadcast — use Promise.allSettled to track each call
      if (channels.includes('call') && phones.length > 0) {
        const callResults = await Promise.allSettled(
          phones.map((phone: string) => NotificationService.sendVoiceCall(phone, message))
        );
        const succeeded = callResults.filter(r => r.status === 'fulfilled').length;
        const failed = callResults.filter(r => r.status === 'rejected').length;
        const errors = callResults
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(r => r.reason?.message || 'Unknown call error')
          .slice(0, 5);
        results.push({ channel: 'call', attempted: phones.length, succeeded, failed, errors });
      }

      const totalAttempted = results.reduce((sum, r) => sum + r.attempted, 0);
      const totalSucceeded = results.reduce((sum, r) => sum + r.succeeded, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      res.json({
        status: 'success',
        message: `Broadcast completed: ${totalSucceeded}/${totalAttempted} messages sent successfully`,
        data: {
          totalRecipients: users.length,
          totalAttempted,
          totalSucceeded,
          totalFailed,
          channels: results
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

export default AdminController;
