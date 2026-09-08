/**
 * KYC Service - VFD Account Tier Upgrade System
 *
 * Flow (production):
 *  1. User submits documents (base64) + BVN/NIN/address for a target tier.
 *     Documents are stored in Cloudinary; a local KYCUpgradeRequest(pending)
 *     is created. NO fatal external call - VFD's KYC document API is not
 *     available on our BaaS plan, so a VFD hiccup must never block the request.
 *  2. Admin reviews the request + documents, then approves or rejects.
 *  3. On approve: we attempt the real VFD tier move (`/client/tiers/individual`
 *     with BVN+NIN+address - the same endpoint that creates Tier-3 accounts at
 *     signup), persist the new tier on the user, and email them. The VFD call
 *     is best-effort: the tier is authoritative locally (it drives our own
 *     limits) and the admin can retry the VFD sync.
 */
import { KYCUpgradeRequest } from './kyc.model';
import { VfdProvider } from '../../shared/providers/vfd.provider';
import { NotificationService } from '../notifications/notification.service';
import cloudinary from '../../config/cloudinary';
import User from './user.model';
import { NotFoundError, BadRequestError } from '../../exceptions';
import pino from 'pino';

const logger = pino({ name: 'kyc-service' });

export interface KYCDocumentUploadParams {
  documentType: 'NIN' | 'DRIVER_LICENSE' | 'PASSPORT' | 'BVN' | 'UTILITY_BILL' | 'ID_CARD';
  base64Document: string;
  documentNumber?: string;
}

export interface TierUpgradeRequestParams {
  userId: string;
  targetTier: number; // 2 or 3
  documents: KYCDocumentUploadParams[];
  address?: string;
  phoneNumber?: string;
  bvn?: string;
  nin?: string;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

export class KYCService {
  private static vfdProvider = new VfdProvider();

  /* ─────────────────────────────────────────────
   * Current tier + KYC status
   * ───────────────────────────────────────────── */

  static async getCurrentTier(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const accountNo = user.user_metadata?.accountNo;
    // Local tier is authoritative for OUR limits. A flaky VFD call must never
    // silently drop a user back to Tier 1.
    let currentTier = Number((user.user_metadata as any)?.vfdTier) || 1;
    let vfdKycStatus: any = null;

    if (accountNo) {
      try {
        const [tierRes, kycRes] = await Promise.allSettled([
          withTimeout(this.vfdProvider.getAccountTier(accountNo), 4000),
          withTimeout(this.vfdProvider.getKYCStatus(accountNo), 4000),
        ]);
        const vfdTier = Number(
          (tierRes.status === 'fulfilled' && (tierRes.value as any)?.data?.currentTier) ||
          (kycRes.status === 'fulfilled' && (kycRes.value as any)?.data?.currentTier) ||
          0
        );
        if (vfdTier > currentTier) currentTier = vfdTier; // only ever upgrade
        if (kycRes.status === 'fulfilled') vfdKycStatus = (kycRes.value as any)?.data ?? null;
      } catch {
        /* best effort */
      }
    }

    const pendingRequest = await KYCUpgradeRequest.findOne({ userId, status: 'pending' }).sort({ submittedAt: -1 });

    return {
      accountNo,
      currentTier,
      tierLimits: this.getTierLimits(currentTier),
      vfdKycStatus: vfdKycStatus?.kycStatus ?? (currentTier >= 3 ? 'verified' : 'unknown'),
      vfdDocuments: vfdKycStatus?.documents ?? [],
      pendingUpgrade: pendingRequest
        ? {
          requestId: pendingRequest._id,
          requestedTier: pendingRequest.requestedTier,
          status: pendingRequest.status,
          submittedAt: pendingRequest.submittedAt,
        }
        : null,
      status: accountNo ? 'active' : 'no_account',
    };
  }

