/**
 * User & Transfer Routes - V1 and V2
 * Consolidated user management, transfers, and bill payment endpoints
 */
import express from "express";
import { UserController } from "../modules/users/user.controller";
import { validateReqBody, validateReqQuery, verifyJwtRest } from "../shared/middlewares";
import {
  // user
  createClientAccountSchema,
  loginSchema,
  updateUserSchema,
  changePasswordSchema,
  // bill-payment
  billPaymentSchema,
  // loan
  createClientLoanSchema,
  repayLoanSchema,
  // transfer
  transferInitiateSchema,
  transferStatusQuerySchema,
  transfersListQuerySchema,
  walletAlertsSchema,
  // savings
  createPlanSchema, 
  withdrawSchema, 
  userPlansQuerySchema,
  validateResetSchema,
  initiateResetSchema,
  updatePasswordOrPinSchema
} from "../validations";
import { TransferController } from "../modules/transfers/transfer.controller";
import { BillPaymentController } from "../modules/bill-payments/bill-payment.controller";
import { idempotencyMiddleware } from "../shared/idempotency/middleware";
import { LoanController } from "../modules/loans/loan.controller";
import { SavingsController } from "../modules/savings/savings.controller";

const router = express.Router();

/**
 * -----------------------------
 * USERS
 * -----------------------------
 */

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: User management endpoints
 */

/**
 * @swagger
 * /api/users/create-client:
 *   post:
 *     summary: Register a new user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, surname, password, phone, bvn, pin, nin, dob]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *               surname:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *               phone:
 *                 type: string
 *               bvn:
 *                 type: string
 *                 minLength: 11
 *                 maxLength: 11
 *               pin:
 *                 type: string
 *                 minLength: 4
 *                 maxLength: 4
 *               nin:
 *                 type: string
 *                 minLength: 11
 *                 maxLength: 11
 *               dob:
 *                 type: string
 *                 description: Date of birth in dd/mm/yyyy
 *     responses:
 *       201:
 *         description: User created successfully
 */
router.post(
  "/users/create-client",
  validateReqBody(createClientAccountSchema),
  UserController.register
);

/**
 * @swagger
 * /api/users/financial-summary:
 *   get:
 *     summary: Get logged-in user financial summary
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User financial summary
 */
router.get("/users/financial-summary", verifyJwtRest(), UserController.getUserFinancialSummary as any);


/**
 * @swagger
 * /api/users/login:
 *   post:
 *     summary: User login
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful (returns accessToken and refreshToken)
 */
router.post("/users/login", validateReqBody(loginSchema), UserController.login);

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get logged-in user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 */
router.get("/users/profile", verifyJwtRest(), UserController.profile as any);

/**
 * @swagger
 * /api/users/update:
 *   put:
 *     summary: Update user fields (phone, address, first_name, surname, profile_photo)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [field, value]
 *             properties:
 *               field:
 *                 type: string
 *                 example: user_metadata.phone
 *               value:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 */
router.put(
  "/users/update",
  verifyJwtRest(),
  validateReqBody(updateUserSchema),
  UserController.update as any
);

/**
 * @swagger
 * /api/users/change-password:
 *   post:
 *     summary: Change password for logged-in user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed successfully
 */
router.post(
  "/users/change-password",
  verifyJwtRest(),
  validateReqBody(changePasswordSchema),
  UserController.changePassword as any
);

/**
 * @swagger
 * /api/users/reset/initiate:
 *   post:
 *     summary: Initiate password or pin reset (sends OTP)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, type]
 *             properties:
 *               email:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [password, pin]
 *     responses:
 *       200:
 *         description: Reset OTP sent
 */
router.post("/users/reset/initiate", validateReqBody(initiateResetSchema), UserController.initiateReset);

/**
 * @swagger
 * /api/users/reset/validate:
 *   post:
 *     summary: Validate reset OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, pin]
 *             properties:
 *               email:
 *                 type: string
 *               pin:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP validated successfully
 */
router.post("/users/reset/validate", validateReqBody(validateResetSchema), UserController.validateReset);

