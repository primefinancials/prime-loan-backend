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
router.get("/compliance/report", verifyJwtRest(), AdminController.downloadComplianceReport as any);
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
   CHARGE SETTINGS (Fix #4.2)
============================= */
router.get("/charge-settings", verifyJwtRest(), async (req, res, next) => {
  try {
    const { SettingsService } = await import("../modules/admin/settings.service");
    const chargeConfig = await SettingsService.getChargeConfig();
    res.json({ success: true, data: chargeConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/charge-settings", verifyJwtRest(), async (req, res, next) => {
  try {
    const { SettingsService } = await import("../modules/admin/settings.service");
    const adminId = (req as any).user?._id;
    const result = await SettingsService.updateChargeConfig(adminId, req.body);
    res.json({ success: true, message: "Charge settings updated", data: result.chargeConfiguration });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/* =============================
   KYC & TIER UPGRADES (Fix #6.1)
============================= */
router.get("/kyc/pending-upgrades", verifyJwtRest(), async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { KYCUpgradeRequest } = await import("../modules/users/kyc.model");
    const [requests, total] = await Promise.all([
      KYCUpgradeRequest.find({ status: "pending" })
        .populate("userId", "username email")
        .sort({ submittedAt: -1 })
        .skip(((Number(page) || 1) - 1) * Number(limit))
        .limit(Number(limit)),
      KYCUpgradeRequest.countDocuments({ status: "pending" })
    ]);
    res.json({
      success: true,
      data: {
        requests,
        pagination: { total, page: Number(page) || 1, limit: Number(limit), pages: Math.ceil(total / Number(limit)) }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/kyc/:requestId/approve", verifyJwtRest(), async (req, res, next) => {
  try {
    const { KYCService } = await import("../modules/users/kyc.service");
    const adminId = (req as any).user?._id;
    const result = await KYCService.approveUpgrade(req.params.requestId, adminId);
    res.json({ success: true, message: "Tier upgrade approved", data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post("/kyc/:requestId/reject", verifyJwtRest(), async (req, res, next) => {
  try {
    const { KYCService } = await import("../modules/users/kyc.service");
    const adminId = (req as any).user?._id;
    const { reason } = req.body;
    const result = await KYCService.rejectUpgrade(req.params.requestId, adminId, reason);
    res.json({ success: true, message: "Tier upgrade rejected", data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

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
router.get("/marketplace/vendors/:id/details", verifyJwtRest(), MarketplaceController.getVendorDetailedProfile as any); // Enhanced vendor profile (Fix #2.1)
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
router.post("/influencers/:id/suspend", verifyJwtRest(), InfluencerController.suspend as any);
router.post("/influencers/:id/reactivate", verifyJwtRest(), InfluencerController.reactivate as any);
router.put("/influencers/:id/discount-config", verifyJwtRest(), InfluencerController.updateDiscountConfig as any);
router.post("/influencers/:id/payout", verifyJwtRest(), InfluencerController.payoutSingleInfluencer as any);

/* =============================
   AUTO-DEBIT LOGS
============================= */
import { AutoDebitLog } from "../modules/loans/auto-debit-log.model";

router.get("/auto-debit-logs", verifyJwtRest(), async (req: any, res: any) => {
   try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status;
      const type = req.query.type; // 'card' | 'bank'
      const filter: any = {};
      if (status) filter.status = status;
      if (type) filter.type = type;

      const skip = (page - 1) * limit;
      const [logs, total] = await Promise.all([
         AutoDebitLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
         AutoDebitLog.countDocuments(filter)
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

router.put("/settings/auto-debit", verifyJwtRest(), async (req: any, res: any) => {
   try {
      const adminId = req.admin._id || req.admin.id;
      const { autoDebit } = req.body;
      const settings = await SettingsService.updateSettings(adminId, { autoDebit });
      res.json({ status: 'success', data: { autoDebit: settings.autoDebit } });
   } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
   }
});

router.put("/settings/voice-call-provider", verifyJwtRest(), async (req: any, res: any) => {
   try {
      const adminId = req.admin._id || req.admin.id;
      const { provider } = req.body;
      if (!['termii', 'africastalking'].includes(provider)) {
         return res.status(400).json({ status: 'error', message: 'Invalid provider. Use termii or africastalking.' });
      }
      const settings = await SettingsService.updateSettings(adminId, {
         voiceCallProvider: provider,
         voiceCallConfig: { provider } as any
      });
      res.json({ status: 'success', data: { voiceCallProvider: settings.voiceCallProvider, voiceCallConfig: settings.voiceCallConfig } });
   } catch (err: any) {
      res.status(500).json({ status: 'error', message: err.message });
   }
});

/* =============================
   TEST INTEGRATIONS
============================= */

import { TestIntegrationsController } from "../modules/admin/test-integrations.controller";

router.post("/test-integrations/voice-call", verifyJwtRest(), TestIntegrationsController.testVoiceCall as any);
router.post("/test-integrations/sms", verifyJwtRest(), TestIntegrationsController.testSms as any);
router.post("/test-integrations/penalty", verifyJwtRest(), TestIntegrationsController.testPenalty as any);
router.post("/test-integrations/auto-debit", verifyJwtRest(), TestIntegrationsController.testAutoDebit as any);
router.post("/test-integrations/wallet-deduction", verifyJwtRest(), TestIntegrationsController.testWalletDeduction as any);
router.post("/test-integrations/transfer", verifyJwtRest(), TestIntegrationsController.testTransfer as any);
router.get("/test-integrations/banks", verifyJwtRest(), TestIntegrationsController.getBanks as any);
router.get("/test-integrations/vfd-raw", verifyJwtRest(), TestIntegrationsController.vfdRawTest as any);
router.get("/test-integrations/verify-beneficiary", verifyJwtRest(), TestIntegrationsController.nameEnquiry as any);

router.get("/test-integrations/paybeta/wallet", verifyJwtRest(), TestIntegrationsController.getPaybetaWallet as any);
router.get("/test-integrations/paybeta/providers", verifyJwtRest(), TestIntegrationsController.getPaybetaProviders as any);
router.get("/test-integrations/paybeta/data-bundles", verifyJwtRest(), TestIntegrationsController.getPaybetaDataBundles as any);
router.post("/test-integrations/paybeta/airtime", verifyJwtRest(), TestIntegrationsController.buyPaybetaAirtime as any);
router.post("/test-integrations/paybeta/data", verifyJwtRest(), TestIntegrationsController.buyPaybetaData as any);
router.post("/test-integrations/flutterwave/transfer", verifyJwtRest(), TestIntegrationsController.testFlutterwaveTransfer as any);
router.post("/test-integrations/flutterwave/bill", verifyJwtRest(), TestIntegrationsController.testFlutterwaveBillPayment as any);
router.get("/test-integrations/flutterwave/bill-categories", verifyJwtRest(), TestIntegrationsController.testFlutterwaveBillCategories as any);
router.get("/test-integrations/flutterwave/bill-items/:billerCode", verifyJwtRest(), TestIntegrationsController.testFlutterwaveBillItems as any);
router.get("/test-integrations/flutterwave/banks", verifyJwtRest(), TestIntegrationsController.testFlutterwaveBanks as any);
router.get("/test-integrations/flutterwave/verify-account", verifyJwtRest(), TestIntegrationsController.testFlutterwaveVerifyAccount as any);
router.get("/test-integrations/users/:userId/active-loans", verifyJwtRest(), TestIntegrationsController.getUserActiveLoans as any);
router.get("/test-integrations/mono-balance/:userId", verifyJwtRest(), TestIntegrationsController.getMonoBalance as any);

/* =============================
   AUTO-DEBIT MANDATE (Admin)
============================= */
import { AdminAutoDebitController } from "../modules/loans/admin-auto-debit.controller";

router.get("/users/:userId([0-9a-fA-F]{24})/payment-methods", verifyJwtRest(), AdminAutoDebitController.listPaymentMethods as any);
router.post("/users/:userId([0-9a-fA-F]{24})/payment-methods/:id([0-9a-fA-F]{24})/cancel", verifyJwtRest(), AdminAutoDebitController.cancelMethod as any);
router.get("/loans/:loanId([0-9a-fA-F]{24})/auto-debit/preview", verifyJwtRest(), AdminAutoDebitController.preview as any);
router.post("/loans/:loanId([0-9a-fA-F]{24})/auto-debit/charge", verifyJwtRest(), idempotencyMiddleware() as any, AdminAutoDebitController.charge as any);
router.post("/loans/:loanId([0-9a-fA-F]{24})/auto-debit/refresh-mandate", verifyJwtRest(), AdminAutoDebitController.refreshMandate as any);
router.get("/loans/:loanId([0-9a-fA-F]{24})/bank-balance", verifyJwtRest(), AdminAutoDebitController.bankBalance as any);
/* =============================
   ADMIN TRANSFERS (ACTUAL)
============================= */
import { AdminTransferController } from "../modules/admin/admin.transfer.controller";

router.post("/transfers/actual/company", verifyJwtRest(), AdminTransferController.transferFromCompany as any);
router.post("/transfers/actual/user", verifyJwtRest(), AdminTransferController.transferFromUser as any);

export default router;

