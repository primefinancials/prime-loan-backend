/**
 * loan.service.ts
 * Centralized Loan business logic (moved out of controller)
 * - Mongoose + transaction aware
 * - Ledger-first orchestration (create DB + ledger + transfer record, then call provider)
 * - Pagination for list endpoints
 */
import axios, { AxiosRequestConfig } from "axios";
import { DatabaseService } from "../../shared/db";
import { UuidService } from "../../shared/utils/uuid";
import { saveIdempotentResponse } from "../../shared/idempotency/middleware";
import { LedgerService } from "../ledger/LedgerService";
import { TransferRequest, VfdProvider } from "../../shared/providers/vfd.provider";
import Loan from "./loan.model";
import { ILoan, LOANSTATUS, ICreditScore, LOANCATEGORY, LOANTYPE } from "./loan.interface";
import { LoanLadder } from "./loan-ladder.model";
import { UserService } from "../users/user.service";
import { TransferService } from "../transfers/transfer.service";
import { NotificationService } from "../notifications/notification.service";
import { APIError, BadRequestError, ConflictError, NotFoundError } from "../../exceptions";
import User from "../users/user.model";
import { sha512 } from "js-sha512";
import { getMailsByPermission } from "../../shared/utils/checkPermission";
import { ILoanLadder } from "./loan-ladder.model";
import { Transfer } from "../transfers/transfer.model";
import pino from 'pino';

const logger = pino({ name: 'loan-service' });
import { SettingsService } from "../admin/settings.service";


/* ---------- Types ---------- */

export interface CreateLoanParams {
  userId: string;
  first_name: string;
  last_name: string;
  dob: string;
  nin?: string;
  email?: string;
  bvn?: string;
  phone?: string;
  address?: string;
  company?: string;
  company_address?: string;
  annual_income?: string;
  guarantor_1_name?: string;
  guarantor_1_phone?: string;
  guarantor_2_name?: string;
  guarantor_2_phone?: string;
  amount: number; // naira
  reason?: string;
  documentType?: string; // NIN_SLIP | NIN | NATIONAL_ID | DRIVERS_LICENSE | PASSPORT
  base64Image?: string; // ID doc
  faceVideoBase64?: string; // mandatory facial video recording
  category?: LOANCATEGORY; // working, personal etc.
  type?: LOANTYPE;
  status?: string;
  duration?: number;
  repayment_amount?: number;
  percentage: number;
  acknowledgment: boolean;
  debit_account?: string;
  debit_card?: string;
  idempotencyKey?: string;
  referralCode?: string;
}

export interface DisburseParams {
  adminId: any | "system";
  loanId: any;
  amount: number; // override amount (naira)
  idempotencyKey?: string;
}

export interface RepayParams {
  userId: any;
  loanId: any;
  amount: number; // naira
  mandatory?: number;
  idempotencyKey?: string;
  internalOnly?: boolean;
  autoDeduct?: boolean;
  skipBalanceCheck?: boolean;
  session?: any;
}

/* ---------- Constants / Helpers ---------- */

const ALLOWED_ID_DOCS = new Set([
  "NIN",
  "NIN_SLIP",
  "NATIONAL_ID",
  "DRIVERS_LICENSE",
  "PASSPORT",
  "NIN Slip",
  "NIN_SLIP"
]);

function requiredParam(name: string, v: any) {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    throw new BadRequestError(`${name} is required`);
  }
}

/**
 * daysBetween(now, dueDate)
 * positive -> now is after dueDate (i.e. late)
 */