/**
 * @swagger
 * /api/users/update-password-pin:
 *   post:
 *     summary: Update password or pin after OTP validation
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *               newPassword:
 *                 type: string
 *               newPin:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password/PIN updated successfully
 */
router.post("/users/update-password-pin", validateReqBody(updatePasswordOrPinSchema), UserController.updatePasswordOrPin);

/**
 * -----------------------------
 * TRANSFERS (V2)
 * -----------------------------
 */

/**
 * @swagger
 * tags:
 *   - name: Transfers
 *     description: Transfer endpoints (initiate, status, get, list, wallet alerts)
 */

/**
 * @swagger
 * /api/transfers/initiate:
 *   post:
 *     summary: Initiate money transfer (creates transfer + ledger entry, then posts to provider)
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromAccount, toAccount, amount, transferType]
 *             properties:
 *               fromAccount:
 *                 type: string
 *                 description: Sender account number
 *               fromClientId:
 *                 type: string
 *               fromClient:
 *                 type: string
 *               fromSavingsId:
 *                 type: string
 *               fromBvn:
 *                 type: string
 *               toClient:
 *                 type: string
 *               toClientId:
 *                 type: string
 *               toSession:
 *                 type: string
 *               toAccount:
 *                 type: string
 *                 description: Beneficiary account number
 *               toSavingsId:
 *                 type: string
 *               toBvn:
 *                 type: string
 *               toBank:
 *                 type: string
 *                 description: Bank code; use "999999" for internal/intra-provider transfers
 *               toKyc:
 *                 oneOf:
 *                   - type: string
 *                   - type: object
 *                   - type: boolean
 *               amount:
 *                 type: number
 *                 description: Amount (Naira)
 *               transferType:
 *                 type: string
 *                 enum: [intra, inter]
 *               remark:
 *                 type: string
 *               idempotencyKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transfer initiated and provider called (if provider accepted, your ledger will be updated)
 */
router.post(
  "/transfers/initiate",
  verifyJwtRest(),
  validateReqBody(transferInitiateSchema),
  idempotencyMiddleware() as any,
  TransferController.initiate as any
);

/**
 * @swagger
 * /api/transfers/status:
 *   get:
 *     summary: Get transfer status from provider (provide reference or sessionId)
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reference
 *         schema:
 *           type: string
 *         description: Provider/reference ID for the transfer
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         description: Provider session identifier
 *     responses:
 *       200:
 *         description: Provider status response
 */
router.get(
  "/transfers/status",
  verifyJwtRest(),
  validateReqBody(transferStatusQuerySchema),
  TransferController.getStatus as any
);

/**
 * @swagger
 * /api/transfers/{id}:
 *   get:
 *     summary: Get transfer by transaction id
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Transfer ID (Mongo ObjectId)
 *     responses:
 *       200:
 *         description: Transfer returned
 */
router.get(
  "/transfers/:id",
  verifyJwtRest(),
  TransferController.getTransfer as any
);

router.get(
  "/banks",
  verifyJwtRest(),
  TransferController.getBanks as any
);

router.get(
  "/account-info",
  verifyJwtRest(),
  TransferController.getMyAccountInfo as any
);

router.get(
  "/beneficiary-account-info",
  verifyJwtRest(),
  TransferController.getBeneficiaryAccountInfo as any
);

/**
 * @swagger
 * /api/transfers:
 *   get:
 *     summary: Get paginated transfers for logged-in user
 *     tags: [Transfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page (default 10)
 *     responses:
 *       200:
 *         description: Paginated transfers
 */
router.get(
  "/transfers",
  verifyJwtRest(),
  validateReqBody(transfersListQuerySchema),
  TransferController.getTransfers as any
);

/**
 * NOTE: wallet-alerts webhook is public (no bearer token) — provider will post alerts to this endpoint.
 *
 * @swagger
 * /api/transfers/wallet-alerts:
 *   post:
 *     summary: Handle wallet credit alerts (webhook) — public endpoint
 *     tags: [Transfers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [account_number, amount, reference, session_id]
 *             properties:
 *               account_number:
 *                 type: string
 *               amount:
 *                 type: number
 *               originator_account_name:
 *                 type: string
 *               originator_account_number:
 *                 type: string
 *               originator_bank:
 *                 type: string
 *               originator_narration:
 *                 type: string
 *               reference:
 *                 type: string
 *               session_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet alert processed
 */
