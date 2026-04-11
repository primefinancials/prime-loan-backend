// src/routes/admin.routes.ts
import express from "express";
import { AdminController } from "../modules/admin/admin.controller";
import { LoanController } from "../modules/loans/loan.controller";
import { SavingsController } from "../modules/savings/savings.controller";
import { profitController } from "../modules/profits/profits.controller";
import { WorkerController } from "../modules/workers/worker.controller";
import { EscrowController } from "../modules/escrow/escrow.controller";
import { MarketplaceController } from "../modules/marketplace/marketplace.controller";
import { ChatController } from "../modules/chat/chat.controller";
import {
   verifyJwtRest,
   validateReqBody,
   validateReqQuery
} from "../shared/middlewares";
import {
   createAdminAccountSchema,
   activateAdminReqBodySchema,
   activateUserReqBodySchema,
   getUsersQuerySchema,
   bulkLoanActionSchema,
   disburseLoanSchema,
   rejectLoanSchema,
   loanListQuerySchema,
   businessReportQuerySchema,
   profitReportQuerySchema,
   flaggedQuerySchema,
   updateAdminPermissionsSchema,
   activityLogsQuerySchema,
   changePasswordSchema,
   initiateResetSchema,
   updatePasswordOrPinSchema,
   updateUserSchema,
   validateResetSchema,
   loginSchema,
   transactionQuerySchema
} from "../validations";
import { idempotencyMiddleware } from "../shared/idempotency/middleware";

const router = express.Router();

/* =============================
   AUTHENTICATION & PROFILE
============================= */

router.post("/login", validateReqBody(loginSchema), AdminController.login as any);
router.get("/profile", verifyJwtRest(), AdminController.profile as any);
router.put("/update", verifyJwtRest(), validateReqBody(updateUserSchema), AdminController.update as any);
router.post("/change-password", verifyJwtRest(), validateReqBody(changePasswordSchema), AdminController.changePassword as any);
router.post("/reset/initiate", validateReqBody(initiateResetSchema), AdminController.initiateReset as any);
router.post("/reset/validate", validateReqBody(validateResetSchema), AdminController.validateReset as any);
router.post("/update-password-pin", validateReqBody(updatePasswordOrPinSchema), AdminController.updatePasswordOrPin as any);

/* =============================
   ADMIN MANAGEMENT
============================= */

router.post("/create", verifyJwtRest(), validateReqBody(createAdminAccountSchema), AdminController.createAdminAccount as any);
router.get("/:adminId([0-9a-fA-F]{24})", verifyJwtRest(), AdminController.getAdmin as any);
router.get("/admins", verifyJwtRest(), AdminController.getAdmins as any);

/* =============================
   NOTIFICATIONS
============================= */

router.get("/notifications/recipients", verifyJwtRest(), AdminController.getNotificationRecipients as any);
router.post("/notifications/broadcast", verifyJwtRest(), AdminController.sendBroadcast as any);
router.post("/activate", verifyJwtRest(), validateReqBody(activateAdminReqBodySchema), AdminController.activateAndDeactivateAdmin as any);
router.put("/:adminId([0-9a-fA-F]{24})/permissions", verifyJwtRest(), validateReqBody(updateAdminPermissionsSchema), AdminController.updateAdminPermissions as any);

/* =============================
   USER MANAGEMENT
============================= */

router.get("/users", verifyJwtRest(), validateReqQuery(getUsersQuerySchema), AdminController.getUsers as any);
router.post("/users/activate", verifyJwtRest(), validateReqBody(activateUserReqBodySchema), AdminController.activateAndDeactivateUser as any);

/* =============================
   LOAN MANAGEMENT
============================= */

router.get("/loans", verifyJwtRest(), validateReqQuery(loanListQuerySchema), LoanController.listAllLoans as any);
router.get("/loans/:id([0-9a-fA-F]{24})", verifyJwtRest(), LoanController.singleLoanHistory as any);
router.post("/loans/disburse", verifyJwtRest(), idempotencyMiddleware() as any, validateReqBody(disburseLoanSchema), LoanController.disburseLoan as any);
router.post("/loans/:id([0-9a-fA-F]{24})/reject", verifyJwtRest(), validateReqBody(rejectLoanSchema), LoanController.rejectLoan as any);
router.get("/loans/stats", verifyJwtRest(), LoanController.getAdminLoanStats as any);
router.get("/loans/category/:category", verifyJwtRest(), LoanController.getLoansByCategory as any);
router.post("/loans/bulk-action", verifyJwtRest(), validateReqBody(bulkLoanActionSchema), AdminController.bulkLoanAction as any);

/* =============================
   LOAN LADDER
============================= */

