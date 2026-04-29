/**
 * Influencer Controller — REST handlers for influencer endpoints
 */
import { Request, Response, NextFunction } from 'express';
import { InfluencerService } from './influencer.service';
import { Influencer } from './influencer.model';
import { InfluencerCommission } from './influencer-commission.model';
import { VfdProvider, TransferRequest } from '../../shared/providers/vfd.provider';
import { TransferService } from '../transfers/transfer.service';
import { sha512 } from 'js-sha512';
import pino from 'pino';

const logger = pino({ name: 'influencer-controller' });

export class InfluencerController {

  /**
   * GET /api/influencer/me
   * Get the current user's influencer profile (returns 404 if not applied)
   */
  static async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const influencer = await InfluencerService.getByUserId(userId);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Not an influencer' });
      return res.status(200).json({ status: 'success', data: influencer });
    } catch (err) { next(err); }
  }

  /**
   * POST /api/influencer/apply
   * Apply to become an influencer
   */
  static async apply(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { applicationVideo, socialLinks } = req.body;
      const result = await InfluencerService.apply(userId, applicationVideo, socialLinks);
      return res.status(201).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/influencer/dashboard
   * Get influencer dashboard data
   */
  static async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const dashboard = await InfluencerService.getDashboard(userId);
      return res.status(200).json({ status: 'success', data: dashboard });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/influencer/referred-users
   * Get list of referred users (paginated)
   */
  static async getReferredUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const influencer = await InfluencerService.getByUserId(userId);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Not an influencer' });

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await InfluencerService.getReferredUsers(influencer._id.toString(), page, limit);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/influencer/earnings
   * Get earnings breakdown
   */
  static async getEarnings(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const influencer = await InfluencerService.getByUserId(userId);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Not an influencer' });

      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const result = await InfluencerService.getEarningsBreakdown(influencer._id.toString(), from, to);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /* ---------- ADMIN ENDPOINTS ---------- */

  /**
   * GET /backoffice/influencers
   * List all influencers (admin) — populates user data
   */
  static async listAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string || undefined;
      const skip = (page - 1) * limit;

      const filter: any = {};
      if (status && status !== 'all') filter.status = status;

      const [influencers, total] = await Promise.all([
        Influencer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Influencer.countDocuments(filter),
      ]);

      // Populate user data (name, email) from User model
      const UserModel = (await import('../users/user.model')).default;
      const userIds = influencers.map((i: any) => i.userId).filter(Boolean);
      const users = await UserModel.find({ _id: { $in: userIds } })
        .select('_id user_metadata.first_name user_metadata.surname user_metadata.email user_metadata.phone email')
        .lean();

      const userMap = new Map(users.map((u: any) => [String(u._id), u]));

      const enriched = influencers.map((inf: any) => {
        const user = userMap.get(String(inf.userId));
        return {
          ...inf,
          userId: user || { _id: inf.userId, user_metadata: {}, email: '' },
        };
      });

      return res.status(200).json({
        status: 'success',
        data: {
          influencers: enriched,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * GET /backoffice/influencers/:id
   * Get influencer details with earnings breakdown (admin)
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const influencer = await Influencer.findById(req.params.id).lean();
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer not found' });

      // Populate user data
      const UserModel = (await import('../users/user.model')).default;
      const user = await UserModel.findById((influencer as any).userId)
        .select('_id user_metadata email')
        .lean();

      // Earnings breakdown by category
      const earningsBreakdown = await InfluencerCommission.aggregate([
        { $match: { influencerId: influencer._id } },
        {
          $group: {
            _id: '$transactionType',
            totalCommission: { $sum: '$commissionAmount' },
            totalPlatformEarnings: { $sum: '$transactionAmount' },
            count: { $sum: 1 },
          },
        },
      ]);

      const breakdown: Record<string, { totalCommission: number; totalPlatformEarnings: number; count: number }> = {};
      for (const item of earningsBreakdown) {
        breakdown[item._id] = { totalCommission: item.totalCommission, totalPlatformEarnings: item.totalPlatformEarnings, count: item.count };
      }

      // Recent commissions
      const recentCommissions = await InfluencerCommission.find({ influencerId: influencer._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      return res.status(200).json({
        status: 'success',
        data: {
          ...influencer,
          userId: user || { _id: (influencer as any).userId },
          earningsBreakdown: breakdown,
          recentCommissions,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/approve
   */
  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any).admin?._id || (req as any).admin?.id;
      const result = await InfluencerService.approve(req.params.id, adminId);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/reject
   */
  static async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any).admin?._id || (req as any).admin?.id;
      const { reason } = req.body;
      const result = await InfluencerService.reject(req.params.id, adminId, reason);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/suspend
   */
  static async suspend(req: Request, res: Response, next: NextFunction) {
    try {
      const influencer = await Influencer.findById(req.params.id);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer not found' });
      if (influencer.status !== 'approved') {
        return res.status(400).json({ status: 'failed', message: 'Only approved influencers can be suspended' });
      }
      influencer.status = 'suspended';
      await influencer.save();
      return res.status(200).json({ status: 'success', data: influencer });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/reactivate
   */
  static async reactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const influencer = await Influencer.findById(req.params.id);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer not found' });
      if (influencer.status !== 'suspended') {
        return res.status(400).json({ status: 'failed', message: 'Only suspended influencers can be reactivated' });
      }
      influencer.status = 'approved';
      await influencer.save();
      return res.status(200).json({ status: 'success', data: influencer });
    } catch (err) { next(err); }
  }

  /**
   * GET /backoffice/influencers/stats
   */
  static async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const [total, pending, approved, rejected, suspended] = await Promise.all([
        Influencer.countDocuments(),
        Influencer.countDocuments({ status: 'pending' }),
        Influencer.countDocuments({ status: 'approved' }),
        Influencer.countDocuments({ status: 'rejected' }),
        Influencer.countDocuments({ status: 'suspended' }),
      ]);

      const earningsAgg = await Influencer.aggregate([
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: '$totalEarnings' },
            pendingPayouts: { $sum: '$pendingPayout' },
            totalVolume: { $sum: '$totalVolumeGenerated' },
          },
        },
      ]);

      const agg = earningsAgg[0] || { totalEarnings: 0, pendingPayouts: 0, totalVolume: 0 };

      // Total paid out (commissions with status 'paid')
      const paidAgg = await InfluencerCommission.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, totalPaid: { $sum: '$commissionAmount' } } }
      ]);

      // Total referrals (users with referredBy set)
      const UserModel = (await import('../users/user.model')).default;
      const totalReferrals = await UserModel.countDocuments({ referredBy: { $exists: true, $ne: null } });

      // Per-service commission breakdown
      const commissionsByServiceAgg = await InfluencerCommission.aggregate([
        { $group: {
          _id: '$transactionType',
          totalCommission: { $sum: '$commissionAmount' },
          totalPlatformEarnings: { $sum: '$transactionAmount' },
          count: { $sum: 1 }
        }}
      ]);
      const commissionsByService: Record<string, { totalCommission: number; totalPlatformEarnings: number; count: number }> = {};
      for (const c of commissionsByServiceAgg) {
        commissionsByService[c._id] = { totalCommission: c.totalCommission, totalPlatformEarnings: c.totalPlatformEarnings, count: c.count };
      }

      return res.status(200).json({
        status: 'success',
        data: {
          total, pending, approved, rejected, suspended,
          activeInfluencers: approved,
          totalEarnings: agg.totalEarnings,
          pendingPayouts: agg.pendingPayouts,
          totalPaid: paidAgg[0]?.totalPaid || 0,
          totalVolume: agg.totalVolume || 0,
          totalReferrals,
          commissionsByService,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/process-payouts
   * Bulk payout: Transfer funds from Prime account to each influencer's VFD wallet
   */
  static async processPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const influencers = await Influencer.find({ pendingPayout: { $gt: 0 }, status: 'approved' });
      const UserModel = (await import('../users/user.model')).default;
      const vfd = new VfdProvider();
      const platformAccount = (await vfd.getPrimeAccountInfo()).data;

      if (!platformAccount?.accountNo) {
        return res.status(500).json({ status: 'failed', message: 'Could not fetch platform account info' });
      }

      let processed = 0;
      let failed = 0;
      let skipped = 0;
      let totalAmount = 0;
      const results: Array<{ influencerId: string; name: string; amount: number; status: string; reason?: string }> = [];

      for (const influencer of influencers) {
        const payoutAmount = Math.round(influencer.pendingPayout * 100) / 100;
        if (payoutAmount <= 0) { skipped++; continue; }

        // Look up the influencer's user record for their VFD account
        const user = await UserModel.findById(influencer.userId);
        if (!user || !user.user_metadata?.accountNo) {
          skipped++;
          results.push({ influencerId: String(influencer._id), name: 'Unknown', amount: payoutAmount, status: 'skipped', reason: 'No VFD account found' });
          continue;
        }

        const userName = `${user.user_metadata.first_name || ''} ${user.user_metadata.surname || ''}`.trim() || 'Influencer';

        try {
          const userAccount = (await vfd.getAccountInfo(user.user_metadata.accountNo)).data;
          if (!userAccount?.accountNo) {
            skipped++;
            results.push({ influencerId: String(influencer._id), name: userName, amount: payoutAmount, status: 'skipped', reason: 'VFD account enquiry failed' });
            continue;
          }

          // 1. Initiate internal transfer record
          const trxn = await TransferService.initiateTransfer({
            fromAccount: platformAccount.accountNo,
            userId: String(user._id),
            toAccount: userAccount.accountNo,
            amount: payoutAmount,
            beneficiaryName: userAccount.client,
            transferType: 'intra',
            bankCode: '999999',
            remark: `Influencer commission payout`,
            walletBalance: String(platformAccount.accountBalance),
            naration: `Commission payout to ${userName} (${influencer.referralCode || ''})`,
          }, 'transfer');

          // 2. Execute VFD transfer: Prime → Influencer wallet
          const transferReq: TransferRequest = {
            uniqueSenderAccountId: '',
            fromAccount: platformAccount.accountNo,
            fromClientId: platformAccount.clientId,
            fromSavingsId: platformAccount.accountId,
            fromClient: platformAccount.client,
            toAccount: userAccount.accountNo,
            toClientId: userAccount.clientId,
            toClient: userAccount.client,
            toSavingsId: userAccount.accountId,
            toSession: userAccount.accountId,
            toBank: '999999',
            amount: payoutAmount,
            remark: `Influencer Payout - ${influencer.referralCode || ''}`,
            transferType: 'intra',
            reference: trxn.reference,
            signature: sha512.hex(`${platformAccount.accountNo}${userAccount.accountNo}`),
          };

          const providerRes = await vfd.transfer(transferReq);

          if (providerRes.status !== '00') {
            await TransferService.failTransfer(trxn.reference);
            failed++;
            influencer.payoutHistory.push({
              amount: payoutAmount, date: new Date(),
              reference: trxn.reference, status: 'failed',
            });
            await influencer.save();
            results.push({ influencerId: String(influencer._id), name: userName, amount: payoutAmount, status: 'failed', reason: providerRes.message });
            continue;
          }

          // 3. Complete internal transfer
          await TransferService.completeTransfer(trxn.reference, 'transfer');

          // 4. Update influencer records
          await InfluencerCommission.updateMany(
            { influencerId: influencer._id, status: 'pending' },
            { $set: { status: 'paid', paidAt: new Date() } }
          );

          influencer.payoutHistory.push({
            amount: payoutAmount, date: new Date(),
            reference: trxn.reference, status: 'completed',
          });
          totalAmount += payoutAmount;
          influencer.pendingPayout = 0;
          await influencer.save();
          processed++;
          results.push({ influencerId: String(influencer._id), name: userName, amount: payoutAmount, status: 'completed' });

          logger.info({ influencerId: influencer._id, amount: payoutAmount, reference: trxn.reference }, 'Influencer payout transferred successfully');
        } catch (err: any) {
          failed++;
          logger.error({ err: err.message, influencerId: influencer._id }, 'Influencer payout transfer failed');
          influencer.payoutHistory.push({
            amount: payoutAmount, date: new Date(),
            reference: `ERR-${Date.now()}`, status: 'failed',
          });
          await influencer.save();
          results.push({ influencerId: String(influencer._id), name: userName, amount: payoutAmount, status: 'failed', reason: err.message });
        }
      }

      return res.status(200).json({
        status: 'success',
        message: `Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}. Total transferred: ₦${totalAmount.toLocaleString()}`,
        data: { processed, failed, skipped, totalAmount, results },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/payout
   * Admin: Pay out a single influencer
   */
  static async payoutSingleInfluencer(req: Request, res: Response, next: NextFunction) {
    try {
      const influencer = await Influencer.findById(req.params.id);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer not found' });
      if (influencer.status !== 'approved') return res.status(400).json({ status: 'failed', message: 'Only approved influencers can receive payouts' });

      const payoutAmount = Math.round(influencer.pendingPayout * 100) / 100;
      if (payoutAmount <= 0) return res.status(400).json({ status: 'failed', message: 'No pending payout balance' });

      const UserModel = (await import('../users/user.model')).default;
      const user = await UserModel.findById(influencer.userId);
      if (!user || !user.user_metadata?.accountNo) {
        return res.status(400).json({ status: 'failed', message: 'Influencer has no VFD account linked' });
      }

      const vfd = new VfdProvider();
      const platformAccount = (await vfd.getPrimeAccountInfo()).data;
      const userAccount = (await vfd.getAccountInfo(user.user_metadata.accountNo)).data;

      if (!platformAccount?.accountNo || !userAccount?.accountNo) {
        return res.status(500).json({ status: 'failed', message: 'Could not fetch account info' });
      }

      // 1. Initiate transfer record
      const trxn = await TransferService.initiateTransfer({
        fromAccount: platformAccount.accountNo,
        userId: String(user._id),
        toAccount: userAccount.accountNo,
        amount: payoutAmount,
        beneficiaryName: userAccount.client,
        transferType: 'intra',
        bankCode: '999999',
        remark: `Influencer commission payout`,
        walletBalance: String(platformAccount.accountBalance),
        naration: `Commission payout to ${user.user_metadata.first_name || ''} (${influencer.referralCode || ''})`,
      }, 'transfer');

      // 2. Execute VFD transfer
      const transferReq: TransferRequest = {
        uniqueSenderAccountId: '',
        fromAccount: platformAccount.accountNo,
        fromClientId: platformAccount.clientId,
        fromSavingsId: platformAccount.accountId,
        fromClient: platformAccount.client,
        toAccount: userAccount.accountNo,
        toClientId: userAccount.clientId,
        toClient: userAccount.client,
        toSavingsId: userAccount.accountId,
        toSession: userAccount.accountId,
        toBank: '999999',
        amount: payoutAmount,
        remark: `Influencer Payout - ${influencer.referralCode || ''}`,
        transferType: 'intra',
        reference: trxn.reference,
        signature: sha512.hex(`${platformAccount.accountNo}${userAccount.accountNo}`),
      };

      const providerRes = await vfd.transfer(transferReq);

      if (providerRes.status !== '00') {
        await TransferService.failTransfer(trxn.reference);
        influencer.payoutHistory.push({ amount: payoutAmount, date: new Date(), reference: trxn.reference, status: 'failed' });
        await influencer.save();
        return res.status(500).json({ status: 'failed', message: `Transfer failed: ${providerRes.message}` });
      }

      // 3. Complete transfer
      await TransferService.completeTransfer(trxn.reference, 'transfer');

      // 4. Update records
      await InfluencerCommission.updateMany(
        { influencerId: influencer._id, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } }
      );

      influencer.payoutHistory.push({ amount: payoutAmount, date: new Date(), reference: trxn.reference, status: 'completed' });
      influencer.pendingPayout = 0;
      await influencer.save();

      logger.info({ influencerId: influencer._id, amount: payoutAmount, reference: trxn.reference }, 'Single influencer payout completed');

      return res.status(200).json({
        status: 'success',
        message: `₦${payoutAmount.toLocaleString()} transferred successfully`,
        data: { amount: payoutAmount, reference: trxn.reference },
      });
    } catch (err) { next(err); }
  }

  /* ---------- USER ENDPOINTS — Withdrawal ---------- */

  /**
   * POST /api/influencer/withdraw
   * User: Withdraw pending commissions to their VFD wallet
   */
  static async requestWithdrawal(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ status: 'failed', message: 'Invalid withdrawal amount' });
      }

      const influencer = await Influencer.findOne({ userId: String(userId) });
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer profile not found' });
      if (influencer.status !== 'approved') {
        return res.status(400).json({ status: 'failed', message: 'Only approved influencers can withdraw' });
      }

      const withdrawAmount = Math.round(Math.min(amount, influencer.pendingPayout) * 100) / 100;
      if (withdrawAmount <= 0) {
        return res.status(400).json({ status: 'failed', message: `Insufficient balance. Available: ₦${influencer.pendingPayout.toLocaleString()}` });
      }

      // Look up the user's VFD account
      const UserModel = (await import('../users/user.model')).default;
      const user = await UserModel.findById(userId);
      if (!user || !user.user_metadata?.accountNo) {
        return res.status(400).json({ status: 'failed', message: 'No VFD account linked to your profile' });
      }

      const vfd = new VfdProvider();
      const platformAccount = (await vfd.getPrimeAccountInfo()).data;
      const userAccount = (await vfd.getAccountInfo(user.user_metadata.accountNo)).data;

      if (!platformAccount?.accountNo || !userAccount?.accountNo) {
        return res.status(500).json({ status: 'failed', message: 'Could not fetch account info for transfer' });
      }

      // 1. Initiate transfer record
      const trxn = await TransferService.initiateTransfer({
        fromAccount: platformAccount.accountNo,
        userId: String(user._id),
        toAccount: userAccount.accountNo,
        amount: withdrawAmount,
        beneficiaryName: userAccount.client,
        transferType: 'intra',
        bankCode: '999999',
        remark: `Influencer commission withdrawal`,
        walletBalance: String(platformAccount.accountBalance),
        naration: `Commission withdrawal by ${user.user_metadata.first_name || 'Influencer'}`,
      }, 'transfer');

      // 2. Execute VFD transfer: Prime → Influencer VFD wallet
      const transferReq: TransferRequest = {
        uniqueSenderAccountId: '',
        fromAccount: platformAccount.accountNo,
        fromClientId: platformAccount.clientId,
        fromSavingsId: platformAccount.accountId,
        fromClient: platformAccount.client,
        toAccount: userAccount.accountNo,
        toClientId: userAccount.clientId,
        toClient: userAccount.client,
        toSavingsId: userAccount.accountId,
        toSession: userAccount.accountId,
        toBank: '999999',
        amount: withdrawAmount,
        remark: `Influencer Withdrawal - ${influencer.referralCode || ''}`,
        transferType: 'intra',
        reference: trxn.reference,
        signature: sha512.hex(`${platformAccount.accountNo}${userAccount.accountNo}`),
      };

      const providerRes = await vfd.transfer(transferReq);

      if (providerRes.status !== '00') {
        await TransferService.failTransfer(trxn.reference);
        influencer.payoutHistory.push({ amount: withdrawAmount, date: new Date(), reference: trxn.reference, status: 'failed' });
        await influencer.save();
        return res.status(500).json({ status: 'failed', message: `Transfer failed: ${providerRes.message}` });
      }

      // 3. Complete transfer
      await TransferService.completeTransfer(trxn.reference, 'transfer');

      // 4. Update influencer records
      influencer.pendingPayout = Math.max(0, influencer.pendingPayout - withdrawAmount);
      influencer.payoutHistory.push({ amount: withdrawAmount, date: new Date(), reference: trxn.reference, status: 'completed' });
      await influencer.save();

      // Mark commissions as paid (up to the withdrawn amount)
      const pendingCommissions = await InfluencerCommission.find({ influencerId: influencer._id, status: 'pending' }).sort({ createdAt: 1 });
      let remaining = withdrawAmount;
      for (const comm of pendingCommissions) {
        if (remaining <= 0) break;
        comm.status = 'paid';
        (comm as any).paidAt = new Date();
        await comm.save();
        remaining -= comm.commissionAmount;
      }

      logger.info({ userId, amount: withdrawAmount, reference: trxn.reference }, 'Influencer withdrawal completed');

      return res.status(200).json({
        status: 'success',
        message: `₦${withdrawAmount.toLocaleString()} has been transferred to your wallet`,
        data: { amount: withdrawAmount, reference: trxn.reference },
      });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/influencer/payouts
   */
  static async getPayoutHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const influencer = await Influencer.findOne({ userId: String(userId) })
        .select('payoutHistory pendingPayout totalEarnings payoutDetails');
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer profile not found' });

      return res.status(200).json({
        status: 'success',
        data: {
          payoutHistory: influencer.payoutHistory || [],
          pendingPayout: influencer.pendingPayout,
          totalEarnings: influencer.totalEarnings,
          payoutDetails: influencer.payoutDetails,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * PUT /api/influencer/payout-details
   */
  static async updatePayoutDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user._id || (req as any).user.id;
      const { bankName, accountNumber, accountName } = req.body;

      if (!bankName || !accountNumber || !accountName) {
        return res.status(400).json({ status: 'failed', message: 'bankName, accountNumber, and accountName are required' });
      }

      const influencer = await Influencer.findOneAndUpdate(
        { userId: String(userId) },
        { $set: { payoutDetails: { bankName, accountNumber, accountName } } },
        { new: true }
      );

      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer profile not found' });

      return res.status(200).json({
        status: 'success',
        data: { payoutDetails: influencer.payoutDetails },
      });
    } catch (err) { next(err); }
  }

  /**
   * PUT /backoffice/influencers/:id/discount-config
   * Admin: Update per-influencer discount/bonus configuration
   */
  static async updateDiscountConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const { enabled, discountPercent, bonusAmount } = req.body;
      const result = await InfluencerService.updateDiscountConfig(req.params.id, {
        enabled,
        discountPercent,
        bonusAmount,
      });
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * GET /api/referral/check?code=XXXX
   * Public/User: Validate a referral code and return discount info
   */
  static async checkReferralCode(req: Request, res: Response, next: NextFunction) {
    try {
      const code = req.query.code as string;
      if (!code) {
        return res.status(400).json({ status: 'failed', message: 'Referral code is required' });
      }

      const result = await InfluencerService.resolveReferralCode(code);
      if (!result) {
        return res.status(404).json({ status: 'failed', message: 'Invalid or inactive referral code' });
      }

      return res.status(200).json({
        status: 'success',
        data: {
          valid: true,
          referralCode: result.influencer.referralCode,
          discountEnabled: result.discountConfig.enabled,
          discountPercent: result.discountConfig.discountPercent,
          bonusAmount: result.discountConfig.bonusAmount,
        },
      });
    } catch (err) { next(err); }
  }
}
