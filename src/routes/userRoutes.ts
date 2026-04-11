/**
 * API Routes — v2
 * Handles:
 *  - Users (auth, profile, settings)
 *  - Transfers
 *  - Bill Payments
 *  - Loans
 *  - Savings
 * Includes Swagger documentation and centralized middleware validation.
 */

import express from "express";
import {
  validateReqBody,
  validateReqQuery,
  verifyJwtRest,
} from "../shared/middlewares";
import { idempotencyMiddleware } from "../shared/idempotency/middleware";

// --- Controllers ---
import { UserController } from "../modules/users/user.controller";
import { TransferController } from "../modules/transfers/transfer.controller";
import { BillPaymentController } from "../modules/bill-payments/bill-payment.controller";
import { LoanController } from "../modules/loans/loan.controller";
import { SavingsController } from "../modules/savings/savings.controller";
import { AdminController } from "../modules/admin/admin.controller";
import { EscrowController } from "../modules/escrow/escrow.controller";
import { MarketplaceController } from "../modules/marketplace/marketplace.controller";
import { SettingsController } from "../modules/admin/settings.controller";

// --- Validation Schemas ---
import {
  // User schemas
  createClientAccountSchema,
  loginSchema,
  updateUserSchema,
  changePasswordSchema,
  initiateResetSchema,
  validateResetSchema,
  updatePasswordOrPinSchema,
  verifyPinSchema,
  // Transfer schemas
  transferInitiateSchema,
  transferStatusQuerySchema,
  transfersListQuerySchema,
  walletAlertsSchema,
  // Bill payment
  billPaymentSchema,
  // Loans
  createClientLoanSchema,
  repayLoanSchema,
  rejectLoanSchema,
  // Savings
  createPlanSchema,
  withdrawSchema,
  userPlansQuerySchema,
} from "../validations";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                               USER ROUTES                                  */
/* -------------------------------------------------------------------------- */

router.post(
  "/users/create-client",
  validateReqBody(createClientAccountSchema),
  UserController.register
);

router.post("/users/login", validateReqBody(loginSchema), UserController.login);

router.get(
  "/users/profile",
  verifyJwtRest(),
  UserController.profile as unknown as express.RequestHandler
);

router.get(
  "/users/financial-summary",
  verifyJwtRest(),
  UserController.getUserFinancialSummary as unknown as express.RequestHandler
);

router.put(
  "/users/update",
  verifyJwtRest(),
  validateReqBody(updateUserSchema),
  UserController.update as unknown as express.RequestHandler
);

router.post(
  "/users/change-password",
  verifyJwtRest(),
  validateReqBody(changePasswordSchema),
  UserController.changePassword as unknown as express.RequestHandler
);

// Password & PIN reset
router.post(
  "/users/reset/initiate",
  validateReqBody(initiateResetSchema),
  UserController.initiateReset
);

router.post(
  "/users/reset/validate",
  validateReqBody(validateResetSchema),
  UserController.validateReset
);

router.post(
  "/users/update-password-pin",
  validateReqBody(updatePasswordOrPinSchema),
  UserController.updatePasswordOrPin
);

router.post(
  "/users/verify-pin",
  verifyJwtRest(),
  validateReqBody(verifyPinSchema),
  UserController.verifyPin as unknown as express.RequestHandler
);

/* -------------------------------------------------------------------------- */
/*                               TRANSFER ROUTES                              */
/* -------------------------------------------------------------------------- */

router.post(
  "/transfers/initiate",
  verifyJwtRest(),
  validateReqBody(transferInitiateSchema),
  idempotencyMiddleware() as any,
  TransferController.initiate as unknown as express.RequestHandler
);

router.get(
  "/transfers/status",
  verifyJwtRest(),
  validateReqQuery(transferStatusQuerySchema),
  TransferController.getStatus as unknown as express.RequestHandler
);

router.get(
  "/transfers/:id([0-9a-fA-F]{24})",
  verifyJwtRest(),
  TransferController.getTransfer as unknown as express.RequestHandler
);

