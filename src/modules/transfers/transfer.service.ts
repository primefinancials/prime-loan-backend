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

    console.log("In Initiate Transfer:", request)

    try {
      return await DatabaseService.withTransaction(session, async () => {
        const user = await User.findOne({ "user_metadata.accountNo": request.fromAccount });
        if (!user && type == "transfer") {
          throw new Error("User Not Found");
        }

        // Enforce Name Enquiry if transferring to an external bank
        if (request.transferType === 'inter') {
          if (!request.bankCode) throw new Error("Bank Code Required for Inter-bank transfer");

          // Optimization: VFD/Bank Enquiry Check
          // Ideally, we check a cache or re-verify. For now, we assume the frontend did it,
          // BUT we verify the beneficiary name matches what we expect from a quick lookup/cache if available.
          // Or strictly enforce that an enquiry MUST have happened recently (store enquiry session?).
          // Simpler approach: Re-validate beneficiary for security.
          try {
            const enquiry = await TransferService.vfdProvider.nameEnquiry(request.bankCode, request.toAccount);
            // Handling unknown type safety issues with explicit cast or check
            const remoteName = enquiry?.data ? (enquiry.data as any).accountName : null;

            if (!remoteName) {
              throw new Error("Invalid beneficiary account");
            }
          } catch (e) {
            console.error("Name Validity Check Error:", e);
            throw new Error("Beneficiary Account Validation Failed");
          }
        }

        if (user && (Number(user.user_metadata?.wallet || 0) < request.amount)) {
          throw new Error("Insufficient wallet balance");
        }
        // Create transfer record
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
          remark: request.remark,
          bankCode: request.bankCode,
          meta: request.meta,
          naration: request.naration
        }], { session });

        if (user) {
          // Create debit ledger entry
          // Fix: Use the 'type' argument to determine category instead of hardcoded 'transfer'
          // Mapping:
          // transfer -> category: transfer
          // bill-payment -> category: bill-payment
          // savings-deposit -> category: savings
          // savings-withdrawal -> category: savings
          // loan-disbursement -> category: loan
          // loan-repayment -> category: loan

          let ledgerCategory: any = 'transfer';
          if (type === 'bill-payment') ledgerCategory = 'bill-payment';
          else if (type.startsWith('savings')) ledgerCategory = 'savings';
          else if (type.startsWith('loan')) ledgerCategory = 'loan';

          await LedgerService.createEntry({
            traceId,
            userId: user._id as any,
            account: `user_wallet:${user._id}`,
            entryType: 'DEBIT',
            category: ledgerCategory,
            amount: request.amount,
            status: 'PENDING',
            idempotencyKey: request.idempotencyKey,
            meta: { transferId: transfer._id, toAccount: request.toAccount, subtype: type }
          }, session);
        }

        if (user) {
          await User.findOneAndUpdate(
            { _id: user._id },
            { user_metadata: { ...user.user_metadata, wallet: String(Number(request.walletBalance || 0) - Number(transfer.amount)) } },
            { new: true, upsert: true }
          )
        }

        const result: TransferResult = {
          traceId,
          status: 'PENDING',
          transferId: String(transfer._id),
          reference
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
  static async completeTransfer(reference: string, type: "bill-payment" | "transfer" | "savings-deposit" | "savings-withdrawal" | "loan-disbursement" | "loan-repayment" | "escrow-funding" | "escrow-payout" | "escrow-resolution" = "transfer"): Promise<TransferResult | null> {
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
            if (type) {
              // Fix: dynamic ledger category
              let ledgerCategory: any = 'transfer';
              if (type === 'bill-payment') ledgerCategory = 'bill-payment';
              else if (type.startsWith('savings')) ledgerCategory = 'savings';
              else if (type.startsWith('loan')) ledgerCategory = 'loan';

              await LedgerService.createEntry({
                userId: user._id as any,
                traceId: transfer.traceId,
                account: `user_wallet:${transfer.toAccount}`,
                entryType: 'CREDIT',
                category: ledgerCategory,
                amount: transfer.amount,
                status: 'COMPLETED',
                relatedTo: String(transfer._id),
                meta: { subtype: type }
              }, session);
            }

            user.user_metadata.wallet = String(Number(user?.user_metadata.wallet || 0) + Number(transfer.amount));
            await user.save();

            const fromuser = await User.findOne({ "user_metadata.accountNo": transfer.fromAccount }).session(session);

            await NotificationService.sendCreditAlert(user, transfer.amount, `${fromuser?.user_metadata.first_name} ${fromuser?.user_metadata.surname}`, transfer.reference);
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

        const user = await User.findById(transfer.userId);

        if (user && type == "transfer") {
          await NotificationService.sendDebitAlert(user, transfer.amount);
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

        const user = await User.findById(transfer.userId);

        if (user) {
          user.user_metadata.wallet = String(Number(user.user_metadata.wallet || 0) + Number(transfer.amount));
          await user.save();
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

          counterModel.findOneAndUpdate(
            { name: 'signupBonus' },
            { $inc: { count: 1 } }
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

    await NotificationService.sendCreditAlert(user, body.amount, body.originator_account_name, body.reference);

    return txn;
  }
}
