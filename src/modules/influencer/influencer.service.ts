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
  CommissionTransactionType
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

      const rates = settings.influencer.commissionRates;
      let commissionRate = 0;
      let commissionAmount = 0;

      if (data.transactionType === 'signup') {
        // Flat bonus for signup
        commissionAmount = rates.signup_bonus || 100;
        commissionRate = 0;
      } else {
        // Percentage-based for transactions
        commissionRate = rates[data.transactionType] || 0;
        commissionAmount = Number(((commissionRate / 100) * data.transactionAmount).toFixed(2));
      }

      if (commissionAmount <= 0) return;

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
            pendingPayout: commissionAmount
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
   * This is the method transaction hooks should call (fire-and-forget).
   */
  static async recordCommissionForUser(
    userId: string,
    transactionType: CommissionTransactionType,
    transactionAmount: number,
    transactionRef?: string
  ): Promise<void> {
    try {
      const UserModel = (await import('../users/user.model')).default;
      const user = await UserModel.findById(userId).select('referredBy').lean();
      if (!user || !user.referredBy) return; // User wasn't referred — nothing to do

      const influencer = await Influencer.findById(user.referredBy);
      if (!influencer || influencer.status !== 'approved') return;

      await this.recordCommission(influencer._id.toString(), {
        userId,
        transactionType,
        transactionAmount,
        transactionRef: transactionRef || `auto_${Date.now()}`
      });
    } catch (err: any) {
      // Completely non-fatal — never break the parent transaction
      logger.warn({ userId, transactionType, error: err.message }, 'recordCommissionForUser failed (non-fatal)');
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
      { $group: { _id: '$transactionType', total: { $sum: '$commissionAmount' } } }
    ]);

    const earningsByService: Record<CommissionTransactionType, number> = {
      loan: 0, escrow: 0, savings: 0, 'bill-payment': 0, marketplace: 0, signup: 0
    };
    for (const entry of earningsAgg) {
      earningsByService[entry._id as CommissionTransactionType] = entry.total;
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
   * Generate a unique referral code (e.g., "PF-XYZABC")
   */
  private static generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'PF-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
