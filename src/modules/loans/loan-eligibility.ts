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
  maxAmount: number; // in Naira
  reason?: string;
  creditScore?: number;
  notifyAdmin: boolean;
  ladderIndex?: number;
}

export class LoanEligibilityService {
  /**
   * Calculate maximum borrowable amount for a user based on ladder and savings
   */
  static async getMaxBorrowableAmount(user: User): Promise<{
    maxAmount: number;
    savingsBasedMax: number;
    ladderMax: number;
    ladderIndex: number;
  }> {
    const settings = await SettingsService.getSettings();
    const collateralPercentage = settings.loan?.collateral?.percentage ?? 50;

    // Use only ACTIVE FLEXIBLE savings
    const { SavingsPlan } = await import('../savings/savings.plan.model');
    const flexibleSavingsAgg = await SavingsPlan.aggregate([
      { $match: { userId: String(user._id), status: 'ACTIVE', planType: 'FLEXIBLE' } },
      { $group: { _id: null, total: { $sum: '$principal' } } }
    ]);
    const flexibleSavingsTotal = flexibleSavingsAgg[0]?.total || 0; // The database value is in Naira
    const borrowableFromSavings = flexibleSavingsTotal * (collateralPercentage / 100);

    const ladderIndex = user.user_metadata?.ladderIndex && user.user_metadata.ladderIndex > 0 ? user.user_metadata.ladderIndex : 1;
    const ladderSteps = await LoanLadder.find().sort({ step: 1 });
    let allowedAmountByLadder = 0;
    
    if (ladderSteps.length > 0) {
      if (ladderIndex > ladderSteps.length) {
        allowedAmountByLadder = ladderSteps[ladderSteps.length - 1].amount;
      } else {
        allowedAmountByLadder = ladderSteps.find(ls => ls.step === ladderIndex)?.amount || 0;
      }
    }

    return {
      maxAmount: Math.max(allowedAmountByLadder, borrowableFromSavings),
      savingsBasedMax: borrowableFromSavings,
      ladderMax: allowedAmountByLadder,
      ladderIndex
    };
  }

  /**
   * Calculate loan eligibility for a user
   */
  static async calculateEligibility(
    user: User,
    requestedAmount: number,
  ): Promise<EligibilityResult> {
    const settings = await SettingsService.getSettings();

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

    const capacities = await this.getMaxBorrowableAmount(user);
    const borrowableFromSavings = capacities.savingsBasedMax;
    const allowedAmountByLadder = capacities.ladderMax;
    const effectiveMax = capacities.maxAmount;
    const ladderIndex = capacities.ladderIndex;

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
    // Since borrowableFromSavings already computes the max borrowable based on percentage, 
    // we can check if the requestedAmount is less than or equal to borrowableFromSavings.
    const hasSufficientCollateral = requestedAmount <= borrowableFromSavings;

    const creditScore = user.user_metadata.creditScore || 1;

    if (hasSufficientCollateral) {
      // Collateral Override: Approved even if score is low (but not negative/blacklisted if that existed)
      return {
        eligible: true,
        maxAmount: effectiveMax, // Return effectiveMax instead of requestedAmount so UI knows full capacity
        notifyAdmin: false,
        creditScore,
        ladderIndex,
        reason: "Eligibility based on sufficient collateral"
      };
    }

    // Default Credit Score Check
    if (creditScore < (settings.loan?.minCreditScore || 0.4)) {
      return {
        eligible: false,
        maxAmount: 0, // No valid offer if score low and no collateral
        notifyAdmin: false,
        reason: 'Credit score too low and insufficient collateral.'
      };
    }

    // Manual Review Trigger for High Amounts (Optimization)
    if (requestedAmount > (settings.loan?.autoApprovalLimit || 50000)) {
      return {
        eligible: true,
        maxAmount: effectiveMax,
        notifyAdmin: true,
        creditScore,
        ladderIndex,
        reason: "High value loan requires manual approval"
      };
    }

    return {
      eligible: true,
      maxAmount: effectiveMax,
      notifyAdmin: false,
      creditScore,
      ladderIndex
    };
  }
}