router.post("/ladder", verifyJwtRest(), LoanController.createLoanLadder as any);
router.put("/ladder/:id", verifyJwtRest(), LoanController.updateLoanLadder as any);
router.delete("/ladder/:id", verifyJwtRest(), LoanController.deleteLoanLadder as any);
router.get("/ladder", verifyJwtRest(), LoanController.getLoanLadders as any);
router.get("/ladder/:id", verifyJwtRest(), LoanController.getLoanLadderById as any);

/* =============================
   SAVINGS MANAGEMENT
============================= */

router.get("/savings/settings", verifyJwtRest(), AdminController.getSavingsSettings as any);
router.put("/savings/settings", verifyJwtRest(), AdminController.updateSavingsSettings as any);
router.get("/savings", verifyJwtRest(), SavingsController.getPlans as any);
router.get("/savings/stats", verifyJwtRest(), AdminController.getSavingsStats as any);
router.get("/savings/by-category", verifyJwtRest(), validateReqQuery(flaggedQuerySchema), AdminController.getSavingsByCategory as any);
router.post("/savings/:planId/withdrawals/:traceId/disburse", verifyJwtRest(), idempotencyMiddleware() as any, AdminController.disburseSavingsWithdrawal as any);

/* =============================
   DASHBOARD & REPORTS
============================= */

router.get("/dashboard", verifyJwtRest(), AdminController.getDashboardStats as any);
router.get("/system/health", verifyJwtRest(), AdminController.getSystemHealth as any);
router.get("/business-report", verifyJwtRest(), validateReqQuery(businessReportQuerySchema), AdminController.generateBusinessReport as any);
router.get("/profits", verifyJwtRest(), validateReqQuery(profitReportQuerySchema), AdminController.getProfitReport as any);

/* =============================
   TRANSACTIONS & RECONCILIATION
============================= */

router.get("/transactions", verifyJwtRest(), validateReqQuery(transactionQuerySchema), AdminController.getTransactions as any);
router.get("/transactions/stats", verifyJwtRest(), AdminController.getTransactionStats as any);
router.get("/transactions/:traceId([0-9a-fA-F]{24})", verifyJwtRest(), AdminController.getTransactionDetails as any);
router.get("/transactions/flagged", verifyJwtRest(), AdminController.getFlaggedTransactions as any);
router.get("/billpayment/all", verifyJwtRest(), validateReqQuery(transactionQuerySchema), AdminController.getBillPayment as any);
router.get("/billpayment/stats", verifyJwtRest(), AdminController.getBillPaymentStats as any);
router.post("/transfers/:id([0-9a-fA-F]{24})/requery", verifyJwtRest(), AdminController.requeryTransfer as any);
router.get("/reconciliation/inconsistencies", verifyJwtRest(), AdminController.getReconciliationInconsistencies as any);

/* =============================
   ACTIVITY LOGS
============================= */

router.get("/activity-logs", verifyJwtRest(), validateReqQuery(activityLogsQuerySchema), AdminController.getAdminActivityLogs as any);

/* =============================
   SETTINGS
============================= */

router.get("/settings", verifyJwtRest(), AdminController.getSettings as any);
router.put("/settings", verifyJwtRest(), AdminController.updateSettings as any);
router.get("/settings/calculate-profit", verifyJwtRest(), AdminController.calculateProfit as any);
router.get("/settings/profit-config", verifyJwtRest(), AdminController.getProfitConfig as any);

// Fee Management CRUD
router.get("/fees", verifyJwtRest(), AdminController.getFeeConfig as any);
router.post("/fees", verifyJwtRest(), AdminController.addFeeEntry as any);
router.put("/fees/:id", verifyJwtRest(), AdminController.updateFeeEntry as any);
router.delete("/fees/:id", verifyJwtRest(), AdminController.deleteFeeEntry as any);

/* =============================
   WORKER MANAGEMENT
============================= */
router.get("/workers", verifyJwtRest(), WorkerController.listWorkers as any);
router.get("/workers/:name/logs", verifyJwtRest(), WorkerController.getWorkerLogs as any);
router.post("/workers/:name/start", verifyJwtRest(), WorkerController.startWorker as any);
router.post("/workers/:name/stop", verifyJwtRest(), WorkerController.stopWorker as any);
router.post("/workers/:name/restart", verifyJwtRest(), WorkerController.restartWorker as any);

/* =============================
   ESCROW DISPUTES
============================= */
router.post("/escrow/:id/resolve", verifyJwtRest(), EscrowController.resolveDispute as any);

/* =============================
   CHAT MANAGEMENT
============================= */
router.get("/chat/:escrowId/history", verifyJwtRest(), ChatController.getHistory as any);
router.post("/chat/:escrowId/message", verifyJwtRest(), ChatController.sendMessage as any);
router.post("/chat/upload", verifyJwtRest(), ChatController.upload as any);

