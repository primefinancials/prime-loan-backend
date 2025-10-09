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
import { getMailsByPermission } from "../../shared/utils/checkPermission";

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
}

export interface DisburseParams {
  adminId: string | "system";
  loanId: string;
  amount?: number; // override amount (naira)
  idempotencyKey?: string;
}

export interface RepayParams {
  userId: string;
  loanId: string;
  amount: number; // naira
  mandatory?: number;
  idempotencyKey?: string;
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

    // Build and persist loan record
    const loanPayload: Partial<ILoan> = {
      ...params,
      percentage: typeof params.percentage === "string" 
      ? Number(String(params.percentage).replace("%", "")) 
      : params.percentage,
      userId: params.userId,
      requested_amount: params.amount,
      amount: params.amount, // store Naira
      loan_payment_status: "not-started",
      outstanding: params.amount,
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

    const session = await DatabaseService.startSession();
    try {
      return await DatabaseService.withTransaction(session, async () => {
        const loan = await Loan.findById(params.loanId).session(session);
        if (!loan) throw new NotFoundError("Loan not found");
        if (loan.status === "accepted") throw new BadRequestError("Loan already accepted");

        const user = await User.findOne({ _id: loan.userId }, "one");
        if (!user || Array.isArray(user) || !user._id) throw new NotFoundError("User not found");

        // get prime / user account info
        const primeInfo = (await this.vfd.getPrimeAccountInfo()).data;
        const userAccTyped = (await this.vfd.getAccountInfo(user.user_metadata.accountNo)).data;

        if (!primeInfo?.accountNo || !userAccTyped?.accountNo) {
          throw new Error("Unable to get account info for disbursement");
        }

        // Determine disbursement amounts
        const amountNaira = (params.amount ?? loan.amount); // naira
        const processing_fee = Number(loan.repayment_amount - loan.amount);

        // 1) create transfer record (pending) via TransferService (ledger entry created inside TransferService)
        // generate idempotency if not provided
        const transferIdempotency = params.idempotencyKey || `disburse-${UuidService.generate()}`;
        const transferRecord = await TransferService.initiateTransfer({
          fromAccount: primeInfo.accountNo,
          userId: String(loan.userId),
          beneficiaryName: userAccTyped.client,
          toAccount: userAccTyped.accountNo,
          amount: amountNaira,
          transferType: "intra",
          bankCode: "999999",
          remark: "Loan disbursement",
          idempotencyKey: transferIdempotency
        }, "loan-disbursement");

        // build provider transfer payload (provider expects amount in kobo)
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
          signature: "", // left to provider or controller to fill if required
          amount: amountNaira, // kobo
          remark: "Loan Disbursement",
          transferType: "intra",
          reference: transferRecord.reference
        } as any;

        // 2) call provider
        let providerResponse: any;
        try {
          providerResponse = await this.vfd.transfer(transferRequest as any);
        } catch (err) {
          // fail transfer inside system
          await TransferService.failTransfer(transferRecord.reference);
          throw new APIError(409, `Provider disbursement failed: ${String(err)}`);
        }

        const ok = providerResponse && (providerResponse.status === "00" || providerResponse.data?.txnId || providerResponse.txnId);
        if (!ok) {
          await TransferService.failTransfer(transferRecord.reference);
          throw new APIError(409, `Disbursement failed: ${JSON.stringify(providerResponse)}`);
        }

        // 3) complete internal transfer
        const trxnRes = await TransferService.completeTransfer(transferRecord.reference, "loan-disbursement");

        // 4) update loan: compute total repayment schedule (fee + interest)
        const fee = 500;
        const loan_per = 10;
        const duration = loan.duration || 30;
        const percentage =
          duration / 30 >= 1
            ? ((loan.amount * loan_per)) * (duration / 30)
            : (loan.amount * loan_per);
        const total = Number(Number(loan.amount) + Number(fee + percentage));

        const loanDate = new Date();
        const repaymentDate = new Date(loanDate);
        repaymentDate.setDate(loanDate.getDate() + Number(loan.duration || duration));

        loan.outstanding = total;
        loan.status = "accepted";
        loan.loan_date = loanDate.toISOString();
        loan.repayment_date = repaymentDate.toISOString();
        loan.loan_payment_status = "in-progress";
        loan.adminAction = {
          adminId: params.adminId,
          action: "Approve",
          date: new Date().toISOString()
        };

        await loan.save({ session });

        // 5) ledger double entry: platform_cash -> user_wallet
        await LedgerService.createDoubleEntry(
          UuidService.generateTraceId(),
          "loan_disbursement", // platform funding account
          `user_wallet:${user._id}`,
          loan.amount,
          "loan",
          {
            userId: user._id,
            subtype: "disbursement",
            session
          }
        );

        // 6) notify user (best-effort)
        try {
          await NotificationService.sendLoanApproval(user, loan);
        } catch (err) { console.warn("notify error:", err); }

        // idempotent response
        if (params.idempotencyKey) {
          await saveIdempotentResponse(params.idempotencyKey, String(loan.userId), { loan, providerResponse });
        }

        return { loan, providerResponse, trxnRes };
      });
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

    const session = await DatabaseService.startSession();
    try {
      return await DatabaseService.withTransaction(session, async () => {
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
          idempotencyKey: transferIdempotency
        }, "loan-repayment");

        // 2) provider transfer (user -> prime)
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
          signature: "",
          amount: repayAmount,
          remark: `${params.mandatory ? "Mandatory" : "Voluntary"} Loan Repayment`,
          transferType: "intra",
          reference: transferRecord.reference
        } as any;

        let providerResponse: any;
        try {
          providerResponse = await this.vfd.transfer(transferRequest);
        } catch (err) {
          await TransferService.failTransfer(transferRecord.reference);
          throw new Error(`Repayment provider transfer failed: ${String(err)}`);
        }

        const ok = providerResponse && (providerResponse.status === "00" || providerResponse.data?.txnId || providerResponse.txnId);
        if (!ok) {
          await TransferService.failTransfer(transferRecord.reference);
          throw new Error(`Repayment failed: ${JSON.stringify(providerResponse)}`);
        }

        // 3) complete internal transfer
        const trxnRes = await TransferService.completeTransfer(transferRecord.reference, "loan-repayment");

        // 4) update loan outstanding & history
        let newOutstanding = 0;

        if(loan.outstanding && loan.outstanding >= params.amount){
          newOutstanding = loan.outstanding - params.amount;
        }

        const paidInFull = newOutstanding <= 0;

        const now = new Date();
        loan.repayment_history = loan.repayment_history || [];
        loan.repayment_history.push({
          amount: params.amount,
          outstanding: newOutstanding,
          action: "repayment",
          date: now.toISOString()
        });

        loan.outstanding = newOutstanding;
        loan.loan_payment_status = paidInFull ? "complete" : "in-progress";
        await loan.save({ session });

        // 5) ledger double entry: user_wallet -> platform_cash
        await LedgerService.createDoubleEntry(
          UuidService.generateTraceId(),
          `user_wallet:${user._id}`,
          "loan_repayment",
          repayAmount,
          "loan",
          {
            userId: user._id,
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
            const [newScore, ladderIndex, category, message] = LoanService.computeCreditScoreFromTimeliness(daysLate, user.user_metadata.ladderIndex || 0);
            await UserService.update(user._id, "user_metadata.creditScore", newScore);
            await UserService.update(user._id, "user_metadata.ladderIndex", ladderIndex);

            await NotificationService.sendLoanRepayment(user, repayAmount, message);
          }
        } catch (err) {
          console.warn("Failed updating credit score (non-fatal):", err);
        }

        // 9) idempotent response
        if (params.idempotencyKey) {
          await saveIdempotentResponse(params.idempotencyKey, params.userId, { status: "success", loan, providerResponse });
        }

        return { loan, providerResponse, trxnRes };
      });
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
    if (daysLate < 0) return [1.0, ladderIndex + 1, "before_due_date", "Continue making payment before due date to keep a perfect credit score and unlock larger loan amounts"];
    if (daysLate === 0) return [0.9, ladderIndex + 1, "on_due_date", "Make sure to pay on or before the due date to maintain a good credit score and unlock larger loan amounts"];
    if (daysLate <= 3) return [0.6, ladderIndex, "1-3_days_late", "Paying within 1-3 days after the due date may impact your credit score and may result in higher interest rates as well as inability to unlock larger loan amounts"];
    if (daysLate <= 5) return [0.5, ladderIndex > 0 ? ladderIndex - 1 : 0, "4-5_days_late", "Paying 4-5 days late will negatively affect your credit score and may result in higher interest rates as well as inability to unlock larger loan amounts"];
    if (daysLate <= 7) return [0.4, ladderIndex > 0 ? ladderIndex - 1 : 0, "6-7_days_late", "Paying 6-7 days late will further impact your credit score and may result in higher interest rates as well as inability to unlock larger loan amounts"];
    return [0.3, ladderIndex > 1 ? ladderIndex - 2 : 0, "over_7_days_late", "Paying over 7 days late will significantly harm your credit score and may result in higher interest rates as well as loan denial"];
  }

  /* ---------------------
   * Reject a loan (admin)
   * --------------------- */
  static async rejectLoan(adminId: string, loanId: string, reason: string) {
    requiredParam("adminId", adminId);
    requiredParam("loanId", loanId);
    requiredParam("reason", reason);

    console.log(" In reject loan")

    const loan = await Loan.findById(loanId);
    if (!loan) throw new NotFoundError("Loan not found");
    if (loan.status === "accepted") throw new BadRequestError("Cannot reject accepted loan");
    if (loan.status === "rejected") throw new BadRequestError("Loan already rejected");

    loan.outstanding = 0;
    loan.rejectionReason = reason;
    loan.status = "rejected";
    loan.percentage = typeof loan.percentage === "string" 
    ? Number(String(loan.percentage).replace("%", "")) 
    : loan.percentage,
    loan.adminAction = {
      adminId,
      action: "Reject",
      date: new Date().toISOString()
    };

    await loan.save();

    const user = await UserService.getUser(loan.userId);

    if(user) {
      await NotificationService.sendLoanRejection(user, loan.amount, reason);
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

    // Load only required fields
    const loans = await Loan.find({}, {
      amount: 1,
      repayment_amount: 1,
      outstanding: 1,
      loan_payment_status: 1,
      repayment_date: 1,
      status: 1,
      repayment_history: 1
    });

    let stats = {
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

    for (const loan of loans) {
      const amount = loan.amount || 0;
      const repayment = loan.repayment_amount || 0;
      const outstanding = loan.outstanding || 0;
      const dueDate = loan.repayment_date ? new Date(loan.repayment_date) : null;

      // Applied loans
      stats.totalApplied += amount;
      stats.appliedUsers++;

      // Disbursed loans
      if (
        loan.status == "accepted"
      ) {
        stats.totalDisbursed += amount;
        stats.disbursedUsers++;

        const expectedProfit = (repayment || 0) - (amount || 0);
        const realized = (repayment || 0) - (outstanding || 0) - (amount || 0);

        stats.realizedProfit += Math.max(realized, 0);
        stats.unrealizedProfit += Math.max(expectedProfit - realized, 0);
      }

      // Loan status categorization
      if (
        loan.status == "accepted" &&
        (loan.loan_payment_status == "in-progress" ||
        loan.loan_payment_status == "not-started")
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

      if (loan.loan_payment_status == "complete") {
        stats.repaidLoans++;
        let sum = 0;

        for (let payment of loan?.repayment_history || []) {
          sum += isNaN(Number(payment.amount)) ? 0 : Number(payment.amount);
        }

        stats.repaidAmount += sum;
      }

      if (loan.loan_payment_status == "in-progress") {
        stats.repaidingLoans++;
        let sum = 0;

        for (let payment of loan?.repayment_history || []) {
          sum += isNaN(Number(payment.amount)) ? 0 : Number(payment.amount);
        }

        stats.repaidingAmount += sum;
      }

      if(loan.status == "accepted" && loan.loan_payment_status == "not-started") {
        stats.notStarted++;
      }

      if (loan.status === "pending") {
        stats.pendingLoans++;
        stats.pendingAmount += amount;
      }
    }

    return {
      totalLoans: loans.length,
      ...stats,
    };
  }

  /**
   * Get loans & users by category for admin
   */
  static async getLoansByCategory(category?: "active" | "due" | "overdue" | "completed" | "pending" | "rejected", page = 1, limit = 20, search?: string) {
    const now = new Date();
    let filter: any = {};

    console.log({ category, page, limit, search });

    if (category === "active") {
      filter.loan_payment_status = "in-progress";
    } else if (category === "due") {
      filter.loan_payment_status = "in-progress";
      filter.repayment_date = { $lte: now };
    } else if (category === "overdue") {
      filter.loan_payment_status = "in-progress";
      filter.repayment_date = { $lt: now };
    } else if (category === "completed") {
      filter.loan_payment_status = "complete";
    } else if (category === "pending") {
      filter.status = "pending";
    } else if (category === "rejected") {
      filter.status = "rejected";
    }

    if (search) {
      const regex = new RegExp(search, "i"); // case-insensitive search
      filter.$or = [
        { "first_name": regex },
        { "last_name": regex },
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
      Loan.countDocuments(filter)
    ]);

    // Join with user details (admin wants to see who owes what)
    const userIds = loans.map(l => l.userId);
    const users = await User.find({ _id: { $in: userIds } }, { email: 1, user_metadata: 1 });

    return {
      loans,
      users,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit))
    };
  }
}