router.get("/banks", verifyJwtRest(), TransferController.getBanks as any);
router.get(
  "/account-info",
  verifyJwtRest(),
  TransferController.getMyAccountInfo as any
);
router.get(
  "/transfers/name-enquiry",
  verifyJwtRest(),
  TransferController.nameEnquiry as any
);

router.get(
  "/beneficiary-account-info",
  verifyJwtRest(),
  TransferController.getBeneficiaryAccountInfo as any
);

router.get(
  "/transfers",
  verifyJwtRest(),
  validateReqQuery(transfersListQuerySchema),
  TransferController.getTransfers as unknown as express.RequestHandler
);

// Wallet webhook — public endpoint
router.post(
  "/transfers/wallet-alerts",
  validateReqBody(walletAlertsSchema),
  TransferController.walletAlert as unknown as express.RequestHandler
);

/* -------------------------------------------------------------------------- */
/*                            BILL PAYMENT ROUTES                             */
/* -------------------------------------------------------------------------- */

router.post(
  "/bills/initiate",
  verifyJwtRest(),
  validateReqBody(billPaymentSchema),
  idempotencyMiddleware() as any,
  BillPaymentController.initiate as unknown as express.RequestHandler
);

router.get(
  "/bills/categories",
  verifyJwtRest(),
  BillPaymentController.getCategories as unknown as express.RequestHandler
);

router.get(
  "/bills/billers/:categoryCode",
  verifyJwtRest(),
  BillPaymentController.getBillers as unknown as express.RequestHandler
);

router.get(
  "/bills/items/:billerCode",
  verifyJwtRest(),
  BillPaymentController.getBillItems as unknown as express.RequestHandler
);

router.post(
  "/bills/validate",
  verifyJwtRest(),
  BillPaymentController.validateAccount as unknown as express.RequestHandler
);

router.get(
  "/bills/user-payments",
  verifyJwtRest(),
  BillPaymentController.getUserPayments as unknown as express.RequestHandler
);

router.get(
  "/bills/all",
  verifyJwtRest(),
  BillPaymentController.getAllPayments as unknown as express.RequestHandler
);

router.get(
  "/bills/downtime/:billerCode",
  verifyJwtRest(),
  BillPaymentController.checkDowntime as unknown as express.RequestHandler
);

router.get("/bills/health", BillPaymentController.flutterwaveHealth as any);

/* -------------------------------------------------------------------------- */
/*                               LOAN ROUTES                                  */
/* -------------------------------------------------------------------------- */

router.post(
  "/loans/request",
  verifyJwtRest(),
  idempotencyMiddleware() as any,
  validateReqBody(createClientLoanSchema),
  LoanController.requestLoan as unknown as express.RequestHandler
);

router.post(
  "/loans/:id([0-9a-fA-F]{24})/cancel",
  verifyJwtRest(),
  idempotencyMiddleware() as any,
  validateReqBody(rejectLoanSchema),
  LoanController.cancelLoan as unknown as express.RequestHandler
);

router.post(
  "/loans/:id([0-9a-fA-F]{24})/repay",
  verifyJwtRest(),
  idempotencyMiddleware() as any,
  validateReqBody(repayLoanSchema),
  LoanController.repayLoan as unknown as express.RequestHandler
);

router.get(
  "/loans/:id([0-9a-fA-F]{24})/status",
  verifyJwtRest(),
  LoanController.getLoanStatus as unknown as express.RequestHandler
);

router.get(
  "/loans",
  verifyJwtRest(),
  LoanController.listUserLoans as unknown as express.RequestHandler
);

// Loan Ladder
router.get(
  "/ladder",
  verifyJwtRest(),
  LoanController.getLoanLadders as unknown as express.RequestHandler
);

router.get(
  "/ladder/:id([0-9a-fA-F]{24})",
  verifyJwtRest(),
  LoanController.getLoanLadderById as unknown as express.RequestHandler
);