  /** Admin-facing: current tier + user identity + the latest request's documents. */
  static async getKYCStatusForAdmin(userId: string) {
    const tierInfo = await this.getCurrentTier(userId);
    const user = await User.findById(userId).select(
      'email user_metadata.first_name user_metadata.surname user_metadata.phone user_metadata.accountNo user_metadata.bvn user_metadata.nin'
    );
    const latest = await KYCUpgradeRequest.findOne({ userId }).sort({ submittedAt: -1 });

    return {
      ...tierInfo,
      documents: latest?.documents ?? [],
      latestRequest: latest
        ? {
          requestId: latest._id,
          requestedTier: latest.requestedTier,
          status: latest.status,
          submittedAt: latest.submittedAt,
          rejectionReason: latest.rejectionReason,
        }
        : null,
      user: user
        ? {
          email: user.email,
          firstName: user.user_metadata?.first_name,
          surname: user.user_metadata?.surname,
          phone: user.user_metadata?.phone,
          accountNo: user.user_metadata?.accountNo,
          bvn: user.user_metadata?.bvn ? `***${String(user.user_metadata.bvn).slice(-4)}` : null,
          nin: user.user_metadata?.nin ? `***${String(user.user_metadata.nin).slice(-4)}` : null,
        }
        : null,
    };
  }

  /* ─────────────────────────────────────────────
   * Submit upgrade request
   * ───────────────────────────────────────────── */

  static async submitUpgradeRequest(params: TierUpgradeRequestParams) {
    const user = await User.findById(params.userId);
    if (!user) throw new NotFoundError('User not found');

    const accountNo = user.user_metadata?.accountNo;
    if (!accountNo) throw new BadRequestError('Your account is still being set up. Please try again shortly.');

    if (![2, 3].includes(params.targetTier)) throw new BadRequestError('Target tier must be 2 or 3');

    const tierInfo = await this.getCurrentTier(params.userId);
    if (tierInfo.currentTier >= params.targetTier) {
      throw new BadRequestError(`Your account is already at tier ${tierInfo.currentTier}.`);
    }

    if (!params.documents?.length) throw new BadRequestError('At least one document is required');

    const existing = await KYCUpgradeRequest.findOne({ userId: params.userId, status: 'pending' });
    if (existing) throw new BadRequestError('You already have a pending upgrade request under review.');

    // Store each document in Cloudinary (accepts a data: URI directly).
    const documents: any[] = [];
    for (const doc of params.documents) {
      try {
        const payload = doc.base64Document.startsWith('data:')
          ? doc.base64Document
          : `data:image/jpeg;base64,${doc.base64Document}`;
        const uploaded = await cloudinary.uploader.upload(payload, {
          folder: `prime-finance/kyc/${params.userId}`,
          resource_type: 'image',
        });
        documents.push({
          type: doc.documentType,
          reference: uploaded.public_id,
          url: uploaded.secure_url,
          number: doc.documentNumber,
          status: 'uploaded',
          uploadedAt: new Date(),
        });
      } catch (err: any) {
        logger.error({ userId: params.userId, docType: doc.documentType, err: err.message }, 'KYC document upload failed');
        throw new BadRequestError(`Could not upload your ${doc.documentType.replace('_', ' ').toLowerCase()}. Please try a clearer photo.`);
      }
    }

    // The user may supply BVN / NIN as a typed document number in the docs list.
    const docNumber = (t: string) => params.documents.find((d) => d.documentType === t && d.documentNumber)?.documentNumber;
    const bvn = params.bvn || docNumber('BVN') || user.user_metadata?.bvn;
    const nin = params.nin || docNumber('NIN') || user.user_metadata?.nin;
    const address = params.address || user.user_metadata?.address;

    const request = await KYCUpgradeRequest.create({
      userId: params.userId,
      currentTier: tierInfo.currentTier,
      requestedTier: params.targetTier,
      status: 'pending',
      documents,
      address,
      phone: params.phoneNumber || user.user_metadata?.phone,
      bvn,
      nin,
      submittedAt: new Date(),
      meta: { accountNo },
    });

    // Keep any freshly supplied BVN/NIN/address on the profile so the approval
    // step has what it needs for the VFD call.
    let dirty = false;
    if (params.bvn && !user.user_metadata?.bvn) { (user.user_metadata as any).bvn = params.bvn; dirty = true; }
    if (params.nin && !user.user_metadata?.nin) { (user.user_metadata as any).nin = params.nin; dirty = true; }
    if (params.address && !user.user_metadata?.address) { (user.user_metadata as any).address = params.address; dirty = true; }
    if (dirty) await user.save();

    try {
      await NotificationService.sendKycSubmitted(user as any, params.targetTier);
    } catch (err: any) {
      logger.warn({ userId: params.userId, err: err.message }, 'KYC submitted email failed (non-fatal)');
    }
    logger.info({ userId: params.userId, targetTier: params.targetTier, requestId: request._id }, 'KYC upgrade request submitted');

    return {
      requestId: request._id,
      status: 'pending',
      currentTier: tierInfo.currentTier,
      requestedTier: params.targetTier,
      message: 'Upgrade request submitted. Your documents are under review - this usually takes a few hours.',
    };
  }

