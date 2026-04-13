/**
 * Influencer Controller — REST handlers for influencer endpoints
 */
import { Request, Response, NextFunction } from 'express';
import { InfluencerService } from './influencer.service';
import { Influencer } from './influencer.model';
import { InfluencerCommission } from './influencer-commission.model';

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
          },
        },
      ]);

      const agg = earningsAgg[0] || { totalEarnings: 0, pendingPayouts: 0 };

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
          totalReferrals,
          commissionsByService,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/process-payouts
   */
  static async processPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const influencers = await Influencer.find({ pendingPayout: { $gt: 0 }, status: 'approved' });
      let processed = 0;
      let totalAmount = 0;

      for (const influencer of influencers) {
        await InfluencerCommission.updateMany(
          { influencerId: influencer._id, status: 'pending' },
          { $set: { status: 'paid', paidAt: new Date() } }
        );
        totalAmount += influencer.pendingPayout;
        influencer.pendingPayout = 0;
        await influencer.save();
        processed++;
      }

      return res.status(200).json({
        status: 'success',
        message: `Processed payouts for ${processed} influencer(s). Total: ₦${totalAmount.toLocaleString()}`,
        data: { processed, totalAmount },
      });
    } catch (err) { next(err); }
  }

  /* ---------- USER ENDPOINTS — Withdrawal ---------- */

  /**
   * POST /api/influencer/withdraw
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
      if (amount > influencer.pendingPayout) {
        return res.status(400).json({ status: 'failed', message: `Insufficient balance. Available: ₦${influencer.pendingPayout.toLocaleString()}` });
      }

      if (!influencer.payoutDetails?.accountNumber || !influencer.payoutDetails?.bankName) {
        return res.status(400).json({ status: 'failed', message: 'Please set your payout bank details first' });
      }

      const payoutEntry = {
        amount,
        date: new Date(),
        reference: `INF-WD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        status: 'pending' as const,
      };

      influencer.pendingPayout -= amount;
      influencer.payoutHistory.push(payoutEntry);
      await influencer.save();

      await InfluencerCommission.updateMany(
        { influencerId: influencer._id, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } }
      );

      return res.status(200).json({
        status: 'success',
        message: `Withdrawal of ₦${amount.toLocaleString()} initiated`,
        data: payoutEntry,
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
