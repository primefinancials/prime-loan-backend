/**
 * admin.service.merged.ts
 * Merged & optimized AdminService (TypeScript)
 * - Consolidates features from the provided AdminService and EnhancedAdminService
 * - Uses defensive checks, lean() where possible, clear errors and small performance improvements
 * - TODOs left intentionally: Redis + worker health checks, transactional guarantees depending on LoanService internals
 */

import { encryptPassword } from "../../shared/utils/passwordUtils";
import { VfdProvider } from "../../shared/providers/vfd.provider";
import { NotificationService } from "../notifications/notification.service";
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError } from "../../exceptions";
import User from "../users/user.model";
import Loan from "../loans/loan.model";
import { Transfer } from "../transfers/transfer.model";
import { BillPayment } from "../bill-payments/bill-payment.model";
import { SavingsPlan } from "../savings/savings.plan.model";
import { LedgerEntry } from "../ledger/LedgerEntry.model";
import { getCurrentTimestamp } from "../../shared/utils/convertDate";
import { AdminPermission } from "../users/user.interface";
import { LoanService } from "../loans/loan.service";
import profitsModel from "../profits/profits.model";
import { profitService } from "../profits/profits.service";

export interface AdminStats {
  users: {
    total: number;
    active: number;
    inactive: number;
    newThisMonth: number;
  };
  loans: {
    total: number;
    pending: number;
    active: number;
    overdue: number;
    totalDisbursed: number;
    totalOutstanding: number;
  };
  transfers: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    totalVolume: number;
  };
  billPayments: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    totalVolume: number;
  };
  savings: {
    totalPlans: number;
    activePlans: number;
    totalPrincipal: number;
    totalInterestEarned: number;
  };
  revenue: {
    totalRevenue: number;
    loanInterest: number;
    billPaymentFees: number;
    transferFees: number;
    savingsPenalties: number;
  };
}

export interface SystemHealth {
  database: 'healthy' | 'degraded' | 'down';
  redis: 'healthy' | 'degraded' | 'down';
  providers: {
    vfd: 'healthy' | 'degraded' | 'down';
    clubConnect: 'healthy' | 'degraded' | 'down';
  };
  workers: {
    billPaymentsPoller: 'running' | 'stopped';
    transfersPoller: 'running' | 'stopped';
    loanPenalties: 'running' | 'stopped';
    savingsMaturities: 'running' | 'stopped';
  };
}

export class AdminService {
  private vfdProvider: VfdProvider;
  private notificationService: NotificationService;

  constructor(vfdProvider?: VfdProvider, notificationService?: NotificationService) {
    this.vfdProvider = vfdProvider ?? new VfdProvider();
    this.notificationService = notificationService ?? new NotificationService();
  }

  /**
   * Create admin account with role-based permissions and defensive duplicate checks
   */
  async createAdminAccount(req: {
    email: string;
    name: string;
    surname: string;
    password: string;
    phone: string;
    is_super_admin?: boolean;
    permissions?: AdminPermission[];
  }) {
    const { email, name, surname, password, phone, is_super_admin = false, permissions = [] } = req;

    // Defensive duplicate checks using indexed fields where possible
    const [duplicateEmail, duplicatePhone] = await Promise.all([
      User.findOne({ email }).lean(),
      User.findOne({ 'user_metadata.phone': phone }).lean()
    ]);

    if (duplicateEmail) {
      throw new ConflictError(`A user already exists with the email ${email}`);
    }
    if (duplicatePhone) {
      throw new ConflictError(`A user already exists with the phone number ${phone}`);
    }

    const encryptedPassword = encryptPassword(password);

    const defaultPermissions: AdminPermission[] = [
      'view_users',
      'view_loans',
      'view_transactions',
      'view_reports'
    ];

    const user = await User.create({
      password: encryptedPassword,
      user_metadata: {
        email,
        first_name: name,
        surname,
        phone
      },
      role: 'admin',
      confirmation_sent_at: getCurrentTimestamp(),
      confirmed_at: getCurrentTimestamp(),
      email,
      email_confirmed_at: getCurrentTimestamp(),
      is_anonymous: false,
      phone,
      is_super_admin,
      permissions: is_super_admin ? [] : (permissions.length > 0 ? permissions : defaultPermissions),
      status: 'active'
    });

    return user;
  }

