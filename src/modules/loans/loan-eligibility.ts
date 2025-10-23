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

    if (requestedAmount > settings.maxLoanAmount) {
      return {
        eligible: false,
        reason: "Requested amount exceeds maximum limit set by admin",
        notifyAdmin: true,
        maxAmount: settings.maxLoanAmount,
      };
    }

    // Get user's ladder index (default to 0 for new users)
    const ladderIndex = user.user_metadata?.ladderIndex && user.user_metadata.ladderIndex > 0?  user.user_metadata.ladderIndex : 1;
    
    // Use custom ladder or default system ladder
    let ladderSteps = await LoanLadder.find();
    
    if (ladderIndex >= ladderSteps.length) {
      return {
        eligible: true,
        maxAmount: 0,
        notifyAdmin: true,
        reason: 'Loan Need to be approved manually'
      };
    }

    let maxAmount = ladderSteps.find(ls => ls.step == ladderIndex)?.amount || 0;
    
    // Apply credit score adjustments (placeholder logic)
    const creditScore = user.user_metadata.creditScore || 1;
    
    if (creditScore < 0.4) {
      return {
        eligible: false,
        maxAmount: 0,
        notifyAdmin: false,
        reason: 'Your credit score is too low, you defaulted for too long. Try again after 5 days'
      };
    }

    return {
      eligible: true,
      maxAmount,
      notifyAdmin: false,
      creditScore,
      ladderIndex
    };
  }
}