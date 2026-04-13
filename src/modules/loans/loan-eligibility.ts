/**
 * Loan Eligibility Domain Service
 * Determines loan eligibility based on ladder, credit score, and business rules
 */
import { ILoanLadder, LoanLadder } from './loan-ladder.model';
import { User } from '../users/user.interface';
import Loan from './loan.model';
import { SettingsService } from "../admin/settings.service";

export interface EligibilityResult {
  eligible: boolean;
  maxAmount: number; // in kobo
  reason?: string;
  creditScore?: number;
  notifyAdmin: boolean;
  ladderIndex?: number;
}

export class LoanEligibilityService {
  /**
   * Calculate loan eligibility for a user
   */
  static async calculateEligibility(
    user: User,
    requestedAmount: number,
  ): Promise<EligibilityResult> {
    // Check for active loans
    // Note: This would need to query the loan service in real implementation
    const hasActiveLoan = await Loan.find({
      userId: user._id,
      loan_payment_status: { $in: ["in-progress", "not-started"] },
      status: { $in: ["accepted", "active"] }
    });

    if (hasActiveLoan && hasActiveLoan.length > 0) {
      return {
        eligible: false,
        maxAmount: 0,
        notifyAdmin: false,
        reason: 'User has active loan'
      };
    }

    const settings = await SettingsService.getSettings();

    // Collateral Check (Optimization)
    // If user has enough savings, they are eligible regardless of credit score (within ladder limits)
    const collateralPercentage = settings.loan.collateral.percentage || 0.5; // Default 50%
    const userSavings = user.user_metadata?.stats?.totalSavings || 0;

    // Check Ladder Limit first
    // Get user's ladder index (default to 0 for new users)
    const ladderIndex = user.user_metadata?.ladderIndex && user.user_metadata.ladderIndex > 0 ? user.user_metadata.ladderIndex : 1;
    let ladderSteps = await LoanLadder.find().sort({ step: 1 });
    // Fallback if no ladder steps defined

    let allowedAmountByLadder = 0;
    if (ladderSteps.length > 0) {
      if (ladderIndex > ladderSteps.length) {
        // Exceeds defined steps -> Manual Approval / Max of last step
        allowedAmountByLadder = ladderSteps[ladderSteps.length - 1].amount;
        // Or maybe we flag for manual review? Existing logic says "notifyAdmin: true"
      } else {
        allowedAmountByLadder = ladderSteps.find(ls => ls.step === ladderIndex)?.amount || 0;
      }
    } else {
      allowedAmountByLadder = 0; // Or some default
    }

    // --- Savings-Based Loan Override ---
    // If the user's savable-borrowing capacity exceeds their ladder position,
    // the savings-based amount becomes their effective max
    const borrowableFromSavings = userSavings * (collateralPercentage / 100);
    const effectiveMax = Math.max(allowedAmountByLadder, borrowableFromSavings);

    if (requestedAmount > effectiveMax && effectiveMax > 0) {
      return {
        eligible: false,
        maxAmount: effectiveMax,
        notifyAdmin: false,
        reason: `Requested amount exceeds your current loan limit of ₦${effectiveMax.toLocaleString()}. ${borrowableFromSavings > allowedAmountByLadder
            ? 'Increase your savings to raise your limit.'
            : 'Repay successfully to increase limit.'
          }`
      };
    }

    // Collateral Check
    const requiredCollateral = requestedAmount * collateralPercentage;
    const hasSufficientCollateral = userSavings >= requiredCollateral;

    const creditScore = user.user_metadata.creditScore || 1;

    if (hasSufficientCollateral) {
      // Collateral Override: Approved even if score is low (but not negative/blacklisted if that existed)
      return {
        eligible: true,
        maxAmount: requestedAmount, // Or allowedAmountByLadder
        notifyAdmin: false,
        creditScore,
        ladderIndex,
        reason: "Eligibility based on sufficient collateral"
      };
    }

    // Default Credit Score Check
    if (creditScore < (settings.loan.minCreditScore || 0.4)) {
      return {
        eligible: false,
        maxAmount: 0, // No valid offer if score low and no collateral
        notifyAdmin: false,
        reason: 'Credit score too low and insufficient collateral.'
      };
    }

    // Manual Review Trigger for High Amounts (Optimization)
    if (requestedAmount > (settings.loan.autoApprovalLimit || 50000)) {
      return {
        eligible: true,
        maxAmount: requestedAmount,
        notifyAdmin: true,
        creditScore,
        ladderIndex,
        reason: "High value loan requires manual approval"
      };
    }

    return {
      eligible: true,
      maxAmount: allowedAmountByLadder,
      notifyAdmin: false,
      creditScore,
      ladderIndex
    };
  }
}