/* -------------------------------------------------------------------------- */
/*                              SAVINGS ROUTES                                */
/* -------------------------------------------------------------------------- */

router.post(
  "/savings/create",
  verifyJwtRest(),
  validateReqBody(createPlanSchema),
  idempotencyMiddleware() as any,
  SavingsController.createPlan as unknown as express.RequestHandler
);

router.get(
  "/savings/config",
  verifyJwtRest(),
  SavingsController.getSavingsConfig as unknown as express.RequestHandler
);

router.post(
  "/savings/:id([0-9a-fA-F]{24})/withdraw",
  verifyJwtRest(),
  validateReqBody(withdrawSchema),
  idempotencyMiddleware() as any,
  SavingsController.withdraw as unknown as express.RequestHandler
);

router.post(
  "/savings/:id([0-9a-fA-F]{24})/topup",
  verifyJwtRest(),
  validateReqBody(withdrawSchema), // Reusing schema as it likely validates amount
  idempotencyMiddleware() as any,
  SavingsController.topUp as unknown as express.RequestHandler
);

router.get(
  "/savings",
  verifyJwtRest(),
  validateReqQuery(userPlansQuerySchema),
  SavingsController.getUserPlans as unknown as express.RequestHandler
);

router.delete(
  "/savings/:id([0-9a-fA-F]{24})",
  verifyJwtRest(),
  SavingsController.deletePlan as unknown as express.RequestHandler
);

/* -------------------------------------------------------------------------- */
/*                              ESCROW ROUTES                                 */
/* -------------------------------------------------------------------------- */

router.post("/escrow/p2p", verifyJwtRest(), idempotencyMiddleware() as any, EscrowController.createP2P as any);
router.post("/escrow/marketplace", verifyJwtRest(), idempotencyMiddleware() as any, EscrowController.createMarketplace as any);
router.get("/escrow/fees", verifyJwtRest(), EscrowController.getEscrowFees as any);
router.get("/escrow", verifyJwtRest(), EscrowController.getMyEscrows as any);

// Funding is now automatic on creation, so explicit fund route is removed/deprecated
// router.post("/escrow/:id/fund", verifyJwtRest(), EscrowController.fund as any);

router.post("/escrow/:id/accept", verifyJwtRest(), EscrowController.acceptEscrow as any);
router.post("/escrow/:id/reject", verifyJwtRest(), idempotencyMiddleware() as any, EscrowController.rejectEscrow as any);

router.post("/escrow/:id/confirm", verifyJwtRest(), idempotencyMiddleware() as any, EscrowController.confirmDelivery as any);
router.post("/escrow/:id/cancel", verifyJwtRest(), idempotencyMiddleware() as any, EscrowController.cancelEscrow as any);
router.post("/escrow/:id/dispute", verifyJwtRest(), EscrowController.raiseDispute as any);
router.post("/escrow/:id/resolve", verifyJwtRest(), idempotencyMiddleware() as any, EscrowController.resolveDispute as any); // Admin

/* -------------------------------------------------------------------------- */
/*                               CHAT ROUTES                                  */
/* -------------------------------------------------------------------------- */
import { ChatController } from "../modules/chat/chat.controller";

router.post("/chat/upload", verifyJwtRest(), ChatController.upload as any);
router.get("/chat/:escrowId/history", verifyJwtRest(), ChatController.getHistory as any);
router.post("/chat/:escrowId/message", verifyJwtRest(), ChatController.sendMessage as any);

/* -------------------------------------------------------------------------- */
/*                              WORKER ROUTES                                 */
/* -------------------------------------------------------------------------- */
// Worker routes moved to adminRoutes


import { CartController } from "../modules/marketplace/cart.controller";

/* -------------------------------------------------------------------------- */
/*                            MARKETPLACE ROUTES                              */
/* -------------------------------------------------------------------------- */

