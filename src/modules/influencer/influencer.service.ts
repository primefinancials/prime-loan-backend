/**
 * Influencer Service — Business logic for the affiliate/influencer system
 */
import { Influencer } from './influencer.model';
import { InfluencerCommission } from './influencer-commission.model';
import { SettingsService } from '../admin/settings.service';
import { NotFoundError, BadRequestError } from '../../exceptions';
import { UuidService } from '../../shared/utils/uuid';
import {
  IInfluencer,
  RecordCommissionDto,
  InfluencerDashboard,
  CommissionTransactionType,
  DiscountConfig
} from './influencer.interface';
import pino from 'pino';

const logger = pino({ name: 'influencer-service' });

export class InfluencerService {

  /**
   * Apply to become an influencer
   */
  static async apply(userId: string, applicationVideo?: string, socialLinks?: Record<string, string>): Promise<IInfluencer> {
    const existing = await Influencer.findOne({ userId });
    if (existing) {
      if (existing.status === 'approved') throw new BadRequestError('Already an approved influencer');
      if (existing.status === 'pending') throw new BadRequestError('Application already pending');
      if (existing.status === 'rejected') {
        // Allow re-application after rejection
        existing.status = 'pending';
        existing.applicationVideo = applicationVideo;
        if (socialLinks) existing.socialLinks = socialLinks;
        existing.applicationDate = new Date();
        existing.rejectionReason = undefined;
        return await existing.save();
      }
    }

    return await Influencer.create({
      userId,
      applicationVideo,
      socialLinks,
      status: 'pending',
      applicationDate: new Date()
    });
  }

  /**
   * Admin: Approve an influencer application
   */
  static async approve(influencerId: string, adminId: string): Promise<IInfluencer> {
    const influencer = await Influencer.findById(influencerId);
    if (!influencer) throw new NotFoundError('Influencer not found');
    if (influencer.status === 'approved') throw new BadRequestError('Already approved');

    influencer.status = 'approved';
    influencer.approvalDate = new Date();
    influencer.referralCode = this.generateReferralCode();
    await influencer.save();

    logger.info({ influencerId, adminId, referralCode: influencer.referralCode }, 'Influencer approved');
    return influencer;
  }

  /**
   * Admin: Reject an influencer application
   */
  static async reject(influencerId: string, adminId: string, reason: string): Promise<IInfluencer> {
    const influencer = await Influencer.findById(influencerId);
    if (!influencer) throw new NotFoundError('Influencer not found');

    influencer.status = 'rejected';
    influencer.rejectionReason = reason;
    await influencer.save();

    logger.info({ influencerId, adminId, reason }, 'Influencer rejected');
    return influencer;
  }

  /**
   * Get influencer by userId
   */
  static async getByUserId(userId: string): Promise<IInfluencer | null> {
    return Influencer.findOne({ userId });
  }

  /**
   * Get influencer by referral code
   */
  static async getByReferralCode(code: string): Promise<IInfluencer | null> {
    return Influencer.findOne({ referralCode: code, status: 'approved' });
  }

  /**
   * Record a commission for an influencer (called after successful referral-driven transactions)
   */
  static async recordCommission(influencerId: string, data: RecordCommissionDto): Promise<void> {
    try {
      const settings = await SettingsService.getSettings();
      if (!settings.influencer?.enabled) return;

      const influencer = await Influencer.findById(influencerId);
      if (!influencer || influencer.status !== 'approved') return;

      const rates = (settings.influencer.commissionRates as any)?.toObject?.() || settings.influencer.commissionRates;
      let commissionRate = 0;
      let commissionAmount = 0;

      if (data.transactionType === 'signup') {
        // Flat bonus for signup - prioritize explicitly passed amount
        commissionAmount = data.transactionAmount > 0 ? data.transactionAmount : (rates.signup_bonus || 100);
        commissionRate = 0;
      } else {
        // Percentage-based for transactions
        commissionRate = rates[data.transactionType] || 0;
        commissionAmount = Number(((commissionRate / 100) * data.transactionAmount).toFixed(2));
      }

      logger.info({
        influencerId,
        transactionType: data.transactionType,
        amount: data.transactionAmount,
        rate: commissionRate,
        commission: commissionAmount
      }, 'Calculating influencer commission');

      if (commissionAmount <= 0 && data.transactionType !== 'signup') {
        logger.warn({ influencerId, transactionType: data.transactionType }, 'Commission amount is 0, skipping record');
        return;
      }

      await InfluencerCommission.create({
        influencerId: influencer._id,
        userId: data.userId,
        transactionRef: data.transactionRef,
        transactionType: data.transactionType,
        transactionAmount: data.transactionAmount,
        commissionRate,
        commissionAmount,
        status: 'pending'
      });

      // Update influencer totals
      await Influencer.updateOne(
        { _id: influencer._id },
        {
          $inc: {
            totalEarnings: commissionAmount,
            pendingPayout: commissionAmount,
            totalVolumeGenerated: data.transactionAmount
          }
        }
      );

      logger.info({
        influencerId: influencer._id,
        userId: data.userId,
        type: data.transactionType,
        commissionAmount
      }, 'Commission recorded');
    } catch (err: any) {
      // Non-fatal — commission recording should never break the main transaction
      logger.error({ error: err.message, influencerId, data }, 'Failed to record commission');
    }
  }

