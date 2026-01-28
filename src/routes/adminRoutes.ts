// src/routes/admin.routes.ts
import express from "express";
import { AdminController } from "../modules/admin/admin.controller";
import { LoanController } from "../modules/loans/loan.controller";
import { SavingsController } from "../modules/savings/savings.controller";
import { profitController } from "../modules/profits/profits.controller";
import { WorkerController } from "../modules/workers/worker.controller";
import { EscrowController } from "../modules/escrow/escrow.controller";
import { MarketplaceController } from "../modules/marketplace/marketplace.controller";
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

router.get("/savings", verifyJwtRest(), SavingsController.getPlans as any);
router.get("/savings/stats", verifyJwtRest(), AdminController.getSavingsStats as any);
router.get("/savings/by-category", verifyJwtRest(), validateReqQuery(flaggedQuerySchema), AdminController.getSavingsByCategory as any);

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
router.get("/transactions/:traceId([0-9a-fA-F]{24})", verifyJwtRest(), AdminController.getTransactionDetails as any);
router.get("/transactions/flagged", verifyJwtRest(), AdminController.getFlaggedTransactions as any);
router.get("/billpayment/all", verifyJwtRest(), validateReqQuery(transactionQuerySchema), AdminController.getBillPayment as any);
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

/* =============================
   WORKER MANAGEMENT
============================= */
router.get("/workers", verifyJwtRest(), WorkerController.listWorkers as any);
router.post("/workers/:name/start", verifyJwtRest(), WorkerController.startWorker as any);
router.post("/workers/:name/stop", verifyJwtRest(), WorkerController.stopWorker as any);
router.post("/workers/:name/restart", verifyJwtRest(), WorkerController.restartWorker as any);

/* =============================
   ESCROW DISPUTES
============================= */
router.post("/escrow/:id/resolve", verifyJwtRest(), EscrowController.resolveDispute as any);
router.post("/escrow/:id/resolve", verifyJwtRest(), EscrowController.resolveDispute as any);

/* =============================
   MARKETPLACE MANAGEMENT
============================= */
router.get("/marketplace/vendors", verifyJwtRest(), MarketplaceController.listVendors as any);
router.post("/marketplace/vendors/:id/approve", verifyJwtRest(), MarketplaceController.approveVendor as any);
router.post("/marketplace/vendors/:id/reject", verifyJwtRest(), MarketplaceController.rejectVendor as any);
router.get("/marketplace/vendors/:id/products", verifyJwtRest(), MarketplaceController.getVendorProducts as any); // Products by Vendor

// Admin Escrows (with vendor filter)
router.get("/escrows", verifyJwtRest(), MarketplaceController.getAdminEscrows as any);

/* =============================
   PROFITS MANAGEMENT
============================= */

router.get("/profits/user/:userId", verifyJwtRest(), profitController.getUserProfits.bind(profitController) as any);
router.get("/profits/type", verifyJwtRest(), profitController.getProfitByType.bind(profitController) as any);
router.get("/profits/reference", verifyJwtRest(), profitController.getProfitByReference.bind(profitController) as any);
router.get("/profits/total", verifyJwtRest(), profitController.getTotalProfit.bind(profitController) as any);
router.patch("/profits/:reference/realize", verifyJwtRest(), profitController.markProfitAsRealized.bind(profitController) as any);

export default router;