router.post(
  "/transfers/wallet-alerts",
  validateReqBody(walletAlertsSchema),
  TransferController.walletAlert as any
);

/**
 * -----------------------------
 * BILL PAYMENTS (V2) — FLUTTERWAVE
 * -----------------------------
 */

/**
 * @swagger
 * tags:
 *   - name: Bills
 *     description: Bill payment endpoints (Flutterwave integration)
 */

/**
 * @swagger
 * /api/v2/bills/initiate:
 *   post:
 *     summary: Initiate a bill payment (single endpoint for airtime/data/tv/power/internet/betting/waec/jamb)
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InitiateBillPaymentRequest'
 *     responses:
 *       200:
 *         description: Bill payment processed (or queued)
 */
router.post(
  "/bills/initiate",
  verifyJwtRest(),
  validateReqBody(billPaymentSchema),
  idempotencyMiddleware() as any,
  BillPaymentController.initiate as any
);

/**
 * @swagger
 * /api/v2/bills/categories:
 *   get:
 *     summary: Get supported bill categories
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Supported bill categories
 */
router.get("/bills/categories", verifyJwtRest(), BillPaymentController.getCategories as any);

/**
 * @swagger
 * /api/v2/bills/billers/{categoryCode}:
 *   get:
 *     summary: Get billers by category
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: categoryCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Category code (e.g. BIL099 for power)
 *     responses:
 *       200:
 *         description: Billers list
 */
router.get("/bills/billers/:categoryCode", verifyJwtRest(), BillPaymentController.getBillers as any);

/**
 * @swagger
 * /api/v2/bills/items/{billerCode}:
 *   get:
 *     summary: Get bill items/products for a biller
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billerCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bill items list
 */
router.get("/bills/items/:billerCode", verifyJwtRest(), BillPaymentController.getBillItems as any);

/**
 * @swagger
 * /api/v2/bills/validate:
 *   post:
 *     summary: Validate a customer's account or meter
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemCode, customerReference]
 *             properties:
 *               itemCode:
 *                 type: string
 *               customerReference:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validation result
 */
router.post("/bills/validate", verifyJwtRest(), BillPaymentController.validateAccount as any);

/**
 * @swagger
 * /api/v2/bills/user-payments:
 *   get:
 *     summary: Get logged-in user's bill payment history
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User payments history
 */
router.get("/bills/user-payments", verifyJwtRest(), BillPaymentController.getUserPayments as any);

/**
 * @swagger
 * /api/v2/bills/all:
 *   get:
 *     summary: Get all bill payments (admin only)
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All bill payments
 */
router.get("/bills/all", verifyJwtRest(), BillPaymentController.getAllPayments as any);

/**
 * @swagger
 * /api/v2/bills/downtime/{billerCode}:
 *   get:
 *     summary: Check downtime for a biller
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: billerCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Downtime check result
 */
router.get("/bills/downtime/:billerCode", verifyJwtRest(), BillPaymentController.checkDowntime as any);

/**
 * @swagger
 * /api/v2/bills/health:
 *   get:
 *     summary: Flutterwave connectivity health check
 *     tags: [Bills]
 *     responses:
 *       200:
 *         description: Flutterwave API reachable
 */
router.get("/bills/health", BillPaymentController.flutterwaveHealth as any);

/**
 * -----------------------------
 * LOAN ENDPOINTS (V2)
 * -----------------------------
 */

/**
 * @swagger
 * tags:
 *   - name: Loans
 *     description: Loan application, repayment, and status endpoints
 */

