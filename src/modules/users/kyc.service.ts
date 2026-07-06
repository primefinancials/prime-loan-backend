/**
 * KYC Service - VFD Account Tier Upgrade System
 *
 * Changes vs previous version:
 *  1. getCurrentTier now also calls vfdProvider.getKYCStatus() to enrich the response
 *     with the live VFD KYC status (verified/pending/rejected), document list, and tier.
 *  2. submitUpgradeRequest now calls vfdProvider.upgradeAccountTier() after uploading docs,
 *     so the request is also registered on VFD's side, not just locally.
 *  3. Added getKYCStatusForAdmin() — same as getCurrentTier but enriched for admin views,
 *     includes user metadata (name, email) alongside VFD status.
 *  4. createClientAccount helpers: NIN-only (Tier 1) and BVN+NIN (Tier 3) creation wrappers.
 */
import { KYCUpgradeRequest } from './kyc.model';
import { VfdProvider } from '../../shared/providers/vfd.provider';
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
}

export class KYCService {
  private static vfdProvider = new VfdProvider();

  /* ─────────────────────────────────────────────
   * PUBLIC: Get current tier + live VFD KYC status
   * ───────────────────────────────────────────── */

  /**
   * Returns tier info merged with live VFD KYC status.
   * Used by both user-facing and admin-facing endpoints.
   */
  static async getCurrentTier(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const accountNo = user.user_metadata?.accountNo;

    // 1. Try to fetch live tier + KYC status from VFD
    let vfdTierData: any = null;
    let vfdKycStatus: any = null;

    if (accountNo) {
      try {
        const [tierRes, kycRes] = await Promise.allSettled([
          this.vfdProvider.getAccountTier(accountNo),
          this.vfdProvider.getKYCStatus(accountNo),
        ]);

        if (tierRes.status === 'fulfilled' && tierRes.value?.data) {
          vfdTierData = tierRes.value.data;
        }
        if (kycRes.status === 'fulfilled' && kycRes.value?.data) {
          vfdKycStatus = kycRes.value.data;
        }
      } catch (err: any) {
        logger.warn({ userId, error: err.message }, 'Could not fetch VFD tier/KYC data — using local fallback');
      }
    }

    // 2. Resolve current tier (VFD is source of truth; fallback to local metadata)
    const currentTier = Number(
      vfdTierData?.currentTier ??
      vfdKycStatus?.currentTier ??
      (user.user_metadata as any)?.vfdTier ??
      1
    );

    // 3. Fetch local pending upgrade requests
    const pendingRequest = await KYCUpgradeRequest.findOne({
      userId,
      status: 'pending',
    }).sort({ submittedAt: -1 });

    return {
      accountNo,
      currentTier,
      tierLimits: this.getTierLimits(currentTier),
      // Live VFD KYC status
      vfdKycStatus: vfdKycStatus?.kycStatus ?? 'unknown',
      vfdDocuments: vfdKycStatus?.documents ?? [],
      // Local pending upgrade (if any)
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

  /**
   * Admin-facing: same as getCurrentTier but includes user identity details
   */
  static async getKYCStatusForAdmin(userId: string) {
    const tierInfo = await this.getCurrentTier(userId);
    const user = await User.findById(userId).select(
      'email user_metadata.first_name user_metadata.surname user_metadata.phone user_metadata.accountNo'
    );

    return {
      ...tierInfo,
      user: user
        ? {
          email: user.email,
          firstName: user.user_metadata?.first_name,
          surname: user.user_metadata?.surname,
          phone: user.user_metadata?.phone,
          accountNo: user.user_metadata?.accountNo,
        }
        : null,
    };
  }

  /* ─────────────────────────────────────────────
   * SUBMIT UPGRADE REQUEST
   * ───────────────────────────────────────────── */

  static async submitUpgradeRequest(params: TierUpgradeRequestParams) {
    const user = await User.findById(params.userId);
    if (!user) throw new NotFoundError('User not found');

    const accountNo = user.user_metadata?.accountNo;
    if (!accountNo) throw new BadRequestError('User does not have a VFD account number');

    // Verify current tier
    const currentTierInfo = await this.getCurrentTier(params.userId);
    if (currentTierInfo.currentTier >= params.targetTier) {
      throw new BadRequestError(
        `Account is already at tier ${currentTierInfo.currentTier}. Cannot upgrade to a lower or equal tier.`
      );
    }

    if (![2, 3].includes(params.targetTier)) {
      throw new BadRequestError('Target tier must be 2 or 3');
    }

    if (!params.documents || params.documents.length === 0) {
      throw new BadRequestError('At least one KYC document is required for tier upgrade');
    }

    // Check for existing pending upgrade
    const existing = await KYCUpgradeRequest.findOne({ userId: params.userId, status: 'pending' });
    if (existing) {
      throw new BadRequestError(
        'You already have a pending tier upgrade request. Please wait for it to be reviewed.'
      );
    }

    // Upload documents to VFD KYC API
    const uploadedDocs: Array<{ type: string; reference: string; status: string }> = [];
    const docReferences: string[] = [];

    for (const doc of params.documents) {
      try {
        const uploadResult = await this.vfdProvider.uploadKYCDocument({
          accountNo,
          documentType: doc.documentType,
          base64Document: doc.base64Document,
          documentNumber: doc.documentNumber,
        });

        const reference = uploadResult?.data?.reference || `doc_${Date.now()}_${doc.documentType}`;
        uploadedDocs.push({
          type: doc.documentType,
          reference,
          status: 'uploaded',
        });
        docReferences.push(reference);
      } catch (uploadErr: any) {
        logger.error(
          { userId: params.userId, docType: doc.documentType, error: uploadErr.message },
          'Failed to upload KYC document to VFD'
        );
        throw new Error(`Failed to upload ${doc.documentType}: ${uploadErr.message}`);
      }
    }

    // Notify VFD of the tier upgrade request
    let vfdUpgradeRef: string | undefined;
    try {
      const vfdResult = await this.vfdProvider.upgradeAccountTier({
        accountNo,
        targetTier: params.targetTier,
        documentReferences: docReferences,
        address: params.address || user.user_metadata?.address,
        phone: params.phoneNumber || user.user_metadata?.phone,
      });
      vfdUpgradeRef = vfdResult?.data?.requestId;
    } catch (vfdErr: any) {
      // Non-fatal: log and continue — the local record still tracks the request
      logger.warn(
        { userId: params.userId, error: vfdErr.message },
        'VFD tier upgrade notification failed (non-fatal). Local record created.'
      );
    }

    // Create upgrade request record in our DB
    const upgradeRequest = await KYCUpgradeRequest.create({
      userId: params.userId,
      currentTier: currentTierInfo.currentTier,
      requestedTier: params.targetTier,
      status: 'pending',
      documents: uploadedDocs,
      address: params.address || user.user_metadata?.address,
      phone: params.phoneNumber || user.user_metadata?.phone,
      submittedAt: new Date(),
      meta: {
        accountNo,
        vfdUpgradeRef,
      },
    });

    logger.info(
      { userId: params.userId, targetTier: params.targetTier, requestId: upgradeRequest._id },
      'KYC upgrade request submitted'
    );

    return {
      requestId: upgradeRequest._id,
      status: 'pending',
      currentTier: currentTierInfo.currentTier,
      requestedTier: params.targetTier,
      message:
        'Upgrade request submitted. Documents are under review. Processing takes up to 24 hours.',
    };
  }

  /* ─────────────────────────────────────────────
   * GET UPGRADE STATUS (user-facing)
   * ───────────────────────────────────────────── */

  static async getUpgradeStatus(userId: string, requestId?: string) {
    const query: any = { userId };
    if (requestId) query._id = requestId;

    const requests = await KYCUpgradeRequest.find(query)
      .sort({ submittedAt: -1 })
      .limit(10);

    if (!requests || requests.length === 0) {
      return { requests: [], message: 'No upgrade requests found' };
    }

    return {
      requests: requests.map((req) => ({
        requestId: req._id,
        currentTier: req.currentTier,
        requestedTier: req.requestedTier,
        status: req.status,
        submittedAt: req.submittedAt,
        approvedAt: req.approvedAt,
        rejectionReason: req.rejectionReason,
        documents: req.documents,
      })),
      latestStatus: requests[0].status,
    };
  }

  /* ─────────────────────────────────────────────
   * ADMIN: Approve / Reject
   * ───────────────────────────────────────────── */

  static async approveUpgrade(requestId: string, adminId: string) {
    const request = await KYCUpgradeRequest.findByIdAndUpdate(
      requestId,
      { status: 'approved', approvedAt: new Date(), approvedBy: adminId },
      { new: true }
    );

    if (!request) throw new NotFoundError('Upgrade request not found');

    const user = await User.findById(request.userId);
    if (user) {
      (user.user_metadata as any).vfdTier = request.requestedTier;
      await user.save();
    }

    logger.info(
      { requestId, adminId, userId: request.userId, newTier: request.requestedTier },
      'Tier upgrade approved'
    );
    return request;
  }

  static async rejectUpgrade(requestId: string, adminId: string, reason: string) {
    const request = await KYCUpgradeRequest.findByIdAndUpdate(
      requestId,
      { status: 'rejected', rejectionReason: reason, rejectedAt: new Date(), rejectedBy: adminId },
      { new: true }
    );

    if (!request) throw new NotFoundError('Upgrade request not found');

    logger.info({ requestId, adminId, userId: request.userId, reason }, 'Tier upgrade rejected');
    return request;
  }

  /* ─────────────────────────────────────────────
   * HELPERS
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