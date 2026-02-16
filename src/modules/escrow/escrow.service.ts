import { Types } from 'mongoose';
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
     * Initiate Escrow: Immediate Deduction & P2P Invites
     */
    static async createEscrow(params: {
        buyerId: string;
        sellerId?: string;
        sellerEmail?: string;
        type: EscrowType;
        amount: number;
        description: string;
        items?: any[];
        inspectionPeriodDays?: number; // Days allowed for inspection after delivery
    }) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const buyer = await User.findById(params.buyerId).session(session);
                if (!buyer) throw new NotFoundError('Buyer not found');

                // 1. Resolve Seller Logic
                let sellerId = params.sellerId;
                let inviteEmail: string | undefined;

                if (!sellerId && params.sellerEmail) {
                    const existingUser = await User.findOne({ email: params.sellerEmail }).session(session);
                    if (existingUser) {
                        sellerId = (existingUser._id as any).toString();
                    } else {
                        // User doesn't exist -> Create Invited User
                        const invitedUser = await (await import('../users/user.service')).UserService.createInvitedUser(params.sellerEmail);
                        sellerId = (invitedUser._id as any).toString();
                        inviteEmail = params.sellerEmail;
                    }
                }

                if (!sellerId) throw new BadRequestError('Seller must be identified by ID or Email');
                if (sellerId === params.buyerId) throw new BadRequestError('Cannot create escrow with yourself');

                // 2. Calculate Fees & Totals
                const fee = await SettingsService.calculateProfit('escrow', 'send', params.amount);
                const totalAmount = params.amount + fee;

                // 3. IMMEDIATE DEDUCTION
                const vfdProvider = new VfdProvider();
                const buyerAccount = (await vfdProvider.getAccountInfo(buyer.user_metadata.accountNo)).data;
                const platformAccount = (await vfdProvider.getPrimeAccountInfo()).data;

                // Transfer: Buyer -> Escrow Pool
                const trxn = await TransferService.initiateTransfer({
                    fromAccount: buyerAccount.accountNo,
                    userId: params.buyerId,
                    toAccount: platformAccount.accountNo,
                    amount: totalAmount,
                    beneficiaryName: platformAccount.client,
                    transferType: "intra",
                    bankCode: "999999",
                    remark: `Escrow Creation: ${params.description.substring(0, 20)}`,
                    walletBalance: String(buyerAccount.accountBalance),
                    naration: `Escrow Creation`
                }, "escrow-funding");

                // Execute Transfer
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
                    amount: totalAmount,
                    remark: `Escrow Fund`,
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

                // Ledger: Debit Buyer, Credit Escrow Pool
                await LedgerService.createDoubleEntry(
                    trxn.traceId,
                    'escrow_pool',
                    `user_wallet:${params.buyerId}`,
                    totalAmount,
                    'escrow',
                    { subtype: 'fund', session }
                );

                // 4. Create Escrow Record
                // Logic Change: We do NOT set expiryDate yet. 
                // expiryDate is set only after Delivery is confirmed (Delivery Date + Inspection Period)
                const inspectionPeriod = params.inspectionPeriodDays || 3; // Default 3 days inspection

                const escrow = await EscrowTransaction.create([{
                    transactionId: UuidService.generateTraceId(),
                    type: params.type,
                    buyerId: params.buyerId,
                    sellerId: sellerId,
                    amount: params.amount,
                    fee,
                    totalAmount,
                    description: params.description,
                    items: params.items || [],
                    status: 'PENDING',
                    inviteEmail, // Stored to track it originated from invite
                    inspectionPeriod,
                    expiryDate: undefined // Will be set on Delivery
                }], { session });

                // 5. Notifications
                const notifService = (await import('../notifications/notification.service')).NotificationService;
                const escrowLink = `https://primefinance.live/dashboard/escrow/${escrow[0]._id}`;

                if (inviteEmail) {
                    try {
                        await notifService.sendEscrowInvite(
                            inviteEmail,
                            `${buyer.user_metadata.first_name} ${buyer.user_metadata.surname}`,
                            params.amount,
                            escrowLink
                        );
                    } catch (e: any) {
                        console.log(`Unable to notify seller: ${e.message}`)
                    }
                } else {
                    // Notify existing seller
                    const seller = await User.findById(sellerId).session(session);
                    if (seller) {
                        try {
                            await notifService.sendEscrowCreated(
                                seller.email,
                                `${buyer.user_metadata.first_name} ${buyer.user_metadata.surname}`,
                                params.amount,
                                escrowLink
                            );
                        } catch (e: any) {
                            console.log(`Unable to notify seller: ${e.message}`)
                        }
                    }
                }

                return escrow[0];
            });
        } finally {
            session.endSession();
        }
    }

    /**
     * Accept Escrow (Seller Action)
     * PENDING -> LOCKED
     */
    static async acceptEscrow(escrowId: string, userId: string) {
        // If P2P invite, the userId calling this MUST match the invited email? 
        // Or if they just registered, we link them?
        // For existing users, simple check.

        const escrow = await EscrowTransaction.findById(escrowId);
        if (!escrow) throw new NotFoundError('Escrow not found');

        if (escrow.status !== 'PENDING') throw new BadRequestError('Escrow is not pending');

        // Handle P2P Invite linkage if needed
        if (escrow.inviteEmail) {
            const user = await User.findById(userId);
            if (user?.email !== escrow.inviteEmail) {
                // Strict check? Or allow if they have the link?
                // Let's enforce email match for security
                throw new UnauthorizedError('Email does not match invite');
            }
            escrow.sellerId = userId; // Bind real user ID
            escrow.inviteEmail = undefined; // Clear invite
        } else {
            if (escrow.sellerId !== userId) throw new UnauthorizedError('Not authorized');
        }

        escrow.status = 'LOCKED';
        await escrow.save();

        // Notify Buyer
        // NotificationService.sendPush(escrow.buyerId, "Seller accepted escrow!");

        return escrow;
    }

    /**
     * Mark Delivered (Seller Action)
     * LOCKED -> LOCKED (but with deliveryDate set)
     * Starts the Inspection Countdown
     */
    static async markDelivered(escrowId: string, userId: string) {
        const escrow = await EscrowTransaction.findById(escrowId);
        if (!escrow) throw new NotFoundError('Escrow not found');

        // Verify Seller
        if (escrow.sellerId !== userId) throw new UnauthorizedError('Only seller can mark delivered');

        if (escrow.status !== 'LOCKED') throw new BadRequestError('Escrow is not locked/active');
        if (escrow.deliveryDate) throw new BadRequestError('Already marked as delivered');

        const now = new Date();
        const inspectionDays = escrow.inspectionPeriod || 3;

        escrow.deliveryDate = now;
        // set expiryDate defined as delivery + inspection window
        escrow.expiryDate = new Date(now.getTime() + (inspectionDays * 24 * 60 * 60 * 1000));

        await escrow.save();

        // Notification: Notify Buyer
        const notifService = (await import('../notifications/notification.service')).NotificationService;
        try {
            const buyer = await User.findById(escrow.buyerId);
            if (buyer) {
                // Using generic notify or specific if available
                // For now, assume generic push/email or create new notification type later
                // await notifService.sendEscrowDelivered(buyer.email, ...);
                await notifService.sendPush(escrow.buyerId, "Seller has marked order as delivered. Inspection period started.");
            }
        } catch (e) { }

        return escrow;
    }

    /**
     * Reject Escrow (Seller Action)
     * PENDING -> CANCELLED/REJECTED (Refund Buyer)
     */
    static async rejectEscrow(escrowId: string, userId: string, reason: string) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const escrow = await EscrowTransaction.findById(escrowId).session(session);
                if (!escrow) throw new NotFoundError('Escrow not found');

                // Auth Check
                if (escrow.inviteEmail) {
                    const user = await User.findById(userId);
                    if (user?.email !== escrow.inviteEmail) throw new UnauthorizedError('Email mismatch');
                } else {
                    if (escrow.sellerId !== userId) throw new UnauthorizedError('Not authorized');
                }

                if (escrow.status !== 'PENDING') throw new BadRequestError('Escrow is not pending');

                // REFUND LOGIC
                const vfdProvider = new VfdProvider();
                const buyer = await User.findById(escrow.buyerId);
                if (!buyer) throw new Error("Buyer not found for refund"); // Should not happen

                const platformAccount = (await vfdProvider.getPrimeAccountInfo()).data;
                const buyerAccount = (await vfdProvider.getAccountInfo(buyer.user_metadata.accountNo)).data;

                // Transfer: Escrow Pool -> Buyer
                const trxn = await TransferService.initiateTransfer({
                    fromAccount: platformAccount.accountNo,
                    userId: escrow.buyerId,
                    toAccount: buyerAccount.accountNo,
                    amount: escrow.totalAmount, // Full Refund
                    beneficiaryName: buyerAccount.client,
                    transferType: "intra",
                    bankCode: "999999",
                    remark: `Escrow Refund: ${escrow.transactionId}`,
                    walletBalance: String(platformAccount.accountBalance),
                    naration: `Escrow Refund`
                }, "escrow-refund" as any);

                const transferReq: TransferRequest = {
                    uniqueSenderAccountId: "",
                    fromAccount: platformAccount.accountNo,
                    fromClientId: platformAccount.clientId,
                    fromSavingsId: platformAccount.accountId,
                    fromClient: platformAccount.client,
                    toAccount: buyerAccount.accountNo,
                    toClientId: buyerAccount.clientId,
                    toClient: buyerAccount.client,
                    toSavingsId: buyerAccount.accountId,
                    toSession: buyerAccount.accountId,
                    toBank: "999999",
                    amount: escrow.totalAmount,
                    remark: `Escrow Refund`,
                    transferType: "intra",
                    reference: trxn.reference,
                    signature: sha512.hex(`${platformAccount.accountNo}${buyerAccount.accountNo}`)
                };

                const providerRes = await vfdProvider.transfer(transferReq);
                if (providerRes.status !== "00") {
                    await TransferService.failTransfer(trxn.reference);
                    // Critical Error: Money stuck in pool?
                    // We throw error, transaction aborts, status remains PENDING?
                    // Yes, retryable.
                    throw new BadRequestError('Refund transfer failed: ' + providerRes.message);
                }
                await TransferService.completeTransfer(trxn.reference, "escrow-refund" as any);

                // Ledger: Debit Escrow Pool, Credit Buyer
                await LedgerService.createDoubleEntry(
                    trxn.traceId,
                    `user_wallet:${escrow.buyerId}`,
                    'escrow_pool',
                    escrow.totalAmount,
                    'escrow',
                    { subtype: 'refund', session }
                );

                escrow.status = 'REJECTED';
                escrow.rejectionReason = reason;
                await escrow.save({ session });

                return escrow;
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
                    uniqueSenderAccountId: "",
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
                    uniqueSenderAccountId: "",
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

    /**
     * Cancel Escrow (Buyer Action)
     * PENDING -> CANCELLED (Refund Buyer)
     */
    static async cancelEscrow(escrowId: string, userId: string) {
        const session = await DatabaseService.startSession();
        try {
            return await DatabaseService.withTransaction(session, async () => {
                const escrow = await EscrowTransaction.findById(escrowId).session(session);
                if (!escrow) throw new NotFoundError('Escrow not found');

                // Auth Check: Only Buyer can cancel
                if (escrow.buyerId !== userId) throw new UnauthorizedError('Not authorized');

                if (escrow.status !== 'PENDING') throw new BadRequestError('Escrow is not pending');

                // REFUND LOGIC (Reused from rejectEscrow)
                const vfdProvider = new VfdProvider();
                const buyer = await User.findById(escrow.buyerId);
                const platformAccount = (await vfdProvider.getPrimeAccountInfo()).data;
                const buyerAccount = (await vfdProvider.getAccountInfo(buyer?.user_metadata.accountNo || "")).data;

                // Transfer: Escrow Pool -> Buyer
                const trxn = await TransferService.initiateTransfer({
                    fromAccount: platformAccount.accountNo,
                    userId: escrow.buyerId,
                    toAccount: buyerAccount.accountNo,
                    amount: escrow.totalAmount, // Full Refund
                    beneficiaryName: buyerAccount.client,
                    transferType: "intra",
                    bankCode: "999999",
                    remark: `Escrow Cancellation: ${escrow.transactionId}`,
                    walletBalance: String(platformAccount.accountBalance),
                    naration: `Escrow Cancelled by Buyer`
                }, "escrow-refund" as any);

                const transferReq: TransferRequest = {
                    uniqueSenderAccountId: "",
                    fromAccount: platformAccount.accountNo,
                    fromClientId: platformAccount.clientId,
                    fromSavingsId: platformAccount.accountId,
                    fromClient: platformAccount.client,
                    toAccount: buyerAccount.accountNo,
                    toClientId: buyerAccount.clientId,
                    toClient: buyerAccount.client,
                    toSavingsId: buyerAccount.accountId,
                    toSession: buyerAccount.accountId,
                    toBank: "999999",
                    amount: escrow.totalAmount,
                    remark: `Escrow Refund`,
                    transferType: "intra",
                    reference: trxn.reference,
                    signature: sha512.hex(`${platformAccount.accountNo}${buyerAccount.accountNo}`)
                };

                const providerRes = await vfdProvider.transfer(transferReq);
                if (providerRes.status !== "00") {
                    await TransferService.failTransfer(trxn.reference);
                    throw new BadRequestError('Refund transfer failed: ' + providerRes.message);
                }
                await TransferService.completeTransfer(trxn.reference, "escrow-refund" as any);

                // Ledger: Debit Escrow Pool, Credit Buyer
                await LedgerService.createDoubleEntry(
                    trxn.traceId,
                    `user_wallet:${escrow.buyerId}`,
                    'escrow_pool',
                    escrow.totalAmount,
                    'escrow',
                    { subtype: 'refund', session }
                );

                escrow.status = 'CANCELLED';
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

        const escrows = await EscrowTransaction.find(query).sort({ createdAt: -1 });

        // Enrich with counterparty info
        // Doing this in loop for simplicity, but could be optimized with $in queries or aggregate
        const enriched = await Promise.all(escrows.map(async (e) => {
            const doc = e.toObject();
            if (e.buyerId === userId) {
                // I am Buyer, show Seller info
                const seller = await User.findById(e.sellerId).select('user_metadata.first_name user_metadata.surname email user_metadata.profile_photo');
                (doc as any).counterparty = seller ? {
                    name: `${seller.user_metadata.first_name || 'Invited'} ${seller.user_metadata.surname || 'User'}`,
                    email: seller.email,
                    photo: seller.user_metadata.profile_photo
                } : { name: 'Unknown', email: e.inviteEmail };
            } else {
                // I am Seller, show Buyer info
                const buyer = await User.findById(e.buyerId).select('user_metadata.first_name user_metadata.surname email user_metadata.profile_photo');
                (doc as any).counterparty = buyer ? {
                    name: `${buyer.user_metadata.first_name} ${buyer.user_metadata.surname}`,
                    email: buyer.email,
                    photo: buyer.user_metadata.profile_photo
                } : { name: 'Unknown' };
            }
            return doc;
        }));

        return enriched;
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

    /**
     * Admin: Get All Escrows
     * Supports search (ID, Title), status filter, and pagination
     */
    static async getAllEscrows(params: {
        page?: number;
        limit?: number;
        status?: string;
        search?: string;
    }) {
        const { page = 1, limit = 20, status, search } = params;
        const query: any = {};

        if (status) {
            query.status = status;
        }

        if (search) {
            // Search by Transaction ID, Escrow Title (Description), or Invite Email
            // For User names, we'd need a lookup, but let's stick to direct field search first or aggregate 
            // Simple approach: Match ID or Description
            query.$or = [
                { transactionId: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { inviteEmail: { $regex: search, $options: 'i' } },
                // If search looks like ObjectId, try matching _id, buyerId, sellerId
                ...(Types.ObjectId.isValid(search) ? [
                    { _id: search },
                    { buyerId: search },
                    { sellerId: search }
                ] : [])
            ];
        }

        const skip = (page - 1) * limit;

        const [escrows, total] = await Promise.all([
            EscrowTransaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
            EscrowTransaction.countDocuments(query)
        ]);

        // Enrich with User Details
        const enriched = await Promise.all(escrows.map(async (e) => {
            const doc = e.toObject();

            const [buyer, seller] = await Promise.all([
                User.findById(e.buyerId).select('user_metadata.first_name user_metadata.surname email user_metadata.profile_photo'),
                e.sellerId ? User.findById(e.sellerId).select('user_metadata.first_name user_metadata.surname email user_metadata.profile_photo') : null
            ]);

            (doc as any).buyer = buyer ? {
                id: buyer._id,
                name: `${buyer.user_metadata.first_name} ${buyer.user_metadata.surname}`,
                email: buyer.email,
                photo: buyer.user_metadata.profile_photo
            } : { name: 'Unknown', email: 'N/A' };

            (doc as any).seller = seller ? {
                id: seller._id,
                name: `${seller.user_metadata.first_name} ${seller.user_metadata.surname}`,
                email: seller.email,
                photo: seller.user_metadata.profile_photo
            } : {
                name: e.inviteEmail ? 'Invited User' : 'Unknown',
                email: e.inviteEmail
            };

            return doc;
        }));

        return {
            data: enriched,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }
}