  /**
   * Fetch a single admin (with status check)
   */
  async getAdmin(adminId: string) {
    const admin = await User.findById(adminId);
    if (!admin) throw new NotFoundError('No admin found');
    if (admin.status !== 'active') throw new UnauthorizedError('Account has been suspended! Contact super admin for revert action.');
    return admin;
  }

  async getAdmins() {
    const admin = await User.find({ role: "admin" });
    if (!admin) throw new NotFoundError('No admin found');
    
    return admin;
  }

  /**
   * Activate / Deactivate admin account
   */
  async activateAndDeactivateAdmin(req: { status: string; adminId: string }) {
    const { status, adminId } = req;
    const updated = await User.findByIdAndUpdate(adminId, { status }, { new: true });
    if (!updated) throw new NotFoundError('Admin not found');
    return updated;
  }

  /**
   * Activate / Deactivate user account
   */
  async activateAndDeactivateUser(req: { status: string; userId: string }) {
    const { status, userId } = req;
    const updated = await User.findByIdAndUpdate(userId, { status }, { new: true });
    if (!updated) throw new NotFoundError('User not found');
    return updated;
  }

  /**
   * Comprehensive admin dashboard statistics
   */
  async getDashboardStats(): Promise<AdminStats> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let filterActive: any = {};
    let filterOverdue: any = {};

    filterOverdue.status = "accepted";
    filterOverdue.loan_payment_status = { $in: ["in-progress", "not-started"] };
    filterOverdue.$expr = {
      $lt: [{ $toDate: "$repayment_date" }, now],
    };

    filterActive.status = "accepted";
    filterActive.loan_payment_status = { $in: ["in-progress", "not-started"] };
    filterActive.$expr = {
      $gt: [{ $toDate: "$repayment_date" }, now],
    };