/**
 * @swagger
 * /api/loans/request:
 *   post:
 *     summary: Request a new loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - first_name
 *               - last_name
 *               - dob
 *               - nin
 *               - email
 *               - bvn
 *               - phone
 *               - address
 *               - company
 *               - company_address
 *               - annual_income
 *               - guarantor_1_name
 *               - guarantor_1_phone
 *               - amount
 *               - reason
 *               - category
 *               - type
 *               - status
 *               - duration
 *               - repayment_amount
 *               - percentage
 *               - loan_date
 *               - repayment_date
 *               - acknowledgment
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               dob:
 *                 type: string
 *                 example: "1995-07-20"
 *               doi:
 *                 type: string
 *                 description: Date of incorporation (for businesses)
 *               nin:
 *                 type: string
 *               tin:
 *                 type: string
 *               email:
 *                 type: string
 *               bvn:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               company:
 *                 type: string
 *               company_address:
 *                 type: string
 *               annual_income:
 *                 type: string
 *               guarantor_1_name:
 *                 type: string
 *               guarantor_1_phone:
 *                 type: string
 *               guarantor_2_name:
 *                 type: string
 *               guarantor_2_phone:
 *                 type: string
 *               amount:
 *                 type: string
 *               reason:
 *                 type: string
 *               base64Image:
 *                 type: string
 *               outstanding:
 *                 type: string
 *               category:
 *                 type: string
 *               type:
 *                 type: string
 *               status:
 *                 type: string
 *               duration:
 *                 type: string
 *               repayment_amount:
 *                 type: string
 *               percentage:
 *                 type: string
 *               loan_date:
 *                 type: string
 *               repayment_date:
 *                 type: string
 *               acknowledgment:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Loan request submitted successfully
 */
router.post(
  "/loans/request",
  verifyJwtRest(),
  idempotencyMiddleware() as any,
  validateReqBody(createClientLoanSchema),
  LoanController.requestLoan as any
);

/**
 * @swagger
 * /api/loans/{id}/repay:
 *   post:
 *     summary: Repay an existing loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionId, amount, outstanding]
 *             properties:
 *               transactionId:
 *                 type: string
 *               amount:
 *                 type: string
 *               outstanding:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan repayment processed successfully
 */
router.post(
  "/loans/:id/repay",
  verifyJwtRest(),
  idempotencyMiddleware() as any,
  validateReqBody(repayLoanSchema),
  LoanController.repayLoan as any
);

/**
 * @swagger
 * /api/loans/{id}/status:
 *   get:
 *     summary: Get status of a loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Loan ID
 *     responses:
 *       200:
 *         description: Loan status returned
 */
router.get("/loans/:id/status", verifyJwtRest(), LoanController.getLoanStatus as any);

/**
 * @swagger
 * /api/loans:
 *   get:
 *     summary: Get paginated list of loans for logged-in user
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of loans
 */
router.get("/loans", verifyJwtRest(), LoanController.listUserLoans as any);

/**
 * -----------------------------
 * SAVINGS
 * -----------------------------
*/

/**
 * @swagger
 * /api/savings/create:
 *   post:
 *     tags: [Savings]
 *     summary: Create a new savings plan
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *               planName:
 *                 type: string
 *               targetAmount:
 *                 type: number
 *               durationDays:
 *                 type: integer
 *               amount:
 *                 type: number
 *               interestRate:
 *                 type: number
 *               renew:
 *                 type: boolean
 */
router.post(
  "/savings/create",
  verifyJwtRest(),
  validateReqBody(createPlanSchema),
  idempotencyMiddleware() as any,
  SavingsController.createPlan as any
);

/**
 * @swagger
 * /api/savings/{id}/withdraw:
 *   post:
 *     tags: [Savings]
 *     summary: Withdraw from a savings plan
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Savings Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 */
router.post(
  "/savings/:id/withdraw",
  verifyJwtRest(),
  validateReqBody(withdrawSchema),
  idempotencyMiddleware() as any,
  SavingsController.withdraw as any
);

/**
 * @swagger
 * /api/savings:
 *   get:
 *     tags: [Savings]
 *     summary: Get savings plans for logged-in user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 */
router.get("/savings", verifyJwtRest(), validateReqQuery(userPlansQuerySchema), SavingsController.getUserPlans as any);

export default router;