function daysBetween(d1: Date, d2: Date) {
  const ms = d1.getTime() - d2.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/* ---------- Service ---------- */

export class LoanService {
  private static vfd = new VfdProvider();

  /* ---------------------
   * Mono credit lookup + mapper
   * --------------------- */
  private static formatMonoDate(dateStr?: string) {
    if (!dateStr) return new Date().toISOString();
    const parts = dateStr.split("-");
    if (parts.length !== 3) return new Date().toISOString();
    const [d, m, y] = parts;
    return new Date(`${y}-${m}-${d}`).toISOString();
  }

  private static convertToCreditScore(rawData: any): ICreditScore | null {
    if (!rawData || rawData.error) return null;
    const creditHistories = rawData.credit_history || [];
    const loan_details = creditHistories.flatMap((ch: any) =>
      (ch.history || []).map((h: any) => {
        const repaymentAmount = isNaN(Number(h.repayment_amount)) ? 0 : Number(h.repayment_amount);
        return {
          loanProvider: ch.institution || "Unknown",
          accountNumber: "N/A",
          loanAmount: repaymentAmount,
          outstandingBalance: 0,
          status: h.loan_status || "",
          performanceStatus: h.performance_status || "",
          overdueAmount: 0,
          type: "N/A",
          loanDuration: `${h.tenor || 0} months`,
          repaymentFrequency: h.repayment_frequency || "",
          repaymentBehavior: h.repayment_schedule?.[0]?.status || "",
          paymentProfile: h.repayment_schedule?.[0]?.status || "",
          dateAccountOpened: this.formatMonoDate(h.date_opened),
          lastUpdatedAt: this.formatMonoDate(h.closed_date),
          loanCount: ch.history.length,
          monthlyInstallmentAmt: repaymentAmount
        };
      })
    );

    const totalDebt = loan_details.reduce((sum: number, ld: any) => sum + (ld.loanAmount || 0), 0);

    return {
      lastReported: rawData.timestamp || new Date().toISOString(),
      creditorName: creditHistories[0]?.institution || "Unknown",
      totalDebt: String(totalDebt),
      outstandingBalance: 0,
      activeLoan: loan_details.filter((l: any) => l.status === "open").length,
      loansTaken: loan_details.length,
      repaymentHistory: loan_details[0]?.repaymentBehavior || "",
      openedDate: loan_details[0]?.dateAccountOpened || "",
      lengthOfCreditHistory: "0 years",
      remarks: loan_details[0]?.performanceStatus ? `Loan is ${loan_details[0].performanceStatus}` : "",
      creditors: creditHistories.map((ch: any) => ({
        Subscriber_ID: ch.institution,
        Name: ch.institution,
        Phone: "",
        Address: ""
      })),
      loan_details
    };
  }

  private static async monoCreditLookup(bvn?: string) {
    if (!bvn) return { error: "No BVN provided" };
    const url = "https://api.withmono.com/v3/lookup/credit-history/all";
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      "mono-sec-key": process.env.MONO_SECRET_KEY || "live_sk_axio44pdonk6lb6rdhxa"
    };
    const options: AxiosRequestConfig = {
      url,
      method: "POST",
      headers,
      data: { bvn },
      timeout: 20_000
    };
    try {
      const resp = await axios(options);
      if (![200, 202].includes(resp.status)) {
        return { error: `Mono lookup failed: ${resp.data?.message || resp.statusText}` };
      }
      return resp.data.data;
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || "unknown";
      return { error: message };
    }
  }

  /* ---------------------
   * Create Loan Application
   * - validate input
   * - require ID doc + face video
   * - prevent guarantors with active loans
   * - run credit lookup (best-effort)
   * - save loan (not-started)
   * - notify user & admin (non-fatal)
   * --------------------- */
  static async createLoan(params: CreateLoanParams): Promise<ILoan> {
    console.log({ params })
    requiredParam("userId", params.userId);
    requiredParam("first_name", params.first_name);
    requiredParam("last_name", params.last_name);
    requiredParam("dob", params.dob);
    requiredParam("amount", params.amount);

    requiredParam("documentType", params.documentType);
    requiredParam("base64Image", params.base64Image);
    requiredParam("faceVideoBase64", params.faceVideoBase64);

    if (!ALLOWED_ID_DOCS.has(params.documentType!)) {
      throw new BadRequestError(`documentType must be one of: ${[...ALLOWED_ID_DOCS].join(", ")}`);
    }

    // ensure user exists
    const user = await User.findOne({ _id: params.userId });
    if (!user || Array.isArray(user) || !user._id) throw new NotFoundError("User not found");

    // prevent duplicate active loans for requester
    const existingActive = await Loan.find({
      userId: params.userId,
      loan_payment_status: { $in: ["in-progress", "not-started"] },
      status: { $in: ["pending", "processing", "accepted"] }
    });

    if (existingActive && existingActive.length > 0) {
      throw new ConflictError("Duplicate loan attempt. Wait for current loan decision or repay the existing one.");
    }

    // Check guarantors - they cannot have active loans (if provided)
    const guarantorPhones = [params.guarantor_1_phone, params.guarantor_2_phone].filter(Boolean) as string[];
    for (const phone of guarantorPhones) {
      const gUser = await User.findOne({ "user_metadata.phone": phone });
      if (gUser && !Array.isArray(gUser) && gUser._id) {
        const gActive = await Loan.findOne({
          userId: gUser._id,
          loan_payment_status: { $in: ["in-progress", "not-started"] },
          status: { $in: ["pending", "processing", "accepted"] }
        });

        if (gActive) {
          throw new BadRequestError(`Guarantor (${phone}) has an active loan and cannot be used.`);
        }
      }
    }

    // perform credit lookup (best-effort)
    // TEMPORARILY DISABLED to save API costs
    // const mono = await this.monoCreditLookup(params.bvn || user.user_metadata?.bvn);
    const mono: any = null;
    const creditScoreObj = this.convertToCreditScore(mono);

    const loanDate = new Date();

    // Add duration (in days) to the repayment date
    const repaymentDate = new Date(loanDate);
    repaymentDate.setDate(repaymentDate.getDate() + Number(params.duration));

    // Fetch dynamic loan interest and fee
    const settings = await SettingsService.getSettings();
    const interestConfig = settings.loan?.interest;
    // Store the interest RATE as the human number (e.g. 10 for "10%"), NOT the
    // fraction 0.1 - the admin renders `${loan.percentage}%` and the wizard
    // showed "200%" because it was fed the interest amount.
    const interestRate = interestConfig ? Number(interestConfig.value || 0) : 0;

    // Build and persist loan record
    // Destructure to exclude fields that should only be set during disbursement
    const { repayment_amount: _ra, outstanding: _oa, ...safeParams } = params as any;

    const loanPayload: Partial<ILoan> = {
      ...safeParams,
      percentage: interestRate,
      userId: params.userId,
      requested_amount: params.amount,
      amount: params.amount, // store Naira (requested amount; updated to disbursed amount on disbursal)
      loan_date: loanDate.toISOString(),
      repayment_date: repaymentDate.toISOString(),
      loan_payment_status: "not-started",
      credit_message: mono?.error || "available",
      credit_score: creditScoreObj,
      status: params.status as LOANSTATUS || "pending",
      repayment_history: [],
      referralCode: params.referralCode,
      // These are explicitly NOT set at creation — they are calculated during disbursement
      outstanding: 0,
      repayment_amount: 0,
    };

    const created = await Loan.create(loanPayload);

    // Notify (best-effort)
    try {
      await NotificationService.sendLoanApplicationUser(user, created)

      const admins = await getMailsByPermission("manage_loans");

      await NotificationService.sendLoanApplicationAdmin(
        user,
        `New Loan Created From User: ${user.user_metadata.first_name}`,
        `A new loan has been created by ${user.user_metadata.first_name} ${user.user_metadata.surname}.\n\nDetails:\n- Amount: ${params.amount}\n- Category: ${params.category}\n- Duration: ${params.duration}\n\nLoanId: ${created._id}`,
        admins,
        created
      )
    } catch (err) {
      /* non-fatal */
      console.warn("Loan notification failed (non-fatal):", err);
    }

    // save idempotent response if key provided
    if (params.idempotencyKey) {
      await saveIdempotentResponse(params.idempotencyKey, params.userId, created);
    }

    return created;
  }

  /* ---------------------
   * Disburse loan (admin)
   * - ledger-first: create transfer record via TransferService (PENDING)
   * - call provider
   * - on success: complete transfer, update loan, ledger entries
   * - on failure: mark transfer failed
   * --------------------- */
  /**
   * If the borrower linked a bank through a Mono direct-debit mandate, it must be
   * `ready_to_debit` before we disburse. Re-checks Mono live, persists what it
   * learns, and on "not ready" releases the disbursement lock and throws a
   * BadRequestError the admin UI shows verbatim.
   */
  private static async assertBankMandateReadyForDisbursement(lockLoan: any) {
    const { AutoDebit } = await import('./auto-debit.model');
    const mandate = await AutoDebit.findOne({
      userId: String(lockLoan.userId),
      type: 'bank',
      provider: 'mono',
      status: { $in: ['initiating', 'pending', 'approved', 'active'] },
    }).sort({ createdAt: -1 });

    if (!mandate) return; // no Mono mandate (other provider / none) — not our gate

    let ready = mandate.status === 'active';
    let mapped: any;
    try {
      const { MonoProvider } = await import('../../shared/providers/mono.provider');
      const { mapMonoMandateStatus } = await import('../../shared/providers/mono.status');
      const raw = await new MonoProvider().getMandateStatus(mandate.token);
      mapped = mapMonoMandateStatus(raw);
      if (mandate.status !== mapped.local || mandate.providerStatusRaw !== mapped.raw) {
        mandate.status = mapped.local;
        mandate.providerStatusRaw = mapped.raw;
        mandate.lastSyncedAt = new Date();
        await mandate.save();
      }
      ready = mapped.readyToDebit;
    } catch (e: any) {
      logger.warn({ err: e.message, mandateId: mandate.token }, 'disburse gate: Mono mandate re-check failed, using local status');
    }

    if (ready) return;

    // release the lock so a later retry (or a reject) can proceed
    lockLoan.status = 'pending';
    await lockLoan.save();

    if (mapped?.terminal) {
      throw new BadRequestError(
        `The borrower's bank mandate is ${mapped.raw || 'no longer valid'}. You can reject this loan, or ask the borrower to re-link their bank before disbursing.`
      );
    }
    throw new BadRequestError(
      `The borrower's bank mandate is not yet ready to debit (currently: ${mapped?.raw || mandate.status}). This normally clears within a few minutes - please hold and try disbursing again shortly.`
    );
  }

  static async disburseLoan(params: DisburseParams) {
    requiredParam("adminId", params.adminId);
    requiredParam("loanId", params.loanId);
    requiredParam("amount", params.amount);

    // 1️⃣ Try to atomically lock the loan for disbursement OUTSIDE transaction
    const lockLoan = await Loan.findOneAndUpdate(
      { _id: params.loanId, status: "pending" },
      { $set: { status: "processing" } },
      { new: true }
    );

    if (!lockLoan) {
      // Check if it's already processing
      const existing = await Loan.findById(params.loanId);
      if (existing?.status === "processing") {
        throw new BadRequestError("Loan is currently being processed for disbursement. Please wait.");
      }
      throw new BadRequestError("Loan must be in a pending state to be disbursed");
    }

    const transferIdempotency = params.idempotencyKey || `disburse-${lockLoan._id}`;

    try {
      const user = await User.findById(lockLoan.userId);
      if (!user) throw new NotFoundError("User not found");

      // 1️⃣.5 Mono mandate gate — do not disburse against a bank link that can't
      // yet be debited, or the loan can never be auto-recovered. Release the
      // lock and give the admin an actionable message.
      await LoanService.assertBankMandateReadyForDisbursement(lockLoan);

      // 2️⃣ Check for existing completed transfer (Idempotency Recovery)
      const existingTransfer = await Transfer.findOne({ idempotencyKey: transferIdempotency });
      if (existingTransfer && existingTransfer.status === "COMPLETED") {
        const settings = await SettingsService.getSettings();
        const fee = settings.loan?.serviceFee || 0;
        const interestConfig = settings.loan?.interest;
        const interestRate = interestConfig ? (interestConfig.percentage ? Number(params.amount) * (interestConfig.value / 100) : interestConfig.value) : 0;
        const total = Number(params.amount) + Number(fee) + interestRate;

        lockLoan.status = "accepted";
        lockLoan.amount = params.amount;
        lockLoan.outstanding = total;
        lockLoan.repayment_amount = total;
        lockLoan.loan_payment_status = "not-started";
        await lockLoan.save();

        // Recovery Ledger Entry
        await LedgerService.createDoubleEntry(
          UuidService.generateTraceId(),
          "loan_disbursement",
          `user_wallet:${user._id}`,
          params.amount,
          "loan",
          { userId: user._id as any, subtype: "disbursement" }
        );

        // Recovery Notification
        try {
          await NotificationService.sendLoanApproval(user, lockLoan as any);
        } catch (err) {
          console.warn("Notification error in recovery:", err);
        }

        return { loan: lockLoan, transfer: existingTransfer, reused: true };
      }

      // 3️⃣ Get account details
      const primeInfo = (await this.vfd.getPrimeAccountInfo())?.data;
      const userAccTyped = (await this.vfd.getAccountInfo(user.user_metadata.accountNo))?.data;

      if (!primeInfo?.accountNo || !userAccTyped?.accountNo) {
        throw new BadRequestError("Unable to get account info for disbursement");
      }

      const amountNaira = params.amount;

      // 4️⃣ Initiate transfer (Outside Transaction)
      const transferRecord = await TransferService.initiateTransfer({
        fromAccount: primeInfo.accountNo,
        userId: lockLoan.userId,
        beneficiaryName: userAccTyped.client,
        toAccount: userAccTyped.accountNo,
        amount: amountNaira,
        transferType: "intra",
        bankCode: "999999",
        remark: "Loan disbursement",
        idempotencyKey: transferIdempotency,
        walletBalance: String(userAccTyped.accountBalance),
      }, "loan-disbursement");

      // 5️⃣ Send to provider
      const transferRequest: TransferRequest = {
        fromAccount: primeInfo.accountNo,
        uniqueSenderAccountId: "",
        fromClientId: primeInfo.clientId,
        fromClient: primeInfo.client,
        fromSavingsId: primeInfo.accountId,
        toClientId: userAccTyped.clientId,
        toClient: userAccTyped.client,
        toSavingsId: userAccTyped.accountId,
        toSession: userAccTyped.accountId,
        toAccount: userAccTyped.accountNo,
        toBank: "999999",
        signature: sha512.hex(`${primeInfo.accountNo}${userAccTyped.accountNo}`),
        amount: amountNaira,
        remark: "Loan Disbursement",
        transferType: "intra",
        reference: transferRecord.reference,
      } as any;

      let providerResponse: any;
      try {
        providerResponse = await this.vfd.transfer(transferRequest);
      } catch (err: any) {
        await TransferService.failTransfer(transferRecord.reference);
        throw new APIError(409, `Provider disbursement failed: ${err.message}`);
      }

      if (!providerResponse || providerResponse.status !== "00") {
        await TransferService.failTransfer(transferRecord.reference);
        throw new APIError(409, `Disbursement failed at provider: ${JSON.stringify(providerResponse)}`);
      }

      // 6️⃣ ATOMIC COMPLETION - Provider success
      const session = await DatabaseService.startSession();
      try {
        return await DatabaseService.withTransaction(session, async () => {
          await TransferService.completeTransfer(
            transferRecord.reference,
            "loan-disbursement"
          );

          const duration = lockLoan.duration || 21;
          const settings = await SettingsService.getSettings();
          const fee = settings.loan?.serviceFee || 0;
          const interestConfig = settings.loan?.interest;
          const interestRate = interestConfig ? (interestConfig.percentage ? Number(params.amount) * (interestConfig.value / 100) : interestConfig.value) : 0;
          const total = Number(params.amount) + Number(fee) + interestRate;

          const loanDate = new Date();
          const repaymentDate = new Date(loanDate);
          repaymentDate.setDate(repaymentDate.getDate() + Number(duration));

          // Reload loan to ensure we are in session
          const sessionLoan = await Loan.findById(lockLoan._id);
          if (!sessionLoan) throw new Error("Loan not found in session");

          sessionLoan.outstanding = total;
          sessionLoan.amount = params.amount;
          sessionLoan.repayment_amount = total;
          sessionLoan.status = "accepted";
          sessionLoan.loan_date = loanDate.toISOString();
          sessionLoan.repayment_date = repaymentDate.toISOString();
          sessionLoan.loan_payment_status = "not-started";
          sessionLoan.adminAction = {
            adminId: params.adminId,
            action: "Approve",
            date: new Date().toISOString(),
          };

          await sessionLoan.save({ session });

          await LedgerService.createDoubleEntry(
            UuidService.generateTraceId(),
            "loan_disbursement",
            `user_wallet:${user._id}`,
            params.amount,
            "loan",
            { userId: user._id as any, subtype: "disbursement", session }
          );

          // 8️⃣ Notify user (best-effort)
          try {
            await NotificationService.sendLoanApproval(user, sessionLoan);
          } catch (err) {
            console.warn("Notification error:", err);
          }

          return { loan: sessionLoan, providerResponse, trxnRes: "COMPLETED", repayAmount: 0 };
        });
      } catch (dbErr: any) {
        logger.error({ err: dbErr.message, loanId: lockLoan._id }, "CRITICAL: Money sent via VFD but DB commit failed");
        throw new APIError(500, "Money sent successfully, but account status update failed. Please contact support.");
      } finally {
        await session.endSession();
      }

    } catch (e: any) {
      // Revert lock on failure ONLY if it hasn't reached provider success
      const checkLoan = await Loan.findById(params.loanId);
      if (checkLoan && checkLoan.status === "processing") {
        await Loan.findByIdAndUpdate(params.loanId, { status: "pending" });
      }
      throw e;
    }
  }


  /* ---------------------
   * Reverse Repayment
   * - Used when a webhook indicates an optimistically accepted debit actually failed
   * - Restores loan outstanding balance
   * - Reverses ledger entry
   * --------------------- */
  static async reverseRepayment(params: { loanId: string; userId: string; amount: number; reference: string }) {
    const session = await DatabaseService.startSession();
    try {
      const result = await DatabaseService.withTransaction(session, async () => {
        const loan = await Loan.findById(params.loanId);
        if (!loan) throw new NotFoundError("Loan not found");

        const newOutstanding = Number(loan.outstanding) + Number(params.amount);
        
        loan.outstanding = newOutstanding;
        if (loan.loan_payment_status === 'complete') {
          loan.loan_payment_status = 'in-progress';
        }

        const now = new Date();
        loan.repayment_history = [...(loan.repayment_history || []), {
          amount: -Number(params.amount),
          outstanding: newOutstanding,
          action: "reversal",
          date: now.toISOString()
        }];

        await loan.save({ session });

        const traceId = UuidService.generateTraceId();
        const transferRef = `reversal-${params.reference}`;

        const internalTransfer = new Transfer({
          userId: String(params.userId),
          traceId,
          fromAccount: "loan_repayment",
          toAccount: "bank_account",
          amount: Number(params.amount),
          transferType: "inter",
          status: "COMPLETED",
          reference: transferRef,
          remark: `Reversal of failed external repayment ${params.reference}`,
          processedAt: now,
          idempotencyKey: `reversal-${params.reference}`
        });

        await internalTransfer.save({ session });

        await LedgerService.createDoubleEntry(
          traceId,
          "loan_repayment",
          `user_wallet:${params.userId}`,
          Number(params.amount),
          "loan",
          {
            userId: params.userId,
            subtype: "reversal",
            idempotencyKey: `reversal-${params.reference}`,
            session
          }
        );

        logger.info({
          loanId: loan._id,
          userId: params.userId,
          amount: params.amount,
          newOutstanding: loan.outstanding,
          traceId,
          transferRef
        }, "Loan repayment reversed successfully");

        return { loan, trxnRes: internalTransfer };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /* ---------------------
   * Repay loan
   * - ledger-first: initiate internal transfer record (user -> platform)
   * - call provider
   * - on success: complete transfer, update loan outstanding, ledger entries, tx record, update credit score
   * --------------------- */
  static async repayLoan(params: RepayParams) {
    requiredParam("userId", params.userId);
    requiredParam("loanId", params.loanId);
    requiredParam("amount", params.amount);

    // ─── GLOBAL GUARD: prevent repaying an already-complete loan ───
    const guardLoan = await Loan.findById(params.loanId);
    if (!guardLoan) throw new NotFoundError("Loan not found");
    if (guardLoan.loan_payment_status === 'complete' || Number(guardLoan.outstanding) <= 0) {
      logger.warn({ loanId: params.loanId, status: guardLoan.loan_payment_status, outstanding: guardLoan.outstanding }, 'Repayment rejected — loan already fully paid');
      return { loan: guardLoan, providerResponse: { status: "00", alreadyPaid: true }, trxnRes: null, repayAmount: 0 };
    }

    // ───────────────────────────────────────────────
    // INTERNAL-ONLY PATH: Direct DB update, no VFD transfer
    // Used by autoDeductActiveLoan during savings withdrawals
    // ───────────────────────────────────────────────
    if (params.internalOnly) {
      const session = params.session || await DatabaseService.startSession();

      const executeInternalRepayment = async () => {
        const loan = await Loan.findById(params.loanId);
        if (!loan) throw new NotFoundError("Loan not found");

        // Guard: skip if already complete (race condition protection)
        if (loan.loan_payment_status === 'complete' || Number(loan.outstanding) <= 0) {
          logger.warn({ loanId: loan._id }, 'Internal repayment skipped — loan already fully paid (in-session)');
          return { loan, providerResponse: { status: "00", alreadyPaid: true }, trxnRes: null, repayAmount: 0 };
        }

        // Cap repayment at actual outstanding — never overpay
        let repayAmount = Math.min(Number(params.amount), Number(loan.outstanding));
        let newOutstanding = Math.max(0, Number(loan.outstanding) - repayAmount);
        const paidInFull = newOutstanding <= 0;

        const now = new Date();
        loan.repayment_history = [...(loan.repayment_history || []), {
          amount: repayAmount,
          outstanding: newOutstanding,
          action: "auto-deduction",
          date: now.toISOString()
        }];

        loan.outstanding = newOutstanding;
        loan.loan_payment_status = paidInFull ? "complete" : "in-progress";
        await loan.save({ session });

        // Create a Transfer record for transaction history visibility (FIX #3.1)
        // This ensures internal auto-deductions appear in user's transaction history
        const traceId = UuidService.generateTraceId();
        const transferRef = `internal-repay-${traceId}`;

        const internalTransfer = new Transfer({
          userId: String(params.userId),
          traceId,
          fromAccount: params.autoDeduct ? "bank_account" : "savings",
          toAccount: "loan_repayment",
          amount: repayAmount,
          transferType: "inter",
          status: "COMPLETED",
          reference: transferRef,
          remark: `Automatic loan repayment from ${params.autoDeduct ? "bank_account" : "savings"}`,
          processedAt: now,
          idempotencyKey: params.idempotencyKey || `auto-deduct-${loan._id}-${now.getTime()}`
        });

        await internalTransfer.save({ session });

        // Ledger double entry: savings_pool -> loan_repayment
        await LedgerService.createDoubleEntry(
          traceId,
          `user_wallet:${params.userId}`,
          "loan_repayment",
          repayAmount,
          "loan",
          {
            userId: params.userId,
            subtype: "auto_deduction",
            idempotencyKey: params.idempotencyKey || `auto-deduct-${loan._id}-${now.getTime()}`,
            session
          }
        );

        logger.info({
          loanId: loan._id,
          userId: params.userId,
          repayAmount,
          newOutstanding: loan.outstanding,
          paidInFull,
          traceId,
          transferRef
        }, "Internal-only loan repayment completed (auto-deduction from savings) with Transfer record created");

        return { loan, providerResponse: { status: "00", internal: true }, trxnRes: internalTransfer, repayAmount };
      };

      if (params.session) {
        return await executeInternalRepayment();
      } else {
        try {
          const result = await DatabaseService.withTransaction(session, executeInternalRepayment);

          // Influencer commission — fire-and-forget AFTER transaction commits
          try {
            const { InfluencerService } = await import('../influencer/influencer.service');
            InfluencerService.recordCommissionForUser(
              params.userId.toString(),
              'loan',
              Number(params.amount),
              undefined,
              (result.loan as any).referralCode
            ).catch(err => logger.warn({ err: (err as Error).message }, "Failed to record influencer commission for internal repayment"));
          } catch (err) {
            logger.warn({ err }, "Failed to import InfluencerService for internal repayment commission");
          }

          return result;
        } finally {
          await session.endSession();
        }
      }
    }

    // ───────────────────────────────────────────────
    // STANDARD PATH: Full VFD transfer + TransferService
    //
    // Architecture mirrors disburseLoan:
    //   1. All pre-flight work (fetch, balance check, initiateTransfer,
    //      vfd.transfer) runs OUTSIDE any Mongoose session.
    //   2. A fresh session is opened ONLY for the atomic DB commit that
    //      follows a confirmed VFD success.
    //
    // This guarantees that a Mongoose transaction rollback can never
    // leave money deducted at VFD without the loan being updated, and
    // conversely that a VFD failure never silently updates the loan.
    // ───────────────────────────────────────────────

    // ── Step 1: Load loan, user and live account info OUTSIDE any session ──
    const loan = await Loan.findById(params.loanId);
    if (!loan) throw new NotFoundError("Loan not found");

    const user = await User.findOne({ _id: params.userId });
    if (!user || Array.isArray(user) || !user._id) throw new NotFoundError("User not found");

    const primeInfo = (await this.vfd.getPrimeAccountInfo()).data;
    const userAcc = (await this.vfd.getAccountInfo(user.user_metadata.accountNo)).data;

    if (!primeInfo?.accountNo || !userAcc?.accountNo) {
      throw new Error("Could not fetch account info to perform repayment");
    }

    // ── Step 2: Determine repayment amount ──
    // BUG FIX: params.amount was previously ignored; repayAmount was always
    // set to loan.outstanding regardless of what the caller requested.
    // Now we honour params.amount but cap it at the actual outstanding so we
    // never overpay, and round to 2 decimal places to avoid floating-point drift.
    const userBalance = parseFloat(userAcc.accountBalance || "0");
    const repayAmount = Math.round(
      Math.min(Number(params.amount), Number(loan.outstanding)) * 100
    ) / 100;

    if (repayAmount <= 0) {
      throw new BadRequestError("Repayment amount must be greater than zero");
    }

    // ── Step 3: Balance check against live provider balance BEFORE any transfer ──
    // BUG FIX: The check was previously inside the Mongoose transaction, meaning
    // the provider balance fetch could be stale by the time the VFD call happened.
    // It now runs on the freshly fetched balance, strictly before any money moves.
    //
    // BUG FIX: `parseFloat(userAcc.accountBalance || "0")` returns NaN if
    // `accountBalance` is present but non-numeric (e.g. an error string,
    // undefined nested field, etc.). Any comparison against NaN — including
    // `NaN < repayAmount` — is always `false`, so this check silently passed
    // even when the account had no usable balance, letting the code proceed
    // to attempt a real VFD transfer (and, if VFD errored with status "98",
    // the loan would still be marked as repaid with no money actually moved).
    // We now explicitly fail closed if the balance can't be determined.
    if (!params.skipBalanceCheck && (isNaN(userBalance) || userBalance < repayAmount)) {
      throw new BadRequestError(
        isNaN(userBalance)
          ? `Could not determine account balance for this repayment.`
          : `Insufficient funds. Your balance is ₦${userBalance.toLocaleString()}, but ₦${repayAmount.toLocaleString()} is required for this repayment.`
      );
    }

    // ── Step 4: Create internal PENDING transfer record OUTSIDE session ──
    // BUG FIX: Previously inside withTransaction — if the session rolled back,
    // this record was also rolled back, leaving no audit trail for a VFD deduction.
    const transferIdempotency = params.idempotencyKey || `repay-${UuidService.generate()}`;
    const transferRecord = await TransferService.initiateTransfer({
      fromAccount: userAcc.accountNo,
      beneficiaryName: primeInfo.client,
      userId: String(user._id),
      toAccount: primeInfo.accountNo,
      amount: repayAmount,
      transferType: "intra",
      bankCode: "999999",
      remark: "Loan repayment",
      idempotencyKey: transferIdempotency,
      walletBalance: String(userBalance)
    }, "loan-repayment");

    // ── Step 5: Call VFD provider OUTSIDE session — money moves here ──
    // BUG FIX: Previously inside withTransaction. Any DB failure after this
    // call caused Mongoose to roll back the loan update while VFD money was
    // already gone. By moving it outside, the DB commit (Step 6) is a separate
    // concern; if it fails we log CRITICAL and surface a recoverable error.
    const transferRequest: TransferRequest = {
      fromAccount: userAcc.accountNo,
      uniqueSenderAccountId: userAcc.accountId,
      fromClientId: userAcc.clientId,
      fromClient: userAcc.client,
      fromSavingsId: userAcc.accountId,
      toClientId: primeInfo.clientId,
      toClient: primeInfo.client,
      toSavingsId: primeInfo.accountId,
      toSession: primeInfo.accountId,
      toAccount: primeInfo.accountNo,
      toBank: "999999",
      signature: sha512.hex(`${userAcc.accountNo}${primeInfo.accountNo}`),
      amount: repayAmount,
      remark: `${params.mandatory ? "Mandatory" : "Voluntary"} Loan Repayment`,
      transferType: "intra",
      reference: transferRecord.reference
    } as any;

    let providerResponse: any;
    try {
      providerResponse = await this.vfd.transfer(transferRequest);
    } catch (err: any) {
      const providerData = err.response?.data;
      // BUG FIX: status "98" from VFD nominally means "duplicate / already
      // processed", implying a PRIOR call with this reference already moved
      // the money. Previously this was trusted blindly — any error payload
      // with status "98" (which some VFD error paths can also return for
      // unrelated failures, e.g. invalid/empty source account) was treated
      // as a successful transfer, and the DB was then committed as if the
      // repayment succeeded even though no money had moved. We now verify
      // that an actual completed transfer with this reference exists at VFD
      // before trusting "98"; otherwise we fail closed.
      if (providerData?.status === "98") {
        let verified = false;
        try {
          const txStatus = await this.vfd.queryTransaction?.(transferRecord.reference);
          verified = !!txStatus && (txStatus.status === "00" || txStatus.data?.transactionStatus.toLowerCase() === "success" || txStatus.data?.transactionStatus.toLowerCase() === "successfull");
        } catch (verifyErr: any) {
          logger.warn({ reference: transferRecord.reference, error: verifyErr.message },
            'Could not verify VFD status-98 transfer; treating as failed');
        }

        if (verified) {
          providerResponse = providerData;
        } else {
          await TransferService.failTransfer(transferRecord.reference);
          throw new Error(
            `Repayment provider transfer failed: VFD returned status 98 (duplicate/already-processed) but no completed transfer could be verified for reference ${transferRecord.reference}`
          );
        }
      } else {
        await TransferService.failTransfer(transferRecord.reference);
        const providerError = providerData?.message || providerData || err.message;
        throw new Error(`Repayment provider transfer failed: ${String(providerError)}`);
      }
    }

    const ok = providerResponse && (providerResponse.status === "00" || providerResponse.status === "98");
    if (!ok) {
      await TransferService.failTransfer(transferRecord.reference);
      throw new Error(`Repayment failed at provider: ${JSON.stringify(providerResponse)}`);
    }

    // ── Step 6: ATOMIC DB COMMIT — VFD confirmed, now update all DB state ──
    // We open a fresh session here (not reusing params.session, which belongs
    // to a caller context that has no relation to VFD atomicity).
    const session = await DatabaseService.startSession();
    try {
      const result = await DatabaseService.withTransaction(session, async () => {
        // 6a) Mark internal transfer as completed
        const trxnRes = await TransferService.completeTransfer(transferRecord.reference, "loan-repayment");

        // 6b) Re-fetch loan inside session for a consistent snapshot
        // BUG FIX: Previously the code reused the `loan` variable read before
        // the VFD call. Re-fetching inside the session ensures we compute
        // newOutstanding from the value actually stored in the DB, not a
        // potentially stale in-memory copy, and that our save is atomic.
        const sessionLoan = await Loan.findById(params.loanId);
        if (!sessionLoan) throw new Error("Loan not found in session");

        // 6c) Compute new outstanding using the exact repayAmount sent to VFD
        const newOutstanding = Math.max(0, Number(sessionLoan.outstanding) - repayAmount);
        const paidInFull = newOutstanding <= 0;
        const now = new Date();

        sessionLoan.repayment_history = [...(sessionLoan.repayment_history || []), {
          amount: repayAmount,
          outstanding: newOutstanding,
          action: "repayment",
          date: now.toISOString()
        }];
        sessionLoan.outstanding = newOutstanding;
        sessionLoan.loan_payment_status = paidInFull ? "complete" : "in-progress";
        await sessionLoan.save({ session });

        logger.info({ loanId: sessionLoan._id, repayAmount, newOutstanding, paidInFull }, "Loan repayment DB committed");

        // 6d) Ledger double entry: user_wallet -> loan_repayment
        await LedgerService.createDoubleEntry(
          UuidService.generateTraceId(),
          `user_wallet:${user._id}`,
          "loan_repayment",
          repayAmount,
          "loan",
          {
            userId: user._id as any,
            subtype: "repayment",
            idempotencyKey: params.idempotencyKey,
            session
          }
        );

        // 6e) Update credit score based on repayment timeliness (non-fatal)
        try {
          const dueDateISO = sessionLoan.repayment_date;
          if (dueDateISO) {
            const dueDate = new Date(dueDateISO);
            const daysLate = daysBetween(now, dueDate); // positive = late
            const [newScore, ladderIndex, , message] = LoanService.computeCreditScoreFromTimeliness(
              daysLate, user.user_metadata.ladderIndex || 1
            );
            user.user_metadata.creditScore = newScore;
            user.user_metadata.ladderIndex = ladderIndex;
            await user.save({ session });
            await NotificationService.sendLoanRepayment(user, repayAmount, message);
          }
        } catch (err) {
          console.warn("Failed updating credit score (non-fatal):", err);
        }

        return { loan: sessionLoan, providerResponse, trxnRes, repayAmount };
      });

      // Influencer commission — fire-and-forget AFTER transaction commits
      try {
        const { InfluencerService } = await import('../influencer/influencer.service');
        InfluencerService.recordCommissionForUser(
          params.userId.toString(),
          'loan',
          repayAmount,
          undefined,
          (result.loan as any).referralCode
        ).catch(err => logger.warn({ err: (err as Error).message }, "Failed to record influencer commission for standard repayment"));
      } catch (err) {
        logger.warn({ err }, "Failed to import InfluencerService for standard repayment commission");
      }

      return result;
    } catch (dbErr: any) {
      // CRITICAL: VFD transfer succeeded (money moved) but DB commit failed.
      // The loan outstanding has NOT been updated. Ops must reconcile manually.
      logger.error(
        { err: dbErr.message, loanId: params.loanId, userId: params.userId, repayAmount, transferRef: transferRecord.reference },
        "CRITICAL: Money deducted via VFD but DB commit failed for repayment — manual reconciliation required"
      );
      throw new APIError(500, "Payment was processed successfully but your loan record could not be updated. Please contact support immediately.");
    } finally {
      await session.endSession();
    }
  }

  /**
   * Compute numeric credit score (0.0 - 1.0) based on `daysLate`.
   * daysLate < 0: before due date -> 1.0
   * daysLate === 0: on due date -> 0.9
   * 1-3 days late -> 0.6
   * 4-5 days late -> 0.5
   * 6-7 days late -> 0.4
   * >7 days late -> 0.3
   */
  private static computeCreditScoreFromTimeliness(daysLate: number, ladderIndex: number): [number, number, string, string] {
    if (daysLate < 0) return [1000, ladderIndex + 1, "before_due_date", "Continue making payment before due date to keep a perfect credit score and unlock larger loan amounts"];
    if (daysLate === 0) return [900, ladderIndex + 1, "on_due_date", "Make sure to pay on or before the due date to maintain a good credit score and unlock larger loan amounts"];
    if (daysLate <= 3) return [600, ladderIndex, "1-3_days_late", "Paying within 1-3 days after the due date may impact your credit score and may result in higher interest rates as well as inability to unlock larger loan amounts"];
    if (daysLate <= 5) return [500, ladderIndex > 0 ? ladderIndex - 1 : 0, "4-5_days_late", "Paying 4-5 days late will negatively affect your credit score and may result in higher interest rates as well as inability to unlock larger loan amounts"];
    if (daysLate <= 7) return [400, ladderIndex > 0 ? ladderIndex - 1 : 0, "6-7_days_late", "Paying 6-7 days late will further impact your credit score and may result in higher interest rates as well as inability to unlock larger loan amounts"];
    return [300, ladderIndex > 1 ? ladderIndex - 2 : 0, "over_7_days_late", "Paying over 7 days late will significantly harm your credit score and may result in higher interest rates as well as loan denial"];
  }

  /* ---------------------
   * Cancel a loan (user)
   * --------------------- */
  static async cancelLoan(userId: string, loanId: string, reason: string) {
    requiredParam("userId", userId);
    requiredParam("loanId", loanId);
    requiredParam("reason", reason);

    const loan = await Loan.findById(loanId);
    if (!loan) throw new NotFoundError("Loan not found");
    if (loan.status !== "pending") throw new BadRequestError(`Cannot cancel loan in ${loan.status} state`);

    loan.outstanding = 0;
    loan.rejectionReason = reason;
    loan.status = "canceled";
    loan.percentage = typeof loan.percentage === "string"
      ? Number(String(loan.percentage).replace("%", ""))
      : loan.percentage;

    await loan.save();

    return loan;
  }

  /* ---------------------
   * Reject a loan (admin)
   * --------------------- */
  static async rejectLoan(adminId: string, loanId: string, reason: string) {
    requiredParam("adminId", adminId);
    requiredParam("loanId", loanId);
    requiredParam("reason", reason);

    const loan = await Loan.findOneAndUpdate(
      { _id: loanId, status: "pending" },
      { $set: { status: "processing_rejection" } },
      { new: true }
    );

    if (!loan) {
      const existingLoan = await Loan.findById(loanId);
      if (!existingLoan) throw new NotFoundError("Loan not found");
      throw new BadRequestError(`Cannot reject loan in ${existingLoan.status} state`);
    }

    loan.outstanding = 0;
    loan.rejectionReason = reason;
    loan.status = "rejected";
    loan.percentage = typeof loan.percentage === "string"
      ? Number(String(loan.percentage).replace("%", ""))
      : loan.percentage;

    loan.adminAction = {
      adminId,
      action: "Reject",
      date: new Date().toISOString()
    };

    await loan.save();

    const user = await UserService.getUser(loan.userId);

    if (user) {
      try {
        await NotificationService.sendLoanRejection(user, loan.amount, reason);
      } catch (error) {
        console.error('Failed to send loan rejection email:', error);
      }
    }

    return loan;
  }

  /* ---------------------
   * Query helpers (paginated)
   * --------------------- */
  static async getLoanById(id: string) {
    if (!id) return null;
    return Loan.findById(id);
  }

  static async listLoansForUser(userId: string, page = 1, limit = 10) {
    if (!userId) return { data: [], total: 0, page, pages: 0 };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Loan.find({ userId }).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Loan.countDocuments({ userId })
    ]);
    return { data, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  static async listAllLoans(page = 1, limit = 20, filter: any = {}) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Loan.find({}).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Loan.countDocuments(filter)
    ]);
    return { data, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * Admin loan portfolio analytics
  */
  static async getAdminLoanStats() {
    const now = new Date();

    // ⚙️ Cache loan profit config once (avoid N+1)
    const loanProfitConfigs = await SettingsService.getProfitConfig("loan");

    // 📊 Only fetch required fields
    const loans = await Loan.find(
      {},
      {
        amount: 1,
        requested_amount: 1,
        repayment_amount: 1,
        outstanding: 1,
        loan_payment_status: 1,
        repayment_date: 1,
        status: 1,
        repayment_history: 1,
        userId: 1,
      }
    );

    // Initialize stats
    const stats = {
      totalApplied: 0,
      appliedUsers: 0,
      totalDisbursed: 0,
      disbursedUsers: 0,
      realizedProfit: 0,
      unrealizedProfit: 0,
      activeLoans: 0,
      activeAmount: 0,
      dueLoans: 0,
      dueAmount: 0,
      pendingLoans: 0,
      pendingAmount: 0,
      overdueLoans: 0,
      overdueAmount: 0,
      repaidLoans: 0,
      repaidAmount: 0,
      repaidingLoans: 0,
      repaidingAmount: 0,
      notStarted: 0,
    };

    let expectedProfit = 0;
    let realizedProfit = 0;

    // 🧠 Helper: compute expected profit once per loan
    const computeExpectedProfit = (amount: number): number => {
      let total = 0;
      for (const config of loanProfitConfigs) {
        if (amount < config.minAmount || amount > config.maxAmount) continue;
        if (config.type === "percentage") total += (config.amount) * amount;
        else total += config.amount || 0;
      }
      return total;
    };

    // 🧠 Helper: sum valid payments
    const sumRepayments = (repayments: any[] = []) =>
      repayments.reduce((acc, p) => {
        if (p.action === "overdue_fee") return acc; // ignore penalties
        const val = Number(p.amount);
        return acc + (isNaN(val) ? 0 : val);
      }, 0);

    // 🧠 Helper: sum penalties
    const sumPenalties = (repayments: any[] = []) =>
      repayments.reduce((acc, p) => {
        if (p.action === "overdue_fee") {
          const val = Number(p.amount);
          return acc + (isNaN(val) ? 0 : val);
        }
        return acc;
      }, 0);

    for (const loan of loans) {
      const amount = loan.amount || 0;
      const outstanding = loan.outstanding || 0;
      const dueDate = loan.repayment_date ? new Date(loan.repayment_date) : null;

      stats.totalApplied += Number(loan?.requested_amount) || 0;
      stats.appliedUsers++;

      // ✅ Disbursed loans
      if (loan.status === "accepted") {
        stats.totalDisbursed += amount;
        stats.disbursedUsers++;
      }

      // ✅ Pending loans
      if (loan.status === "pending") {
        stats.pendingLoans++;
        stats.pendingAmount += amount;
      }

      // ✅ Loan states
      if (
        ["accepted", "processing", "pending"].includes(loan.status) &&
        ["in-progress", "not-started"].includes(loan.loan_payment_status)
      ) {
        if (dueDate) {
          if (dueDate > now) {
            stats.activeLoans++;
            stats.activeAmount += outstanding;
          } else if (dueDate.toDateString() === now.toDateString()) {
            stats.dueLoans++;
            stats.dueAmount += outstanding;
          } else {
            stats.overdueLoans++;
            stats.overdueAmount += outstanding;
          }
        }
      }

      // ✅ Repaid loans
      if (loan.loan_payment_status === "complete" && loan.status === "accepted") {
        stats.repaidLoans++;
        const sum = sumRepayments(loan.repayment_history);
        const penalties = sumPenalties(loan.repayment_history);
        stats.repaidAmount += sum;
        realizedProfit += sum - amount;
        expectedProfit += computeExpectedProfit(amount) + penalties;
      }

      const sum = sumRepayments(loan.repayment_history);

      // ✅ In-progress loans
      if (loan.loan_payment_status === "in-progress" && sum > 0 && loan.status === "accepted") {
        stats.repaidingLoans++;
        const penalties = sumPenalties(loan.repayment_history);
        stats.repaidingAmount += sum;
        if (sum > amount) realizedProfit += sum - amount;
        expectedProfit += computeExpectedProfit(amount) + penalties;
      }

      // ✅ Not started
      if (
        loan.status === "accepted" &&
        loan.loan_payment_status === "not-started"
      ) {
        stats.notStarted++;
        expectedProfit += computeExpectedProfit(amount);
        expectedProfit += sumPenalties(loan.repayment_history);
      }
    }

    // ✅ Profit calculations
    stats.realizedProfit = Math.max(realizedProfit, 0);
    stats.unrealizedProfit = Math.max(expectedProfit - realizedProfit, 0);

    return {
      totalLoans: loans.length,
      ...stats,
    };
  }

  /**
   * Get loans & users by category for admin
   */
  static async getLoansByCategory(
    category?: "active" | "due" | "overdue" | "completed" | "pending" | "rejected" | "canceled",
    page = 1,
    limit = 20,
    search?: string
  ) {
    const now = new Date();
    const filter: any = {};

    console.log({ category, page, limit, search });

    switch (category) {
      case "active":
        filter.status = { $in: ["accepted", "processing", "pending"] };
        filter.loan_payment_status = { $in: ["in-progress", "not-started"] };
        break;

      case "due":
        filter.status = "accepted";
        filter.loan_payment_status = { $in: ["in-progress", "not-started"] };
        filter.$expr = {
          $lte: [{ $toDate: "$repayment_date" }, now],
        };
        break;

      case "overdue":
        filter.status = "accepted";
        filter.loan_payment_status = { $in: ["in-progress", "not-started"] };
        filter.$expr = {
          $lt: [{ $toDate: "$repayment_date" }, now],
        };
        break;

      case "completed":
        filter.loan_payment_status = "complete";
        break;

      case "pending":
        filter.status = "pending";
        break;

      case "rejected":
        filter.status = "rejected";
        break;

      case "canceled":
        filter.status = "canceled";
        break;
    }

    if (search) {
      const regex = new RegExp(search, "i"); // case-insensitive search
      filter.$or = [
        { first_name: regex },
        { last_name: regex },
        { email: regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$first_name", " ", "$last_name"] },
              regex: search,
              options: "i",
            },
          },
        },
      ];
    }

    const skip = (page - 1) * limit;

    const [loans, total] = await Promise.all([
      Loan.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Loan.countDocuments(filter),
    ]);

    // Populate user info (admin view)
    const userIds = loans.map((l) => l.userId);
    const users = await User.find({ _id: { $in: userIds } }, { email: 1, user_metadata: 1 });

    return {
      loans,
      users,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }



  /* ------------------------------
  * Loan Ladder (Admin + User)
  * ------------------------------ */
  static async createLoanLadder(adminId: string, step: number, amount: number, adminNotes?: string) {
    if (!adminId) throw new BadRequestError("Admin ID is required");
    if (step === undefined || step === null) throw new BadRequestError("Step is required");
    if (amount === undefined || amount === null) throw new BadRequestError("Amount is required");

    // Ensure no duplicate step exists
    const existing = await LoanLadder.findOne({ step });
    if (existing) throw new ConflictError(`Step ${step} already exists in loan ladder`);

    const ladder = await LoanLadder.create({
      step,
      amount,
      verifiedBy: adminId,
      meta: { adminNotes },
    });

    return ladder;
  }

  static async updateLoanLadder(adminId: string, id: string, updates: Partial<ILoanLadder>) {
    if (!adminId) throw new BadRequestError("Admin ID is required");
    if (!id) throw new BadRequestError("Ladder ID is required");

    const ladder = await LoanLadder.findById(id);
    if (!ladder) throw new NotFoundError("Loan ladder entry not found");

    Object.assign(ladder, updates, { verifiedBy: adminId });
    await ladder.save();

    return ladder;
  }

  static async deleteLoanLadder(adminId: string, id: string) {
    if (!adminId) throw new BadRequestError("Admin ID is required");
    if (!id) throw new BadRequestError("Ladder ID is required");

    const ladder = await LoanLadder.findById(id);
    if (!ladder) throw new NotFoundError("Loan ladder entry not found");

    await LoanLadder.findByIdAndDelete(id);
    return { message: "Loan ladder entry deleted successfully" };
  }

  static async getLoanLadders(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      LoanLadder.find().skip(skip).limit(limit).sort({ step: 1 }),
      LoanLadder.countDocuments(),
    ]);
    return { data, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  static async getLoanLadderById(id: string) {
    if (!id) throw new BadRequestError("Ladder ID is required");
    const ladder = await LoanLadder.findById(id);
    if (!ladder) throw new NotFoundError("Loan ladder not found");
    return ladder;
  }
}