  /**
   * Convenience: Record commission for a transacting user.
   * Looks up if the user was referred by an influencer, and if so records the commission.
   * If referralCode is provided, it overrides the signup referrer for this transaction only.
   * This is the method transaction hooks should call (fire-and-forget).
   */
  static async recordCommissionForUser(
    userId: string,
    transactionType: CommissionTransactionType,
    transactionAmount: number,
    transactionRef?: string,
    referralCode?: string
  ): Promise<void> {
    try {
      let influencer: IInfluencer | null = null;
      const normalizedCode = referralCode?.toUpperCase().trim();
      
      logger.info({ userId, transactionType, transactionAmount, referralCode: normalizedCode }, 'Attempting to record commission for user');

      // Per-transaction referral code takes priority
      if (normalizedCode) {
        influencer = await Influencer.findOne({ referralCode: normalizedCode, status: 'approved' });
        logger.info({ referralCode: normalizedCode, found: !!influencer }, 'Checked explicit referral code');
      }

      // Fallback to signup referrer
      if (!influencer) {
        const UserModel = (await import('../users/user.model')).default;
        const user = await UserModel.findById(userId).select('referredBy').lean();
        logger.info({ userId, hasReferredBy: !!user?.referredBy }, 'Checked user signup referrer');
        if (!user || !user.referredBy) return;

        // referredBy may store the Influencer document _id OR the user's userId
        // Try both lookups to handle either case
        influencer = await Influencer.findById(user.referredBy);
        if (!influencer) {
          // Fallback: referredBy might store the influencer's userId, not their Influencer doc _id
          influencer = await Influencer.findOne({ userId: user.referredBy });
        }
        logger.info({ referredBy: user.referredBy, found: !!influencer, method: influencer ? 'found' : 'not_found' }, 'Checked influencer by referredBy');
      }

      if (!influencer || influencer.status !== 'approved') {
        logger.warn({ influencerId: influencer?._id, status: influencer?.status }, 'Influencer not found or not approved');
        return;
      }

      await this.recordCommission(influencer._id.toString(), {
        userId,
        transactionType,
        transactionAmount: Number(transactionAmount),
        transactionRef: transactionRef || `auto_${Date.now()}`,
        referralCode: normalizedCode
      });
    } catch (err: any) {
      // Completely non-fatal — never break the parent transaction
      logger.error({ userId, transactionType, error: err.message }, 'recordCommissionForUser failed (non-fatal)');
    }
  }

