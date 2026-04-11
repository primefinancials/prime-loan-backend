/**
 * Influencer Controller — REST handlers for influencer endpoints
 */
import { Request, Response, NextFunction } from 'express';
import { InfluencerService } from './influencer.service';

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
   * List all influencers (admin)
   */
  static async listAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string || undefined;
      const result = await InfluencerService.listAll(page, limit, status);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * GET /backoffice/influencers/:id
   * Get influencer details (admin)
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { Influencer } = await import('./influencer.model');
      const influencer = await Influencer.findById(req.params.id);
      if (!influencer) return res.status(404).json({ status: 'failed', message: 'Influencer not found' });
      return res.status(200).json({ status: 'success', data: influencer });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/approve
   * Approve influencer (admin)
   */
  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any).user._id || (req as any).user.id;
      const result = await InfluencerService.approve(req.params.id, adminId);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  /**
   * POST /backoffice/influencers/:id/reject
   * Reject influencer (admin)
   */
  static async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = (req as any).user._id || (req as any).user.id;
      const { reason } = req.body;
      const result = await InfluencerService.reject(req.params.id, adminId, reason);
      return res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }
}
