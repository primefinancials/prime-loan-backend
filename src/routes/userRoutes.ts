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
  tvVerifySchema,
  powerVerifySchema,
  bettingVerifySchema,
  smileVerifySchema,
  jambVerifySchema,
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
 * BILL PAYMENTS (V2)
 * -----------------------------
 */

/**
 * @swagger
 * tags:
 *   - name: Bills
 *     description: Bill payment endpoints (ClubConnect / provider integration)
 */

/**
 * @swagger
 * /api/bills/initiate:
 *   post:
 *     summary: Initiate a bill payment (single generic endpoint for airtime/data/tv/power/internet/betting/waec/jamb)
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, serviceType, customerReference]
 *             properties:
 *               amount:
 *                 type: number
 *               serviceType:
 *                 type: string
 *                 enum: [airtime, data, tv, power, betting, internet, waec, jamb]
 *               serviceId:
 *                 type: string
 *                 description: provider service id (e.g. data plan id, cable id, electric company id, examType)
 *               customerReference:
 *                 type: string
 *                 description: target account/number (e.g. mobile number, meter number, smartcard)
 *               extras:
 *                 type: object
 *                 description: service-specific extras (for airtime include mobileNetwork, for power include meterType, etc.)
 *               idempotencyKey:
 *                 type: string
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
 * /api/bills/status/{id}:
 *   get:
 *     summary: Get bill payment transaction status
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ClubConnect transaction id
 *     responses:
 *       200:
 *         description: Transaction status
 */
router.get("/bills/status/:id", verifyJwtRest(), BillPaymentController.getStatus as any);

/**
 * @swagger
 * /api/bills/cancel/{id}:
 *   post:
 *     summary: Cancel a bill payment transaction
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ClubConnect transaction id to cancel
 *     responses:
 *       200:
 *         description: Cancellation response
 */
router.post("/bills/cancel/:id", verifyJwtRest(), BillPaymentController.cancelTransaction as any);

/**
 * @swagger
 * /api/bills/wallet-balance:
 *   get:
 *     summary: Get ClubConnect wallet balance
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance
 */
router.get("/bills/wallet-balance", verifyJwtRest(), BillPaymentController.walletBalance as any);

/**
 * @swagger
 * /api/bills/data-plans:
 *   get:
 *     summary: Get available data plans
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Data plans list
 */
router.get("/bills/data-plans", verifyJwtRest(), BillPaymentController.getDataPlans as any);

/**
 * @swagger
 * /api/bills/tv-packages:
 *   get:
 *     summary: Get available TV packages
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TV packages
 */
router.get("/bills/tv-packages", verifyJwtRest(), BillPaymentController.getTvPackages as any);

/**
 * @swagger
 * /api/bills/tv/verify:
 *   post:
 *     summary: Verify TV smartcard number (provider validation)
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cableTV, smartCardNo]
 *             properties:
 *               cableTV:
 *                 type: string
 *               smartCardNo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification result
 */
router.post("/bills/tv/verify", verifyJwtRest(), validateReqBody(tvVerifySchema), BillPaymentController.verifyTv as any);

/**
 * @swagger
 * /api/bills/power-subscriptions:
 *   get:
 *     summary: Get available electricity subscription types
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Electricity subscription companies
 */
router.get("/bills/power-subscriptions", verifyJwtRest(), BillPaymentController.getPowerSubscriptions as any);

/**
 * @swagger
 * /api/bills/power/verify:
 *   post:
 *     summary: Verify electricity meter number
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [electricCompany, meterNo]
 *             properties:
 *               electricCompany:
 *                 type: string
 *               meterNo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Meter verification
 */
router.post("/bills/power/verify", verifyJwtRest(), validateReqBody(powerVerifySchema), BillPaymentController.verifyPower as any);

/**
 * @swagger
 * /api/bills/betting-platforms:
 *   get:
 *     summary: Get supported betting platforms
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Betting platforms
 */
router.get("/bills/betting-platforms", verifyJwtRest(), BillPaymentController.getBettingPlatforms as any);

/**
 * @swagger
 * /api/bills/betting/verify:
 *   post:
 *     summary: Verify betting customer ID
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bettingCompany, customerId]
 *             properties:
 *               bettingCompany:
 *                 type: string
 *               customerId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Betting verification
 */
router.post("/bills/betting/verify", verifyJwtRest(), validateReqBody(bettingVerifySchema), BillPaymentController.verifyBetting as any);

/**
 * @swagger
 * /api/bills/internet-plans/{network}:
 *   get:
 *     summary: Get available internet plans for a network (smile-direct/spectranet)
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: network
 *         required: true
 *         schema:
 *           type: string
 *         description: Network name (smile-direct | spectranet)
 *     responses:
 *       200:
 *         description: Internet plans
 */
router.get("/bills/internet-plans/:network", verifyJwtRest(), BillPaymentController.getInternetPlans as any);

/**
 * @swagger
 * /api/bills/smile/verify:
 *   post:
 *     summary: Verify Smile account details
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobileNumber]
 *             properties:
 *               mobileNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Smile verification
 */
router.post("/bills/smile/verify", verifyJwtRest(), validateReqBody(smileVerifySchema), BillPaymentController.verifySmile as any);

/**
 * @swagger
 * /api/bills/waec-types:
 *   get:
 *     summary: Get available WAEC PIN/exam types
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: WAEC types
 */
router.get("/bills/waec-types", verifyJwtRest(), BillPaymentController.getWaecTypes as any);

/**
 * @swagger
 * /api/bills/jamb-types:
 *   get:
 *     summary: Get available JAMB PIN/exam types
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: JAMB types
 */
router.get("/bills/jamb-types", verifyJwtRest(), BillPaymentController.getJambTypes as any);

/**
 * @swagger
 * /api/bills/jamb/verify:
 *   post:
 *     summary: Verify JAMB registration profile
 *     tags: [Bills]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [examType, profileId]
 *             properties:
 *               examType:
 *                 type: string
 *               profileId:
 *                 type: string
 *     responses:
 *       200:
 *         description: JAMB verification
 */
router.post("/bills/jamb/verify", verifyJwtRest(), validateReqBody(jambVerifySchema), BillPaymentController.verifyJamb as any);

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
