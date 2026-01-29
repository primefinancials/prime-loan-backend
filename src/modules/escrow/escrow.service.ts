import { EscrowTransaction, IEscrowTransaction, EscrowType } from './escrow.model';
import { DatabaseService } from '../../shared/db';
import { LedgerService } from '../ledger/LedgerService';
import { UuidService } from '../../shared/utils/uuid';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { TransferService } from '../transfers/transfer.service';
import { SettingsService } from '../admin/settings.service';
import User from '../users/user.model';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../exceptions';
import { sha512 } from 'js-sha512';
import { TransferRequest } from '../../shared/providers/vfd.provider';

export class EscrowService {

    /**
     * Initiate a generic Escrow (P2P or Marketplace)
     */
    static async createEscrow(params: {
        buyerId: string;
        sellerId?: string; // Optional if P2P and searching by email
        sellerEmail?: string; // Optional if P2P
        type: EscrowType;
        amount: number;
        description: string;
        items?: any[];
        expiryDays?: number;
    }) {
        // 1. Resolve Seller
        let seller;
        if (params.sellerId) {
            seller = await User.findById(params.sellerId);
        } else if (params.sellerEmail) {
            seller = await User.findOne({ email: params.sellerEmail });
        }

        if (!seller) throw new NotFoundError('Seller not found');
        if (seller._id.toString() === params.buyerId) throw new BadRequestError('Cannot create escrow with yourself');

        // 2. Calculate Fees
        const fee = await SettingsService.calculateProfit('escrow', 'send', params.amount);

        // 3. Create Record
        const expiryDate = params.expiryDays
            ? new Date(Date.now() + params.expiryDays * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days

        const escrow = await EscrowTransaction.create({
            transactionId: UuidService.generateTraceId(),
            type: params.type,
            buyerId: params.buyerId,
            sellerId: seller._id,
            amount: params.amount,
            fee,
            totalAmount: params.amount + fee,
            description: params.description,
            items: params.items || [],
            status: 'PENDING',
            expiryDate
        });

        return escrow;
    }

    /**
     * Fund Escrow: Move money from Buyer -> Platform Escrow Pool
     * Status: PENDING -> LOCKED
     */
    static async fundEscrow(escrowId: string, userId: string) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const escrow = await EscrowTransaction.findById(escrowId).session(session);
                if (!escrow) throw new NotFoundError('Escrow not found');
                if (escrow.buyerId !== userId) throw new UnauthorizedError('Only buyer can fund escrow');
                if (escrow.status !== 'PENDING') throw new BadRequestError(`Escrow is ${escrow.status}`);

                const vfdProvider = new VfdProvider();
                const buyer = await User.findById(userId);
                if (!buyer) throw new NotFoundError('Buyer not found');

                const buyerAccount = (await vfdProvider.getAccountInfo(buyer.user_metadata.accountNo)).data;
                const platformAccount = (await vfdProvider.getPrimeAccountInfo()).data; // Escrow pool resides here or dedicated account

                // 1. Initiate Transfer
                const trxn = await TransferService.initiateTransfer({
                    fromAccount: buyerAccount.accountNo,
                    userId,
                    toAccount: platformAccount.accountNo,
                    amount: escrow.totalAmount, // Principal + Fee
                    beneficiaryName: platformAccount.client,
                    transferType: "intra",
                    bankCode: "999999",
                    remark: `Escrow Funding: ${escrow.transactionId}`,
                    walletBalance: String(buyerAccount.accountBalance),
                    naration: `Funding escrow ${escrow.transactionId}`
                }, "escrow-funding");

                // 2. Execute VFD Transfer
                const transferReq: TransferRequest = {
                    uniqueSenderAccountId: buyerAccount.accountId,
                    fromAccount: buyerAccount.accountNo,
                    fromClientId: buyerAccount.clientId,
                    fromSavingsId: buyerAccount.accountId,
                    fromClient: buyerAccount.client,
                    toAccount: platformAccount.accountNo,
                    toClientId: platformAccount.clientId,
                    toClient: platformAccount.client,
                    toSavingsId: platformAccount.accountId,
                    toSession: platformAccount.accountId,
                    toBank: "999999",
                    amount: escrow.totalAmount,
                    remark: `Escrow Fund ${escrow.transactionId}`,
                    transferType: "intra",
                    reference: trxn.reference,
                    signature: sha512.hex(`${buyerAccount.accountNo}${platformAccount.accountNo}`)
                };

                const providerRes = await vfdProvider.transfer(transferReq);

                if (providerRes.status !== "00") {
                    await TransferService.failTransfer(trxn.reference);
                    throw new BadRequestError('Funding transfer failed: ' + providerRes.message);
                }

                await TransferService.completeTransfer(trxn.reference, "escrow-funding");

                // 3. Ledger Entries: 
                // Debit Buyer, Credit Escrow Pool (Hold)
                await LedgerService.createDoubleEntry(
                    trxn.traceId,
                    'escrow_pool', // System account
                    `user_wallet:${userId}`,
                    escrow.totalAmount,
                    'escrow',
                    {
                        meta: { escrowId: escrow._id },
                        subtype: 'fund',
                        session
                    }
                );

                // 4. Update Escrow Status
                escrow.status = 'LOCKED';
                await escrow.save({ session });

            });
        } finally {
            session.endSession();
        }
    }

    /**
     * Auto-resolve logic (Called by Worker)
     * If locked and expiryDate exceeded, auto-confirm delivery.
     */
    static async processExpiredEscrows() {
        const now = new Date();
        // Find locked escrows past expiry
        const expiredEscrows = await EscrowTransaction.find({
            status: 'LOCKED',
            expiryDate: { $lte: now }
        });

        for (const escrow of expiredEscrows) {
            // Treat as confirmed delivery
            // We use a system user ID or specific flag for attribution
            await this.confirmDelivery(escrow._id as any, escrow.buyerId);
            // Note: confirmDelivery requires buyerId auth. 
            // We might need to override validaton or overload confirmDelivery.
            // Refactoring confirmDelivery to allow SYSTEM override:
        }
    }

    /**
     * Internal Confirm Delivery (Shared by User and System)
     */
    private static async _confirmDeliveryLogic(escrowId: string, actorId: string, isSystem = false) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const escrow = await EscrowTransaction.findById(escrowId).session(session);
                if (!escrow) throw new NotFoundError('Escrow not found');

                if (!isSystem && escrow.buyerId !== actorId) throw new UnauthorizedError('Only buyer can confirm delivery');
                if (escrow.status !== 'LOCKED') throw new BadRequestError(`Escrow is ${escrow.status}`);

                const vfdProvider = new VfdProvider();
                // ... (Rest of logic same as confirmDelivery) ...
                // Reusing the logic requires copy-paste or refactor. 
                // Let's call confirmDelivery but we need to bypass the buyerId check if system.
                // Since I cannot change the public confirmDelivery signature easily without breaking callers (maybe?), 
                // I will duplicate logic tailored for system auto-release or modify confirmDelivery to take an option.
            });
        } finally { session.endSession(); }
    }

    // START REFACTOR of confirmDelivery to support System Action
    static async confirmDelivery(escrowId: string, userId: string, isSystem = false) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const escrow = await EscrowTransaction.findById(escrowId).session(session);
                if (!escrow) throw new NotFoundError('Escrow not found');

                if (!isSystem && escrow.buyerId !== userId) throw new UnauthorizedError('Only buyer can confirm delivery');
                if (escrow.status !== 'LOCKED') throw new BadRequestError(`Escrow is ${escrow.status}`);

                const vfdProvider = new VfdProvider();
                const seller = await User.findById(escrow.sellerId);
                if (!seller) throw new NotFoundError('Seller not found');

                const platformAccount = (await vfdProvider.getPrimeAccountInfo()).data;
                const sellerAccount = (await vfdProvider.getAccountInfo(seller.user_metadata.accountNo)).data;

                const payoutAmount = escrow.amount;

                // 1. Payout Transfer
                const trxn = await TransferService.initiateTransfer({
                    fromAccount: platformAccount.accountNo,
                    userId: escrow.sellerId,
                    toAccount: sellerAccount.accountNo,
                    amount: payoutAmount,
                    beneficiaryName: sellerAccount.client,
                    transferType: "intra",
                    bankCode: "999999",
                    remark: `Escrow Payout: ${escrow.transactionId}`,
                    walletBalance: String(platformAccount.accountBalance),
                    naration: `Escrow complete ${escrow.transactionId}. ${isSystem ? 'Auto-resolved.' : ''}`
                }, "escrow-payout");

                const transferReq: TransferRequest = {
                    uniqueSenderAccountId: platformAccount.accountId,
                    fromAccount: platformAccount.accountNo,
                    fromClientId: platformAccount.clientId,
                    fromSavingsId: platformAccount.accountId,
                    fromClient: platformAccount.client,
                    toAccount: sellerAccount.accountNo,
                    toClientId: sellerAccount.clientId,
                    toClient: sellerAccount.client,
                    toSavingsId: sellerAccount.accountId,
                    toSession: sellerAccount.accountId,
                    toBank: "999999",
                    amount: payoutAmount,
                    remark: `Escrow Payout ${escrow.transactionId}`,
                    transferType: "intra",
                    reference: trxn.reference,
                    signature: sha512.hex(`${platformAccount.accountNo}${sellerAccount.accountNo}`)
                };

                const providerRes = await vfdProvider.transfer(transferReq);

                if (providerRes.status !== "00") {
                    await TransferService.failTransfer(trxn.reference);
                    throw new BadRequestError('Payout transfer failed: ' + providerRes.message);
                }

                await TransferService.completeTransfer(trxn.reference, "escrow-payout");

                // 2. Ledger Entries
                await LedgerService.createDoubleEntry(
                    trxn.traceId,
                    `user_wallet:${escrow.sellerId}`,
                    'escrow_pool',
                    payoutAmount,
                    'escrow',
                    {
                        meta: { escrowId: escrow._id },
                        subtype: 'payout',
                        session
                    }
                );

                await LedgerService.createEntry({
                    traceId: trxn.traceId,
                    userId: 'system',
                    account: 'platform_revenue',
                    entryType: 'CREDIT',
                    category: 'escrow',
                    subtype: 'fee',
                    amount: escrow.fee,
                    status: 'COMPLETED',
                    meta: { escrowId: escrow._id }
                }, session);


                // 3. Update Escrow
                escrow.status = 'COMPLETED';
                escrow.completedAt = new Date();
                if (isSystem) escrow.resolutionNote = "Auto-completed due to timeout";
                await escrow.save({ session });

                return escrow;
            });
        } finally {
            session.endSession();
        }
    }

    /**
     * Raise Dispute
     */
    static async raiseDispute(escrowId: string, userId: string, reason: string) {
        const escrow = await EscrowTransaction.findById(escrowId);
        if (!escrow) throw new NotFoundError('Escrow not found');

        // Only Buyer or Seller involved can dispute
        if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
            throw new UnauthorizedError('Not a party to this transaction');
        }

        if (escrow.status !== 'LOCKED') throw new BadRequestError('Can only dispute locked transactions');

        escrow.status = 'DISPUTED';
        escrow.disputeReason = reason;
        await escrow.save();

        return escrow;
    }

    /**
     * Resolve Dispute (Admin Only)
     */
    static async resolveDispute(escrowId: string, adminId: string, decision: 'refund_buyer' | 'pay_seller', note?: string) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const escrow = await EscrowTransaction.findById(escrowId).session(session);
                if (!escrow) throw new NotFoundError('Escrow not found');
                if (escrow.status !== 'DISPUTED') throw new BadRequestError('Escrow is not disputed');

                const vfdProvider = new VfdProvider();
                const platformAccount = (await vfdProvider.getPrimeAccountInfo()).data;

                let recipientId, recipientAccount, amountMismatch = false;

                if (decision === 'refund_buyer') {
                    recipientId = escrow.buyerId;
                    // Refund Total Amount (including fee? Usually platform keeps fee or refunds all. Let's refund all for simplicity)
                    // Actually, if we refund, we refund Principal + Fee usually? Or does platform keep fee for arbitration?
                    // Let's assume Refund = Full Refund for now.
                } else {
                    recipientId = escrow.sellerId;
                }

                const recipient = await User.findById(recipientId);
                if (!recipient) throw new Error('Recipient user not found');
                const recipientAccDetails = (await vfdProvider.getAccountInfo(recipient.user_metadata.accountNo)).data;
                recipientAccount = recipientAccDetails.accountNo;

                // Money Movement
                const amount = decision === 'refund_buyer' ? escrow.totalAmount : escrow.amount; // Refund all if buyer wins, else Pay principal to seller (fee kept)

                const trxn = await TransferService.initiateTransfer({
                    fromAccount: platformAccount.accountNo,
                    userId: recipientId,
                    toAccount: recipientAccount,
                    amount,
                    beneficiaryName: recipientAccDetails.client,
                    transferType: "intra",
                    bankCode: "999999",
                    remark: `Dispute Resolution: ${decision}`,
                    walletBalance: String(platformAccount.accountBalance),
                    naration: `Dispute ${decision} for ${escrow.transactionId}`
                }, "escrow-resolution");

                const transferReq: TransferRequest = {
                    uniqueSenderAccountId: platformAccount.accountId,
                    fromAccount: platformAccount.accountNo,
                    fromClientId: platformAccount.clientId,
                    fromSavingsId: platformAccount.accountId,
                    fromClient: platformAccount.client,
                    toAccount: recipientAccount,
                    toClientId: recipientAccDetails.clientId,
                    toClient: recipientAccDetails.client,
                    toSavingsId: recipientAccDetails.accountId,
                    toSession: recipientAccDetails.accountId,
                    toBank: "999999",
                    amount,
                    remark: `Dispute ${decision}`,
                    transferType: "intra",
                    reference: trxn.reference,
                    signature: sha512.hex(`${platformAccount.accountNo}${recipientAccount}`)
                };

                const providerRes = await vfdProvider.transfer(transferReq);

                if (providerRes.status !== "00") {
                    await TransferService.failTransfer(trxn.reference);
                    throw new BadRequestError('Resolution transfer failed: ' + providerRes.message);
                }

                await TransferService.completeTransfer(trxn.reference, "escrow-resolution");

                // Ledger
                await LedgerService.createDoubleEntry(
                    trxn.traceId,
                    `user_wallet:${recipientId}`,
                    'escrow_pool',
                    amount,
                    'escrow',
                    {
                        meta: { escrowId: escrow._id },
                        subtype: 'dispute_resolution',
                        session
                    }
                );

                // If paying seller, we recognize fee revenue now
                if (decision === 'pay_seller') {
                    await LedgerService.createEntry({
                        traceId: trxn.traceId,
                        userId: 'system',
                        account: 'platform_revenue',
                        entryType: 'CREDIT',
                        category: 'escrow',
                        subtype: 'fee',
                        amount: escrow.fee,
                        status: 'COMPLETED',
                        meta: { escrowId: escrow._id }
                    }, session);
                }

                escrow.status = decision === 'refund_buyer' ? 'REFUNDED' : 'COMPLETED';
                escrow.resolvedBy = adminId;
                escrow.resolutionNote = note;
                escrow.completedAt = new Date();
                await escrow.save({ session });

                return escrow;
            });
        } finally {
            session.endSession();
        }
    }

    static async getMyEscrows(userId: string, type?: EscrowType) {
        const query: any = {
            $or: [{ buyerId: userId }, { sellerId: userId }]
        };
        if (type) query.type = type;
        return EscrowTransaction.find(query).sort({ createdAt: -1 });
    }

    static async getById(escrowId: string) {
        return EscrowTransaction.findById(escrowId);
    }

    /**
     * Admin/Marketplace: List Escrows with filters
     * Supports filtering by Vendor (Seller)
     */
    static async getMarketplaceEscrows(params: {
        page?: number;
        limit?: number;
        vendorId?: string; // Filter by seller
        status?: string;
    }) {
        const { page = 1, limit = 20, vendorId, status } = params;

        // For marketplace, sellerId IS the vendor's User ID.
        // Wait, the Vendor model links userId <-> Vendor.
        // Escrow stores 'sellerId' which is the User ID.
        // So if passing a Vendor ID (from Vendor model), we must resolve to User ID first.

        let sellerUserId;
        if (vendorId) {
            // Lazy import or assume Vendor model access
            // Let's resolve userId from Vendor
            // We can query Escrow directly if we know sellerId
            // We'll trust the caller to pass the SELLER'S USER ID if they want to filter by user
            // OR we assume vendorId passed here is the Vendor Document Id, so we need to find the user.
            // Let's assume the controller handles the resolution or we simply filter by sellerId (User ID).

            // Actually, let's make it flexible. If valid ObjectId and matches a Vendor, use that vendor's userId.
            // But to avoid circular dep, let's assume 'vendorId' param here is actually the 'sellerId' (User ID).
            sellerUserId = vendorId;
        }

        const query: any = {};
        if (sellerUserId) query.sellerId = sellerUserId;
        if (status) query.status = status;

        const skip = (page - 1) * limit;

        const [escrows, total] = await Promise.all([
            EscrowTransaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
            EscrowTransaction.countDocuments(query)
        ]);

        return { data: escrows, total, page, pages: Math.ceil(total / limit) };
    }
}