    const [totalUsers, activeUsers, newUsersThisMonth] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', status: 'active' }),
      User.countDocuments({ role: 'user', createdAt: { $gte: startOfMonth } })
    ]);

    const [totalLoans, pendingLoans, activeLoans, overdueLoans] = await Promise.all([
      Loan.countDocuments(),
      Loan.countDocuments({ status: 'pending' }),
      Loan.countDocuments(filterActive),
      Loan.countDocuments(filterOverdue)
    ]);

    const loanAggregation = await Loan.aggregate([
      {
        $group: {
          _id: null,
          totalDisbursed: {
            $sum: {
              $cond: [{ $in: ['$status', ['accepted']] }, '$amount', 0]
            }
          },
          totalOutstanding: { $sum: '$outstanding' }
        }
      }
    ]);

    const [totalTransfers, pendingTransfers, completedTransfers, failedTransfers] = await Promise.all([
      Transfer.countDocuments(),
      Transfer.countDocuments({ status: 'PENDING' }),
      Transfer.countDocuments({ status: 'COMPLETED' }),
      Transfer.countDocuments({ status: 'FAILED' })
    ]);

    const transferVolumeAgg = await Transfer.aggregate([
      { $match: { status: 'COMPLETED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const [totalBillPayments, pendingBillPayments, completedBillPayments, failedBillPayments] = await Promise.all([
      BillPayment.countDocuments(),
      BillPayment.countDocuments({ status: 'PENDING' }),
      BillPayment.countDocuments({ status: 'COMPLETED' }),
      BillPayment.countDocuments({ status: 'FAILED' })
    ]);

    const billPaymentVolumeAgg = await BillPayment.aggregate([
      { $match: { status: 'COMPLETED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const [totalSavingsPlans, activeSavingsPlans] = await Promise.all([
      SavingsPlan.countDocuments(),
      SavingsPlan.countDocuments({ status: 'ACTIVE' })
    ]);

    const savingsAggregation = await SavingsPlan.aggregate([
      {
        $group: {
          _id: null,
          totalPrincipal: { $sum: '$principal' },
          totalInterestEarned: { $sum: '$interestEarned' }
        }
      }
    ]);

    const revenueAggregation = await profitsModel.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [ loanRevenue, billPaymentRevenue, transactionRevenue, savingsRevenue ] = await Promise.all([
      profitService.getTotalProfits({ source: "loan" }),
      profitService.getTotalProfits({ source: "bill-payment" }),
      profitService.getTotalProfits({ source: "transaction" }),
      profitService.getTotalProfits({ source: "savings" })
    ]);

    const safe = (v: any) => (typeof v === 'number' ? v : Number(v) || 0);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        newThisMonth: newUsersThisMonth
      },
      loans: {
        total: totalLoans,
        pending: pendingLoans,
        active: activeLoans,
        overdue: overdueLoans,
        totalDisbursed: loanAggregation[0]?.totalDisbursed || 0,
        totalOutstanding: loanAggregation[0]?.totalOutstanding || 0
      },
      transfers: {
        total: totalTransfers,
        pending: pendingTransfers,
        completed: completedTransfers,
        failed: failedTransfers,
        totalVolume: transferVolumeAgg[0]?.total || 0
      },
      billPayments: {
        total: totalBillPayments,
        pending: pendingBillPayments,
        completed: completedBillPayments,
        failed: failedBillPayments,
        totalVolume: billPaymentVolumeAgg[0]?.total || 0
      },
      savings: {
        totalPlans: totalSavingsPlans,
        activePlans: activeSavingsPlans,
        totalPrincipal: savingsAggregation[0]?.totalPrincipal || 0,
        totalInterestEarned: savingsAggregation[0]?.totalInterestEarned || 0
      },
      revenue: {
        totalRevenue: revenueAggregation[0]?.total || 0,
        loanInterest: loanRevenue?.total || 0,
        billPaymentFees: billPaymentRevenue?.total || 0,
        transferFees: transactionRevenue?.total || 0,
        savingsPenalties: savingsRevenue?.total || 0
      }
    };
  }

  /**
   * Simple system health checks (DB + VFD). Expand Redis/workers/Club Connect as needed.
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const health: SystemHealth = {
      database: 'healthy',
      redis: 'healthy',
      providers: {
        vfd: 'healthy',
        clubConnect: 'healthy'
      },
      workers: {
        billPaymentsPoller: 'running',
        transfersPoller: 'running',
        loanPenalties: 'running',
        savingsMaturities: 'running'
      }
    };

    try {
      await User.exists({});
    } catch (error) {
      health.database = 'down';
    }

    try {
      await this.vfdProvider.getPrimeAccountInfo();
    } catch (error) {
      health.providers.vfd = 'down';
    }

    // TODO: Add Redis health-check (ping) and worker status introspection

    return health;
  }

  async getTransactions(page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;

    const query: any = {};
    if (status) query.status = status;
    if (status) query.transferType = type;

    if (search) {
      const regex = new RegExp(search, "i"); // case-insensitive search
      query.$or = [
        { "traceId": regex },
        { "reference": regex },
        { "toAccount": regex },
        { "fromAccount": regex }
      ];
    }

    const transfers = await Transfer.find(query)
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();
    
    const total = await Transfer.countDocuments(query); 

    const userIds = transfers.map(p => p.userId);
    const users = await User.find({ _id: { $in: userIds } }, { email: 1, user_metadata: 1 });

    return {
      transfers,
      users,
      page,
      pages: Math.ceil(total / limit),
      total
    };
  }

  /**
   * Return flagged transfers and loans for manual review
   */
  async getFlaggedTransactions() {
    const flaggedTransfers = await Transfer.find({
      $or: [
        { status: 'PENDING', createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        { amount: { $gt: 1000000 } },
        { 'meta.flagged': true }
      ]
    })
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .sort({ createdAt: -1 })
      .lean();

    const flaggedBillPayments = await BillPayment.find({
      $or: [
        { status: 'PENDING', createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        { amount: { $gt: 50000 } },
        { 'meta.flagged': true }
      ]
    })
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .sort({ createdAt: -1 })
      .lean();

    const flaggedLoans = await Loan.find({
      $or: [
        { amount: { $gt: 200000 } },
        { 'credit_score.remarks': /suspicious/i },
        { status: 'pending', createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
      ]
    })
      .sort({ createdAt: -1 })
      .lean();

    return {
      transfers: flaggedTransfers,
      loans: flaggedLoans,
      billPayments: flaggedBillPayments
    };
  }

  /**
   * Bulk approve or reject loans. Uses LoanService — keeps operations sequential to avoid race conditions with downstream providers.
   */
  async bulkLoanAction(loanIds: string[], action: 'approve' | 'reject', adminId: string, reason?: string) {
    const results: Array<any> = [];

    for (const loanId of loanIds) {
      try {
        const foundLoan = await Loan.findById(loanId).lean();
        if (!foundLoan) {
          results.push({ loanId, status: 'error', message: 'Loan not found' });
          continue;
        }

        if (action === 'approve') {
          // Disburse via LoanService (implementation dependent)
          const thisLoan = await LoanService.getLoanById(loanId);
          const loan = await LoanService.disburseLoan({ adminId, loanId, amount: Number(thisLoan?.amount || 0) });
          results.push({ loanId, status: 'success', message: 'Loan approved and disbursed', loan });
        } else {
          const loan = await LoanService.rejectLoan(adminId, loanId, reason || 'Rejected by admin');
          results.push({ loanId, status: 'success', message: 'Loan rejected', loan });
        }
      } catch (error: any) {
        results.push({ loanId, status: 'failed', message: error?.message || String(error) });
      }
    }

    return results;
  }

  /**
   * Generate a business report for a period
   */
  async generateBusinessReport(startDate: Date, endDate: Date) {
    const dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };

    const newUsers = await User.countDocuments({ role: 'user', ...dateFilter });

    const loanMetrics = await Loan.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          approvedLoans: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
          rejectedLoans: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalDisbursed: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, '$amount', 0] } },
          totalRepaid: {
            $sum: {
              $subtract: [
                { $toDouble: "$amount" },
                { $toDouble: "$outstanding" }
              ]
            }
          }
        }
      }
    ]);

    const revenueBreakdown = await LedgerEntry.aggregate([
      {
        $match: {
          account: 'platform_revenue',
          entryType: 'CREDIT',
          status: 'COMPLETED',
          ...dateFilter
        }
      },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const [transferVolumes, billPaymentVolumes] = await Promise.all([
      Transfer.aggregate([{ $match: { status: 'COMPLETED', ...dateFilter } }, { $group: { _id: null, volume: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      BillPayment.aggregate([{ $match: { status: 'COMPLETED', ...dateFilter } }, { $group: { _id: null, volume: { $sum: '$amount' }, count: { $sum: 1 } } }])
    ]);

    return {
      period: { startDate, endDate },
      userAcquisition: { newUsers },
      loanPerformance: loanMetrics[0] || {},
      revenue: {
        breakdown: revenueBreakdown,
        total: (revenueBreakdown || []).reduce((sum: number, item: any) => sum + (item.total || 0), 0)
      },
      transactionVolumes: {
        transfers: transferVolumes[0] || { volume: 0, count: 0 },
        billPayments: billPaymentVolumes[0] || { volume: 0, count: 0 }
      }
    };
  }

  /**
   * Update admin permissions (super-admins are protected)
   */
  async updateAdminPermissions(adminId: string, permissions: AdminPermission[]) {
    const admin: any = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      throw new NotFoundError('Admin not found');
    }

    if (admin.is_super_admin) {
      throw new BadRequestError('Cannot modify super admin permissions');
    }

    admin.permissions = permissions;
    await admin.save();

    return admin;
  }

  /**
   * Placeholder for admin activity logs - implement audit collection elsewhere and query here
   */
  async getAdminActivityLogs(adminId?: string, page = 1, limit = 50) {
    const admin: any = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      throw new NotFoundError('Admin not found');
    }

    return {
      logs: [],
      total: 0,
      page,
      pages: 0
    };
  }

  async listAllUsers(
    adminId: string,
    page = 1,
    limit = 50,
    status?: string,
    search?: string
  ) {
    const admin: any = await User.findById(adminId);
    if (!admin || admin.role !== "admin") {
      throw new NotFoundError("Admin not found");
    }

    const query: any = { role: "user" };
    if (status) query.status = status;

    if (search) {
      const regex = new RegExp(search, "i"); // case-insensitive search
      query.$or = [
        { "user_metadata.first_name": regex },
        { "user_metadata.surname": regex },
        { email: regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$user_metadata.first_name", " ", "$user_metadata.surname"] },
              regex: search,
              options: "i",
            },
          },
        },
      ];
    }

    const users = await User.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    return { users, total, page, pages: Math.ceil(total / limit) };
  } 
}
