import { Router, Request, Response, NextFunction } from 'express';
import { KYCService } from './kyc.service';
import verifyJwt from '../../shared/middlewares/verifyJwt';
import pino from 'pino';
import { User } from './user.interface';

const router = Router();
const logger = pino({ name: 'kyc-controller' });

/**
 * Helper type-safe access
 */
type AuthRequest = Request & {
  user?: User;
  admin?: User;
};

/**
 * GET /api/kyc/current-tier
 */
router.get(
  '/current-tier',
  verifyJwt,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: 'Unauthorized' });
      }

      const tierInfo = await KYCService.getCurrentTier(String(userId));

      return res.json({
        success: true,
        data: tierInfo,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to get current tier');
      return res
        .status(500)
        .json({ success: false, message: err.message });
    }
  }
);

/**
 * POST /api/kyc/submit-upgrade
 */
router.post(
  '/submit-upgrade',
  verifyJwt,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: 'Unauthorized' });
      }

      const { targetTier, documents, address, phoneNumber } = req.body;

      if (!targetTier || ![2, 3].includes(targetTier)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid target tier. Must be 2 or 3.',
        });
      }

      if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one document is required',
        });
      }

      const result = await KYCService.submitUpgradeRequest({
        userId: String(userId),
        targetTier,
        documents,
        address,
        phoneNumber,
      });

      return res.json({
        success: true,
        message: 'Upgrade request submitted successfully',
        data: result,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to submit upgrade request');
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/**
 * GET /api/kyc/upgrade-status
 */
router.get(
  '/upgrade-status',
  verifyJwt,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: 'Unauthorized' });
      }

      const { requestId } = req.query;

      const status = await KYCService.getUpgradeStatus(
        String(userId),
        requestId as string
      );

      return res.json({
        success: true,
        data: status,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to get upgrade status');
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/**
 * ADMIN - GET pending upgrades
 */
router.get(
  '/admin/pending-upgrades',
  verifyJwt,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20 } = req.query;

      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;
      const skip = (pageNum - 1) * limitNum;

      const { KYCUpgradeRequest } = require('./kyc.model');

      const [requests, total] = await Promise.all([
        KYCUpgradeRequest.find({ status: 'pending' })
          .populate('userId', 'username email user_metadata')
          .sort({ submittedAt: -1 })
          .skip(skip)
          .limit(limitNum),
        KYCUpgradeRequest.countDocuments({ status: 'pending' }),
      ]);

      return res.json({
        success: true,
        data: {
          requests,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            pages: Math.ceil(total / limitNum),
          },
        },
      });
    } catch (err: any) {
      logger.error(
        { error: err.message },
        'Failed to fetch pending upgrades'
      );
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/**
 * ADMIN - approve
 */
router.post(
  '/admin/approve/:requestId',
  verifyJwt,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { requestId } = req.params;
      const adminId = req.admin?._id;

      if (!adminId) {
        return res
          .status(401)
          .json({ success: false, message: 'Unauthorized' });
      }

      const result = await KYCService.approveUpgrade(requestId, String(adminId));

      return res.json({
        success: true,
        message: 'Tier upgrade approved successfully',
        data: result,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to approve upgrade');
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

/**
 * ADMIN - reject
 */
router.post(
  '/admin/reject/:requestId',
  verifyJwt,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { requestId } = req.params;
      const { reason } = req.body;
      const adminId = req.admin?._id;

      if (!adminId) {
        return res
          .status(401)
          .json({ success: false, message: 'Unauthorized' });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required',
        });
      }

      const result = await KYCService.rejectUpgrade(
        requestId,
        String(adminId),
        reason
      );

      return res.json({
        success: true,
        message: 'Tier upgrade rejected',
        data: result,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to reject upgrade');
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
  }
);

export default router;