  /**
   * Get influencer dashboard data
   */
  static async getDashboard(userId: string): Promise<InfluencerDashboard> {
    const influencer = await Influencer.findOne({ userId });
    if (!influencer) throw new NotFoundError('Not an influencer');

    // Count referred users - import User model dynamically to avoid circular deps
    const UserModel = (await import('../users/user.model')).default;
    const totalReferred = await UserModel.countDocuments({ referredBy: influencer._id });

    // Earnings breakdown by service
    const earningsAgg = await InfluencerCommission.aggregate([
      { $match: { influencerId: influencer._id } },
      { $group: { _id: '$transactionType', total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
    ]);

    const earningsByService: Record<CommissionTransactionType, { total: number; count: number }> = {
      loan: { total: 0, count: 0 }, escrow: { total: 0, count: 0 }, savings: { total: 0, count: 0 },
      'bill-payment': { total: 0, count: 0 }, marketplace: { total: 0, count: 0 }, signup: { total: 0, count: 0 }
    };
    for (const entry of earningsAgg) {
      earningsByService[entry._id as CommissionTransactionType] = { total: entry.total, count: entry.count };
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://primefinance.live';

    return {
      status: influencer.status,
      referralCode: influencer.referralCode || '',
      referralLink: influencer.referralCode ? `${baseUrl}/signup?ref=${influencer.referralCode}` : '',
      totalReferred,
      totalEarnings: influencer.totalEarnings,
      pendingPayout: influencer.pendingPayout,
      earningsByService
    };
  }

  /**
   * Get referred users (paginated)
   */
  static async getReferredUsers(influencerId: string, page = 1, limit = 20) {
    const influencer = await Influencer.findById(influencerId);
    if (!influencer) throw new NotFoundError('Influencer not found');

    const UserModel = (await import('../users/user.model')).default;
    const skip = (page - 1) * limit;
    const users = await UserModel.find({ referredBy: influencer._id })
      .select('email user_metadata.first_name user_metadata.last_name createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const total = await UserModel.countDocuments({ referredBy: influencer._id });

    return { users, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /**
   * Get earnings breakdown by date range
   */
  static async getEarningsBreakdown(influencerId: string, from?: Date, to?: Date) {
    const match: any = { influencerId: influencerId };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    return InfluencerCommission.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$transactionType',
          totalAmount: { $sum: '$commissionAmount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);
  }

  /**
   * Admin: List all influencers (paginated)
   */
  static async listAll(page = 1, limit = 20, status?: string) {
    const filter: any = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const influencers = await Influencer.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const total = await Influencer.countDocuments(filter);

    return { influencers, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /**
   * Resolve a referral code — returns the influencer and discount config, or null.
   * Used by transaction controllers to validate and apply referral-based discounts.
   */
  static async resolveReferralCode(code: string): Promise<{
    influencer: IInfluencer;
    discountConfig: DiscountConfig;
  } | null> {
    if (!code) return null;
    const influencer = await Influencer.findOne({ referralCode: code.toUpperCase().trim(), status: 'approved' });
    if (!influencer) return null;

    const discountConfig: DiscountConfig = {
      enabled: influencer.discountConfig?.enabled ?? false,
      discountPercent: influencer.discountConfig?.discountPercent ?? 0,
      bonusAmount: influencer.discountConfig?.bonusAmount ?? 0,
    };

    return { influencer, discountConfig };
  }

  /**
   * Apply referral discount to a transaction amount.
   * Returns { discountedAmount, discountValue, bonusAmount }.
   */
  static applyReferralDiscount(
    originalAmount: number,
    discountConfig: DiscountConfig
  ): { discountedAmount: number; discountValue: number; bonusAmount: number } {
    if (!discountConfig.enabled) {
      return { discountedAmount: originalAmount, discountValue: 0, bonusAmount: 0 };
    }

    const discountValue = Number(((discountConfig.discountPercent / 100) * originalAmount).toFixed(2));
    const discountedAmount = Number((originalAmount - discountValue).toFixed(2));
    const bonusAmount = discountConfig.bonusAmount || 0;

    return { discountedAmount, discountValue, bonusAmount };
  }

  /**
   * Admin: Update discount config for an influencer
   */
  static async updateDiscountConfig(
    influencerId: string,
    config: Partial<DiscountConfig>
  ): Promise<IInfluencer> {
    const influencer = await Influencer.findById(influencerId);
    if (!influencer) throw new NotFoundError('Influencer not found');

    if (config.discountPercent !== undefined && (config.discountPercent < 0 || config.discountPercent > 100)) {
      throw new BadRequestError('Discount percentage must be between 0 and 100');
    }
    if (config.bonusAmount !== undefined && config.bonusAmount < 0) {
      throw new BadRequestError('Bonus amount cannot be negative');
    }

    // Warn if > 20% but allow
    if (config.discountPercent !== undefined && config.discountPercent > 20) {
      logger.warn({ influencerId, discountPercent: config.discountPercent }, 'High discount percentage set (>20%)');
    }

    influencer.discountConfig = {
      enabled: config.enabled ?? influencer.discountConfig?.enabled ?? false,
      discountPercent: config.discountPercent ?? influencer.discountConfig?.discountPercent ?? 0,
      bonusAmount: config.bonusAmount ?? influencer.discountConfig?.bonusAmount ?? 0,
    };

    await influencer.save();
    logger.info({ influencerId, discountConfig: influencer.discountConfig }, 'Discount config updated');
    return influencer;
  }

  /**
   * Generate a unique referral code (e.g., "PF-XYZABC")
   */
  private static generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'PL-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
