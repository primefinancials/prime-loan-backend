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
import { SettingsService } from "../admin/settings.service";
import pino from "pino";

const logger = pino({ name: "loan-service" });

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
      "mono-sec-key": process.env.MONO_SEC_KEY || "live_sk_axio44pdonk6lb6rdhxa"
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
      status: { $in: ["pending", "accepted", "active"] }
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
          status: { $in: ["pending", "accepted", "active"] }
        });

        if (gActive) {
          throw new BadRequestError(`Guarantor (${phone}) has an active loan and cannot be used.`);
        }
      }
    }

    // perform credit lookup (best-effort)
    const mono = await this.monoCreditLookup(params.bvn || user.user_metadata?.bvn);
    const creditScoreObj = this.convertToCreditScore(mono);

    const loanDate = new Date();

    // Add duration (in days) to the repayment date
    const repaymentDate = new Date(loanDate);
    repaymentDate.setDate(repaymentDate.getDate() + Number(params.duration));

    // Fetch dynamic loan interest and fee
    const settings = await SettingsService.getSettings();
    const percentage = settings.loan?.interestPercentage || 0;

    // Build and persist loan record
    const loanPayload: Partial<ILoan> = {
      ...params,
      percentage,
      userId: params.userId,
      requested_amount: params.amount,
      amount: params.amount, // store Naira
      loan_date: loanDate.toISOString(),
      repayment_date: repaymentDate.toISOString(),
      loan_payment_status: "not-started",
      credit_message: mono?.error || "available",
      credit_score: creditScoreObj,
      status: params.status as LOANSTATUS || "pending",
      repayment_history: []
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

    const session = await DatabaseService.startSession();

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const { loanId, adminId } = params;
        const loan = lockLoan;

        const user = await User.findById(loan.userId).session(session);
        if (!user) throw new NotFoundError("User not found");

        // 2️⃣ Ensure idempotency key
        const transferIdempotency = params.idempotencyKey || `disburse-${loan._id}`;
        const existingTransfer = await Transfer.findOne({ idempotencyKey: transferIdempotency }).session(session);
        if (existingTransfer) {
          // Return existing disbursement result if already processed
          return { loan, transfer: existingTransfer, reused: true };
        }

        // 3️⃣ Get account details
        const primeInfo = (await this.vfd.getPrimeAccountInfo())?.data;
        const userAccTyped = (await this.vfd.getAccountInfo(user.user_metadata.accountNo))?.data;

        if (!primeInfo?.accountNo || !userAccTyped?.accountNo) {
          throw new Error("Unable to get account info for disbursement");
        }

        const amountNaira = params.amount;

        // 4️⃣ Initiate transfer
        const transferRecord = await TransferService.initiateTransfer({
          fromAccount: primeInfo.accountNo,
          userId: loan.userId,
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
          logger.error({ 
            err: err.message, 
            response: err.response?.data, 
            payload: transferRequest 
          }, "VFD Transfer failed");
          throw new APIError(409, `Provider disbursement failed: ${err.response?.data?.message || err.message}`);
        }

        const ok =
          providerResponse &&
          (providerResponse.status === "00" ||
            providerResponse?.data?.txnId ||
            providerResponse.txnId);

        console.log({ providerResponse })

        if (!ok) {
          await TransferService.failTransfer(transferRecord.reference);
          throw new APIError(409, `Disbursement failed: ${JSON.stringify(providerResponse)}`);
        }

        const trxnRes = await TransferService.completeTransfer(
          transferRecord.reference,
          "loan-disbursement"
        );

        // 6️⃣ Compute repayment details
        const duration = loan.duration || 21;
        const settings = await SettingsService.getSettings();
        const fee = settings.loan?.serviceFee || 0;
        const percentage = settings.loan?.interestPercentage || 0;

        const total = Number(params.amount) + Number(fee) + (Number(params.amount) * (Number(percentage) / 100));

        const loanDate = new Date();

        // Add duration (in days) to the repayment date
        const repaymentDate = new Date(loanDate);
        repaymentDate.setDate(repaymentDate.getDate() + Number(duration));

        loan.outstanding = total;
        loan.amount = params.amount;
        loan.repayment_amount = total;
        loan.status = "accepted";
        loan.loan_date = loanDate.toISOString();
        loan.repayment_date = repaymentDate.toISOString();
        loan.loan_payment_status = "not-started";
        loan.adminAction = {
          adminId,
          action: "Approve",
          date: new Date().toISOString(),
        };

        loan.save();

        // 7️⃣ Ledger entry
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
          await NotificationService.sendLoanApproval(user, loan);
        } catch (err) {
          console.warn("Notification error:", err);
        }

        return { loan, providerResponse, trxnRes };
      });
    } catch (e: any) {
      // Revert lock on failure
      await Loan.findByIdAndUpdate(params.loanId, { status: "pending" });
      throw e;
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

    const session = params.session || await DatabaseService.startSession();
    const executeRepayment = async () => {
        const loan = await Loan.findById(params.loanId).session(session);
        if (!loan) throw new NotFoundError("Loan not found");

        const user = await User.findOne({ _id: params.userId });
        if (!user || Array.isArray(user) || !user._id) throw new NotFoundError("User not found");

        const primeInfo = (await this.vfd.getPrimeAccountInfo()).data;
        const userAcc = (await this.vfd.getAccountInfo(user.user_metadata.accountNo)).data;

        if (!primeInfo?.accountNo || !userAcc?.accountNo) {
          throw new Error("Could not fetch account info to perform repayment");
        }

        // Ensure user has funds (provider source of truth)
        const userBalance = parseFloat(userAcc.accountBalance || "0");
        let repayAmount = Number(params.amount);
        if (userBalance < repayAmount) {
          if (userBalance <= 0) throw new BadRequestError("Insufficient funds to repay loan");
          else repayAmount = userBalance;
        }

        // 1) internal transfer record
        const transferIdempotency = params.idempotencyKey || `repay-${UuidService.generate()}`;
        const transferRecord = await TransferService.initiateTransfer({
          fromAccount: userAcc.accountNo,
          beneficiaryName: primeInfo.client,
          userId: String(user._id),
          toAccount: primeInfo.accountNo,
          amount: params.amount,
          transferType: "intra",
          bankCode: "999999",
          remark: "Loan repayment",
          idempotencyKey: transferIdempotency,
          walletBalance: String(userBalance)
        }, "loan-repayment");

        // 2) provider transfer (user -> prime)
        let providerResponse: any = { status: "00" }; // Default success for internal
        if (!params.internalOnly) {
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

            try {
            providerResponse = await this.vfd.transfer(transferRequest);
            } catch (err: any) {
            await TransferService.failTransfer(transferRecord.reference);
            throw new Error(`Repayment provider transfer failed: ${String(err.message)}`);
            }

            const ok = providerResponse && (providerResponse.status === "00");
            if (!ok) {
            await TransferService.failTransfer(transferRecord.reference);
            throw new Error(`Repayment failed: ${JSON.stringify(providerResponse)}`);
            }
        }

        // 3) complete internal transfer
        const trxnRes = await TransferService.completeTransfer(transferRecord.reference, "loan-repayment");

        // 4) update loan outstanding & history
        let newOutstanding = Number(loan.outstanding) - Number(params.amount);

        const paidInFull = newOutstanding <= 0;

        const now = new Date();
        loan.repayment_history = [...loan.repayment_history, {
          amount: params.amount,
          outstanding: newOutstanding >= 0? newOutstanding : 0,
          action: "repayment",
          date: now.toISOString()
        }];

        loan.outstanding = newOutstanding;
        loan.loan_payment_status = paidInFull ? "complete" : "in-progress";
        loan.save();

        console.log({ newOutstanding, paidInFull, loan })

        // 5) ledger double entry: user_wallet -> platform_cash
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

        // 8) compute and persist updated credit score based on timeliness
        try {
          const dueDateISO = loan.repayment_date;
          if (dueDateISO) {
            const dueDate = new Date(dueDateISO);
            const daysLate = daysBetween(now, dueDate); // positive -> late
            const [newScore, ladderIndex, category, message] = LoanService.computeCreditScoreFromTimeliness(daysLate, user.user_metadata.ladderIndex || 1);
            user.user_metadata.creditScore = newScore;
            user.user_metadata.ladderIndex = ladderIndex;
            user.save();

            await NotificationService.sendLoanRepayment(user, repayAmount, message);
          }
        } catch (err) {
          console.warn("Failed updating credit score (non-fatal):", err);
        }

        return { loan, providerResponse, trxnRes };
      };

    if (params.session) {
      return await executeRepayment();
    } else {
      try {
        return await DatabaseService.withTransaction(session, executeRepayment);
      } finally {
        await session.endSession();
      }
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
        loan.status === "accepted" &&
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
        filter.status = "accepted";
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