// Vendor
router.post("/marketplace/vendor/apply", verifyJwtRest(), MarketplaceController.applyAsVendor as any);
router.get("/marketplace/vendor/me", verifyJwtRest(), MarketplaceController.getMyVendorProfile as any);
router.get("/marketplace/vendors/:id", verifyJwtRest(), MarketplaceController.getPublicVendorProfile as any); // Public Vendor Profile
router.put("/marketplace/vendors/:id", verifyJwtRest(), MarketplaceController.updateVendor as any);
router.get("/marketplace/vendors/:id/escrows", verifyJwtRest(), MarketplaceController.getVendorEscrows as any);

// Vendor Reviews
router.post("/marketplace/reviews", verifyJwtRest(), MarketplaceController.addReview as any);
router.get("/marketplace/vendors/:id/reviews", verifyJwtRest(), MarketplaceController.getVendorReviews as any);

// Products (Vendor)
router.post("/marketplace/products", verifyJwtRest(), MarketplaceController.createProduct as any);
router.put("/marketplace/products/:id", verifyJwtRest(), MarketplaceController.updateProduct as any);
router.delete("/marketplace/products/:id", verifyJwtRest(), MarketplaceController.deleteProduct as any);

// Products (Public/User)
router.get("/marketplace/products", verifyJwtRest(), MarketplaceController.listProducts as any);
router.get("/marketplace/products/:id", verifyJwtRest(), MarketplaceController.getProduct as any);

import { OrderController } from "../modules/marketplace/order.controller";

// ... existing marketplace routes ...

// Cart
router.get("/marketplace/cart", verifyJwtRest(), CartController.getCart as any);
router.post("/marketplace/cart", verifyJwtRest(), CartController.addItem as any);
router.put("/marketplace/cart/items", verifyJwtRest(), CartController.updateItem as any);
router.delete("/marketplace/cart/items", verifyJwtRest(), CartController.removeItem as any);
router.delete("/marketplace/cart", verifyJwtRest(), CartController.clearCart as any);

// Orders
router.post("/marketplace/checkout", verifyJwtRest(), OrderController.checkout as any);
router.get("/marketplace/orders", verifyJwtRest(), OrderController.getMyOrders as any);

/* -------------------------------------------------------------------------- */
/*                              SETTINGS ROUTES                                */
/* -------------------------------------------------------------------------- */

router.get("/settings", verifyJwtRest(), SettingsController.getSettings);
router.get("/fees", SettingsController.getFees);
router.get("/settings/calculate-profit", verifyJwtRest(), AdminController.calculateProfit as any);
router.get("/settings/profit-config", verifyJwtRest(), AdminController.getProfitConfig as any);

/* -------------------------------------------------------------------------- */
/*                          INFLUENCER ROUTES                                 */
/* -------------------------------------------------------------------------- */
import { InfluencerController } from "../modules/influencer/influencer.controller";

router.get("/influencer/me", verifyJwtRest(), InfluencerController.getProfile as any);
router.post("/influencer/apply", verifyJwtRest(), InfluencerController.apply as any);
router.get("/influencer/dashboard", verifyJwtRest(), InfluencerController.getDashboard as any);
router.get("/influencer/referred-users", verifyJwtRest(), InfluencerController.getReferredUsers as any);
router.get("/influencer/earnings", verifyJwtRest(), InfluencerController.getEarnings as any);

/* -------------------------------------------------------------------------- */
/*                      MONO ACCOUNT LINKING ROUTES                           */
/* -------------------------------------------------------------------------- */
import { MonoAccountController } from "../modules/loans/mono-account.controller";

router.post("/loans/link-account", verifyJwtRest(), MonoAccountController.linkAccount as any);
router.get("/loans/linked-account", verifyJwtRest(), MonoAccountController.getLinkedAccount as any);
router.get("/loans/max-borrowable", verifyJwtRest(), MonoAccountController.getMaxBorrowable as any);

/* -------------------------------------------------------------------------- */
/*                               EXPORT ROUTER                                */
/* -------------------------------------------------------------------------- */

export default router;