  /* ─────────────────────────────────────────────
   * User: upgrade status
   * ───────────────────────────────────────────── */

  static async getUpgradeStatus(userId: string, requestId?: string) {
    const query: any = { userId };
    if (requestId) query._id = requestId;
    const requests = await KYCUpgradeRequest.find(query).sort({ submittedAt: -1 }).limit(10);
    if (!requests.length) return { requests: [], latestStatus: null, message: 'No upgrade requests found' };

    return {
      requests: requests.map((r) => ({
        requestId: r._id,
        currentTier: r.currentTier,
        requestedTier: r.requestedTier,
        status: r.status,
        submittedAt: r.submittedAt,
        approvedAt: r.approvedAt,
        rejectionReason: r.rejectionReason,
        documents: r.documents.map((d) => ({ type: d.type, status: d.status })),
      })),
      latestStatus: requests[0].status,
    };
  }

  /* ─────────────────────────────────────────────
   * Admin: list, approve, reject
   * ───────────────────────────────────────────── */

  static async listRequests(opts: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(100, Number(opts.limit) || 20);
    const filter: any = {};
    if (opts.status && opts.status !== 'all') filter.status = opts.status;

    const [rows, total] = await Promise.all([
      KYCUpgradeRequest.find(filter).sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      KYCUpgradeRequest.countDocuments(filter),
    ]);

    const userIds = [...new Set(rows.map((r) => String(r.userId)))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('email user_metadata.first_name user_metadata.surname user_metadata.phone user_metadata.accountNo')
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    return {
      requests: rows.map((r) => {
        const u = byId.get(String(r.userId));
        // Shaped like a populated `userId` so the admin UI (built for
        // .populate('userId', ...)) keeps working, with a flat `user` too.
        const userObj = u
          ? {
            _id: u._id,
            email: u.email,
            user_metadata: {
              first_name: u.user_metadata?.first_name,
              surname: u.user_metadata?.surname,
              phone: u.user_metadata?.phone,
              accountNo: u.user_metadata?.accountNo,
            },
          }
          : { _id: r.userId };
        return {
          _id: r._id,
          userId: userObj,
          currentTier: r.currentTier,
          requestedTier: r.requestedTier,
          status: r.status,
          submittedAt: r.submittedAt,
          approvedAt: (r as any).approvedAt,
          rejectedAt: (r as any).rejectedAt,
          rejectionReason: r.rejectionReason,
          address: r.address,
          phone: r.phone,
          documents: r.documents,
          meta: r.meta,
          user: userObj,
        };
      }),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  static async approveUpgrade(requestId: string, adminId: string) {
    const request = await KYCUpgradeRequest.findById(requestId);
    if (!request) throw new NotFoundError('Upgrade request not found');
    if (request.status !== 'pending') throw new BadRequestError(`Request is already ${request.status}`);

    const user = await User.findById(request.userId);
    if (!user) throw new NotFoundError('User not found');

    const accountNo = user.user_metadata?.accountNo || request.meta?.accountNo;
    const bvn = request.bvn || user.user_metadata?.bvn;
    const nin = request.nin || user.user_metadata?.nin;
    const address = request.address || user.user_metadata?.address;
    const dob = user.user_metadata?.dateOfBirth;

    // Best-effort real VFD move. `/client/tiers/individual` (BVN+NIN+address) is
    // the endpoint VFD documents for placing an account at Tier 3.
    let vfdSync: any = { attempted: false };
    if (request.requestedTier === 3 && bvn && nin && address && dob) {
      vfdSync = { attempted: true };
      try {
        const res: any = await withTimeout(
          this.vfdProvider.createClientWithBVNNIN({ bvn, nin, address, dateOfBirth: dob }),
          20000
        );
        vfdSync.ok = String(res?.status) === '00' || !!res?.data?.accountNo;
        vfdSync.response = res?.message || res?.status;
      } catch (err: any) {
        vfdSync.ok = false;
        vfdSync.error = err?.message;
        logger.warn({ requestId, accountNo, err: err?.message }, 'VFD tier upgrade sync failed - approving locally, admin can retry');
      }
    }

    request.status = 'approved';
    request.approvedAt = new Date();
    request.approvedBy = adminId as any;
    request.meta = { ...(request.meta || {}), accountNo, vfdSync };
    request.markModified('meta');
    await request.save();

    (user.user_metadata as any).vfdTier = request.requestedTier;
    if (bvn && !user.user_metadata?.bvn) (user.user_metadata as any).bvn = bvn;
    if (nin && !user.user_metadata?.nin) (user.user_metadata as any).nin = nin;
    await user.save();

    try {
      await NotificationService.sendKycApproved(user as any, request.requestedTier);
    } catch (err: any) {
      logger.warn({ requestId, err: err.message }, 'KYC approval email failed (non-fatal)');
    }

    logger.info({ requestId, adminId, userId: request.userId, newTier: request.requestedTier, vfdSync }, 'Tier upgrade approved');
    return { ...request.toObject(), vfdSync };
  }

  static async rejectUpgrade(requestId: string, adminId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestError('A rejection reason is required');
    const request = await KYCUpgradeRequest.findById(requestId);
    if (!request) throw new NotFoundError('Upgrade request not found');
    if (request.status !== 'pending') throw new BadRequestError(`Request is already ${request.status}`);

    request.status = 'rejected';
    request.rejectionReason = reason;
    (request as any).rejectedAt = new Date();
    (request as any).rejectedBy = adminId as any;
    await request.save();

    try {
      const user = await User.findById(request.userId);
      if (user) await NotificationService.sendKycRejected(user as any, reason);
    } catch (err: any) {
      logger.warn({ requestId, err: err.message }, 'KYC rejection email failed (non-fatal)');
    }

    logger.info({ requestId, adminId, userId: request.userId, reason }, 'Tier upgrade rejected');
    return request;
  }

  /* ─────────────────────────────────────────────
   * Helpers
   * ───────────────────────────────────────────── */

  static getTierLimits(tier: number) {
    const tierLimits: Record<number, any> = {
      1: {
        dailyTransferLimit: 50_000,
        monthlyTransferLimit: 500_000,
        maxSavingsAmount: 100_000,
        maxLoanAmount: 50_000,
        description: 'Basic account — NIN only',
        features: ['transfers', 'bill_payments', 'savings'],
      },
      2: {
        dailyTransferLimit: 500_000,
        monthlyTransferLimit: 5_000_000,
        maxSavingsAmount: 1_000_000,
        maxLoanAmount: 500_000,
        description: 'Standard account — BVN verified',
        features: ['transfers', 'bill_payments', 'savings', 'escrow'],
      },
      3: {
        dailyTransferLimit: 5_000_000,
        monthlyTransferLimit: 50_000_000,
        maxSavingsAmount: 10_000_000,
        maxLoanAmount: 5_000_000,
        description: 'Premium account — BVN + NIN verified',
        features: ['transfers', 'bill_payments', 'savings', 'escrow', 'marketplace'],
      },
    };
    return tierLimits[tier] || tierLimits[1];
  }
}
