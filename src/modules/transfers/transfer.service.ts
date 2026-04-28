/**
 * Transfer Application Service
 * Orchestrates transfer operations with ledger + idempotency
 */
import { LedgerService } from '../ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';
import { Transfer } from './transfer.model';
import { saveIdempotentResponse } from '../../shared/idempotency/middleware';
import User from '../users/user.model';
import { Transfer as ITransfer } from './transfer.interface';
import { sha512 } from 'js-sha512';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import counterModel from '../users/counter.model';
import { NotificationService } from '../notifications/notification.service';
import pino from 'pino';

const logger = pino({ name: 'transfer-service' });

export interface InitiateTransferRequest {
  fromAccount: string;
  userId: string;
  toAccount: string;
  amount: number; // naira
  transferType: 'intra' | 'inter';
  bankCode?: string;
  remark?: string;
  beneficiaryName: string;
  walletBalance: string;
  meta?: object;
  naration?: string;
  idempotencyKey?: string;
  skipBalanceCheck?: boolean;
  skipDbRecord?: boolean;
}

export interface TransferResult {
  traceId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  transferId: string;
  reference: string;
}

export class TransferService {
  private static vfdProvider = new VfdProvider();
  /**
   * Initiate transfer (pending debit entry)
   */
  static async initiateTransfer(
    request: InitiateTransferRequest,
    type: "bill-payment" | "transfer" | "savings-deposit" | "savings-withdrawal" | "loan-disbursement" | "loan-repayment" | "escrow-funding" | "escrow-payout" | "escrow-resolution" = "transfer"
  ): Promise<TransferResult> {
    const traceId = UuidService.generateTraceId();
    const reference = `TXN_${UuidService.generate().substring(0, 8).toUpperCase()}`;

    const session = await DatabaseService.startSession();

    logger.debug({ request }, 'In Initiate Transfer');

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const user = await User.findOne({ "user_metadata.accountNo": request.fromAccount });
        if (!user && type == "transfer" && !request.skipDbRecord) {
          throw new Error("User Not Found");
        }

        // Enforce Name Enquiry if transferring to an external bank
        if (request.transferType === 'inter') {
          if (!request.bankCode) throw new Error("Bank Code Required for Inter-bank transfer");

          // Optimization: VFD/Bank Enquiry Check
          // Ideally, we check a cache or re-verify. For now, we assume the frontend did it,
          try {
            const enquiry = await TransferService.vfdProvider.nameEnquiry(request.bankCode, request.toAccount);
            const data = enquiry?.data as any;
            const remoteName = data ? (data.accountName || data.name || data.client) : null;

            if (!remoteName && !request.beneficiaryName) {
              throw new Error("Invalid beneficiary account - unable to resolve name");
            }
          } catch (e) {
            console.error("Name Validity Check Error:", e);
            if (!request.beneficiaryName) {
              throw new Error("Beneficiary Account Validation Failed");
            } else {
              console.warn("VFD name enquiry failed or rejected, proceeding with provided beneficiaryName:", request.beneficiaryName);
            }
          }
        }

        if (!request.skipBalanceCheck && user && (Number(user.user_metadata?.wallet || 0) < request.amount)) {
          throw new Error("Insufficient wallet balance");
        }
        // Enforce Idempotency
        if (request.idempotencyKey) {
          const fullKey = `${type}:${request.idempotencyKey}`;
          const existing = await Transfer.findOne({ idempotencyKey: fullKey }).session(session);
          if (existing) {
            logger.info({ fullKey, reference: existing.reference }, 'Idempotent transfer collision handled');
            return {
              traceId: existing.traceId,
              status: existing.status as any,
              transferId: String(existing._id),
              reference: existing.reference
            };
          }
        }

        // Create transfer record
        let transferId = `test-${traceId}`;
        let referenceValue = reference;

        if (!request.skipDbRecord) {
          const [transfer] = await Transfer.create([{
            userId: request.userId,
            traceId,
            fromAccount: request.fromAccount,
            toAccount: request.toAccount,
            amount: request.amount,
            transferType: request.transferType,
            status: 'PENDING',
            beneficiaryName: request.beneficiaryName,
            reference,
            idempotencyKey: request.idempotencyKey ? `${type}:${request.idempotencyKey}` : undefined,
            remark: request.remark,
            bankCode: request.bankCode,
            meta: request.meta,
            naration: request.naration
          }], { session });
          
          transferId = String(transfer._id);
          referenceValue = transfer.reference;

          if (user) {
            // Create debit ledger entry ONLY for basic transfers to avoid double-entry with domain services
            if (type === 'transfer') {
              await LedgerService.createEntry({
                traceId,
                userId: user._id as any,
                account: `user_wallet:${user._id}`,
                entryType: 'DEBIT',
                category: 'transfer',
                amount: request.amount,
                status: 'PENDING',
                idempotencyKey: request.idempotencyKey,
                meta: { transferId: transfer._id, toAccount: request.toAccount, subtype: type }
              }, session);
            }
          }
        }

        const result: TransferResult = {
          traceId,
          status: 'PENDING',
          transferId,
          reference: referenceValue
        };

        return result;
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Mark transfer as completed (credit side + finalize)
   */
  static async completeTransfer(reference: string, type: "bill-payment" | "transfer" | "savings-deposit" | "savings-withdrawal" | "loan-disbursement" | "loan-repayment" | "escrow-funding" | "escrow-payout" | "escrow-resolution" | "escrow-refund" = "transfer"): Promise<TransferResult | null> {
    const session = await DatabaseService.startSession();

    console.log(" In Complete Transfer")

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const transfer = await Transfer.findOne({ reference }).session(session);
        if (!transfer) return null;

        // Update debit ledger entry
        const ledger = await LedgerService.getByTraceId(transfer.traceId);
        if (ledger[0]) {
          await LedgerService.updateStatus(ledger[0]._id as any, 'COMPLETED', session);
        }

        // Credit beneficiary account (for intra-bank)
        if (transfer.transferType === 'intra') {
          const user = await User.findOne({ "user_metadata.accountNo": transfer.toAccount }).session(session);

          if (user) {
            if (type === 'transfer') {
              // Create credit ledger entry ONLY for basic transfers to avoid double-entry
              await LedgerService.createEntry({
                userId: user._id as any,
                traceId: transfer.traceId,
                account: `user_wallet:${user._id}`,
                entryType: 'CREDIT',
                category: 'transfer',
                amount: transfer.amount,
                status: 'COMPLETED',
                relatedTo: String(transfer._id),
                meta: { subtype: type }
              }, session);
            }

            // Sync wallet balance with VFD source of truth
            try {
              const accountInfo = await TransferService.vfdProvider.getAccountInfo(transfer.toAccount);
              if (accountInfo?.data?.accountBalance) {
                user.user_metadata.wallet = String(accountInfo.data.accountBalance);
              } else {
                user.user_metadata.wallet = String(Number(user?.user_metadata.wallet || 0) + Number(transfer.amount));
              }
            } catch (err) {
              console.error("Failed to sync wallet balance from VFD:", err);
              user.user_metadata.wallet = String(Number(user?.user_metadata.wallet || 0) + Number(transfer.amount));
            }
            await user.save({ session });

            // Clear VFD cache for receiver
            await TransferService.vfdProvider.clearCache(transfer.toAccount);

            const fromuser = await User.findOne({ "user_metadata.accountNo": transfer.fromAccount }).session(session);
            const originatorName = fromuser ? `${fromuser.user_metadata.first_name || ""} ${fromuser.user_metadata.surname || ""}`.trim() : "Prime Loan";

            // Send credit alert notification (best-effort, non-blocking)
            try {
              await NotificationService.sendCreditAlert(user, transfer.amount, originatorName || "System", transfer.reference);
            } catch (emailError) {
              console.warn('Failed to send credit alert email (non-fatal):', emailError);
            }
          }
        }

        transfer.status = 'COMPLETED';
        await transfer.save({ session });

        const result: TransferResult = {
          traceId: transfer.traceId,
          status: 'COMPLETED',
          transferId: String(transfer._id),
          reference: transfer.reference
        };

        const user = await User.findById(transfer.userId).session(session);

        if (user) {
          // Sync sender wallet balance with VFD source of truth
          try {
            // Clear VFD cache for sender
            await TransferService.vfdProvider.clearCache(transfer.fromAccount);

            const accountInfo = await TransferService.vfdProvider.getAccountInfo(transfer.fromAccount);
            if (accountInfo?.data?.accountBalance) {
              user.user_metadata.wallet = String(accountInfo.data.accountBalance);
              await user.save({ session });
            }
          } catch (err) {
            console.error("Failed to sync sender wallet balance from VFD:", err);
          }

          if (type == "transfer") {
            try {
              await NotificationService.sendDebitAlert(user, transfer.amount);
            } catch (emailError) {
              console.warn('Failed to send debit alert email (non-fatal):', emailError);
            }
          }
        }

        return result;
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Mark transfer as failed (credit side + finalize)
   */
  static async failTransfer(reference: string): Promise<TransferResult | null> {
    const session = await DatabaseService.startSession();

    console.log(" In Failed Transfer")

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const transfer = await Transfer.findOne({ reference }).session(session);
        if (!transfer) return null;

        // Update debit ledger entry
        const ledger = await LedgerService.getByTraceId(transfer.traceId);
        if (ledger[0]) {
          await LedgerService.updateStatus(ledger[0]._id as any, 'FAILED', session);
        }

        transfer.status = 'FAILED';
        await transfer.save({ session });

        const result: TransferResult = {
          traceId: transfer.traceId,
          status: 'FAILED',
          transferId: String(transfer._id),
          reference: transfer.reference
        };

        const user = await User.findById(transfer.userId).session(session);

        if (user) {
          // Sync sender wallet balance with VFD source of truth
          try {
            const accountInfo = await TransferService.vfdProvider.getAccountInfo(transfer.fromAccount);
            if (accountInfo?.data?.accountBalance) {
              user.user_metadata.wallet = String(accountInfo.data.accountBalance);
            } else {
              user.user_metadata.wallet = String(Number(user.user_metadata.wallet || 0) + Number(transfer.amount));
            }
          } catch (err) {
            console.error("Failed to sync sender wallet balance from VFD:", err);
            user.user_metadata.wallet = String(Number(user.user_metadata.wallet || 0) + Number(transfer.amount));
          }
          await user.save({ session });
        }

        return result;
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * create user bonus
   */
  static async createUserBonus(userId: string, amount: number): Promise<void> {
    const session = await DatabaseService.startSession();

    try {
      await DatabaseService.withTransaction(session, async () => {


        if ((await counterModel.findOne({ name: 'signupBonus' }))?.count || 0 <= 100) {
          const user = await User.findById(userId).session(session);
          if (!user) throw new Error("User not found");

          const userAccountRes = await TransferService.vfdProvider.getAccountInfo(user.user_metadata.accountNo || "");
          if (!userAccountRes.data) throw new Error(`User account not found`);

          const userAccountData = userAccountRes.data;
          const userBalance = Number(userAccountData.accountBalance);

          // 3. Enquire prime account (admin)
          const adminAccountRes = await TransferService.vfdProvider.getPrimeAccountInfo();
          if (!adminAccountRes.data) throw new Error("Prime account not found");

          const adminAccountData = adminAccountRes.data;

          const res = await TransferService.initiateTransfer({
            fromAccount: adminAccountData.accountNo,
            toAccount: userAccountData.accountNo,
            beneficiaryName: userAccountData.client,
            amount,
            bankCode: "999999",
            transferType: "intra",
            userId: String(user._id),
            walletBalance: String(userBalance)
          });

          const transferBody = {
            fromAccount: adminAccountData.accountNo,
            uniqueSenderAccountId: "",
            fromClientId: adminAccountData.clientId,
            fromClient: adminAccountData.client,
            fromSavingsId: adminAccountData.accountId,
            toClientId: userAccountData.clientId,
            toClient: userAccountData.client,
            toSavingsId: userAccountData.accountId,
            toSession: userAccountData.accountId,
            toAccount: userAccountData.accountNo,
            toBank: "999999",
            signature: sha512.hex(
              `${adminAccountData.accountNo}${userAccountData.accountNo}`
            ),
            amount: amount,
            remark: "Signup Bonus",
            transferType: "intra" as "intra" | "inter",
            reference: res.reference,
          };

          const response = await TransferService.vfdProvider.transfer(transferBody);

          if (response.status === "00") {
            await TransferService.completeTransfer(res.reference, "transfer");
          }

          user.user_metadata.signupBonusReceived = true;
          await user.save({ session });

          await counterModel.findOneAndUpdate(
            { name: 'signupBonus' },
            { $inc: { count: 1 } },
            { session, new: true, upsert: true }
          );
        }

      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Transfer by id
  */
  static async transfer(transactionId: string): Promise<ITransfer | null> {
    if (!transactionId) return null;

    const transaction = await Transfer.findOne({ _id: transactionId });

    if (!transaction) return null;

    return transaction;
  }

  /**
   * Paginated transfers for a user
  */
  static async transfers(
    userId: string,
    page = 1,
    limit = 10
  ): Promise<{
    data: ITransfer[];
    total: number;
    page: number;
    pages: number;
  }> {
    const skip = (page - 1) * limit;

    const user = await User.findById(userId);

    const query = {
      $or: [
        { fromAccount: user?.user_metadata?.accountNo },
        { toAccount: user?.user_metadata?.accountNo }
      ]
    };

    const [transactions, total] = await Promise.all([
      Transfer.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transfer.countDocuments(query)
    ]);

    return {
      data: transactions,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  /**
   * Handle incoming wallet credit alerts (webhook style)
   */
  static async walletAlerts(body: {
    account_number: string;
    amount: number;
    originator_account_name: string;
    originator_account_number: string;
    originator_bank: string;
    originator_narration: string;
    reference: string;
    session_id: string;
  }) {

    console.log({ body });

    const user = await User.findOne({ "user_metadata.accountNo": body.account_number });
    if (!user) return null;

    const userAccountRes = await TransferService.vfdProvider.getAccountInfo(user.user_metadata.accountNo || "");
    if (!userAccountRes.data) return null;

    const traceId = body?.session_id || body.reference;

    // Ledger credit
    await LedgerService.createEntry({
      traceId,
      userId: String(user._id),
      account: `user_wallet:${user._id}`,
      entryType: 'CREDIT',
      category: 'transfer',
      amount: body.amount,
      status: 'COMPLETED',
      relatedTo: body.reference,
      meta: {
        originatorName: body.originator_account_name,
        originatorAccount: body.originator_account_number,
        bank: body.originator_bank
      }
    });

    // Transfer record
    const txn = await Transfer.create({
      userId: user._id,
      traceId,
      fromAccount: body.originator_account_number,
      toAccount: body.account_number,
      amount: body.amount,
      transferType: body.originator_bank === "999999" ? 'intra' : "inter",
      status: 'COMPLETED',
      reference: body.reference,
      remark: body.originator_narration,
      bankCode: body.originator_bank,
      providerRef: body.session_id,
      beneficiaryName: body.originator_account_name
    });

    await User.findOneAndUpdate(
      { _id: user._id },
      { user_metadata: { ...user.user_metadata, wallet: String(userAccountRes.data.accountBalance) } },
      { new: true, upsert: true }
    )

    try {
      await NotificationService.sendCreditAlert(user, body.amount, body.originator_account_name, body.reference);
    } catch (emailError) {
      console.warn('Failed to send credit alert email (non-fatal):', emailError);
    }

    return txn;
  }
}