/* =============================
   MARKETPLACE MANAGEMENT
============================= */
// Marketplace Vendors
router.get("/marketplace/vendors/stats", verifyJwtRest(), MarketplaceController.getVendorDashboardStats as any);
router.get("/marketplace/vendors", verifyJwtRest(), MarketplaceController.listVendors as any);
router.get("/marketplace/vendors/:id", verifyJwtRest(), MarketplaceController.getVendorDetails as any); // Vendor Details
router.put("/marketplace/vendors/:id/approve", verifyJwtRest(), MarketplaceController.approveVendor as any);
router.put("/marketplace/vendors/:id/reject", verifyJwtRest(), MarketplaceController.rejectVendor as any);
router.put("/marketplace/vendors/:id/suspend", verifyJwtRest(), MarketplaceController.suspendVendor as any);
router.put("/marketplace/vendors/:id/reactivate", verifyJwtRest(), MarketplaceController.reactivateVendor as any);
router.get("/marketplace/vendors/:id/products", verifyJwtRest(), MarketplaceController.getVendorProducts as any); // Products by Vendor

// Admin Escrows (with vendor filter replaced/augmented by general adminGetEscrows)
router.get("/escrow/stats", verifyJwtRest(), EscrowController.adminGetEscrowStats as any);
router.get("/escrows", verifyJwtRest(), EscrowController.adminGetEscrows as any);

/* =============================
   PROFITS MANAGEMENT
============================= */

router.get("/profits/user/:userId", verifyJwtRest(), profitController.getUserProfits.bind(profitController) as any);
router.get("/profits/type", verifyJwtRest(), profitController.getProfitByType.bind(profitController) as any);
router.get("/profits/reference", verifyJwtRest(), profitController.getProfitByReference.bind(profitController) as any);
router.get("/profits/total", verifyJwtRest(), profitController.getTotalProfit.bind(profitController) as any);
router.patch("/profits/:reference/realize", verifyJwtRest(), profitController.markProfitAsRealized.bind(profitController) as any);

/* =============================
   INFLUENCER MANAGEMENT
============================= */
import { InfluencerController } from "../modules/influencer/influencer.controller";

router.get("/influencers", verifyJwtRest(), InfluencerController.listAll as any);
router.get("/influencers/stats", verifyJwtRest(), InfluencerController.getStats as any);
router.post("/influencers/process-payouts", verifyJwtRest(), InfluencerController.processPayouts as any);
router.get("/influencers/:id", verifyJwtRest(), InfluencerController.getById as any);
router.post("/influencers/:id/approve", verifyJwtRest(), InfluencerController.approve as any);
router.post("/influencers/:id/reject", verifyJwtRest(), InfluencerController.reject as any);

/* =============================
   MONO DEBIT LOGS
============================= */
import { MonoDebitLog } from "../modules/loans/mono-debit-log.model";

router.get("/mono-debit-logs", verifyJwtRest(), async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const filter: any = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      MonoDebitLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      MonoDebitLog.countDocuments(filter)
    ]);

    res.json({ status: 'success', data: { logs, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/* =============================
   V2 SETTINGS TOGGLES
============================= */
import { SettingsService } from "../modules/admin/settings.service";

router.put("/settings/bill-payment-provider", verifyJwtRest(), async (req: any, res: any) => {
  try {
    const adminId = req.admin._id || req.admin.id;
    const { provider } = req.body;
    if (!['flutterwave', 'paybeta'].includes(provider)) {
      return res.status(400).json({ status: 'error', message: 'Invalid provider. Use flutterwave or paybeta.' });
    }
    const settings = await SettingsService.updateSettings(adminId, { billPaymentProvider: provider });
    res.json({ status: 'success', data: { billPaymentProvider: settings.billPaymentProvider } });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.put("/settings/commissions", verifyJwtRest(), async (req: any, res: any) => {
  try {
    const adminId = req.admin._id || req.admin.id;
    const { influencer } = req.body;
    const settings = await SettingsService.updateSettings(adminId, { influencer });
    res.json({ status: 'success', data: { influencer: settings.influencer } });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.put("/settings/mono-auto-debit", verifyJwtRest(), async (req: any, res: any) => {
  try {
    const adminId = req.admin._id || req.admin.id;
    const { monoAutoDebit } = req.body;
    const settings = await SettingsService.updateSettings(adminId, { monoAutoDebit });
    res.json({ status: 'success', data: { monoAutoDebit: settings.monoAutoDebit } });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.put("/settings/voice-call-provider", verifyJwtRest(), async (req: any, res: any) => {
  try {
    const adminId = req.admin._id || req.admin.id;
    const { provider } = req.body;
    if (!['twilio', 'termii', 'plivo'].includes(provider)) {
      return res.status(400).json({ status: 'error', message: 'Invalid provider. Use twilio, termii, or plivo.' });
    }
    const settings = await SettingsService.updateSettings(adminId, { voiceCallProvider: provider });
    res.json({ status: 'success', data: { voiceCallProvider: settings.voiceCallProvider } });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

export default router;
