import { Settings, ISettings } from "./settings.model";
import { NotFoundError, BadRequestError } from "../../exceptions";

/**
 * SettingsService
 *
 * Responsible for managing platform-wide configuration and profit logic.
 * Implements singleton document pattern (one global settings document).
 */
export class SettingsService {
  /**
   * Get or initialize the singleton system settings document.
   * Always returns the same document (auto-creates if missing).
   */
  static async getSettings(): Promise<ISettings> {
    let settings = await Settings.findOne({ singleton: "singleton" });

    if (!settings) {
      settings = await Settings.create({
        singleton: "singleton",
        updatedBy: "system",
        // Ensure defaults are populated from schema
        savings: {
          fixed: {
            minDuration: 30,
            interestRate: 10,
            penaltyRate: 5,
            earlyWithdrawal: {
              type: 'immediate',
              delayDays: 0
            }
          },
          flexible: {
            interestRate: 0,
            standard: {
              penaltyRate: 2.5,
              withdrawalDelayHours: 24,
              locked: true
            },
            instant: {
              penaltyRate: 5,
              locked: true
            }
          },
          autoSave: {
            retryEnabled: true,
            maxRetries: 3
          }
        },
        loan: {
          minCreditScore: 0.4,
          autoApprovalLimit: 50000,
          collateral: {
            percentage: 50
          },
          ladder: {
            levels: [],
            defaultInterest: 5
          },
          penalty: {
            dailyRate: 10,
            gracePeriod: 1
          }
        },
        system: {
          currency: "NGN",
          maintenanceMode: false
        }
      });
    }

    // Ensure nested objects exist for old documents (migration on read)
    if (!settings.savings || !settings.savings.fixed) {
      settings.savings = {
        fixed: {
          minDuration: 30,
          minDurationMonths: 3,
          interestRate: 10,
          penaltyRate: 5,
          earlyWithdrawal: { type: 'immediate', delayDays: 0 }
        },
        flexible: {
          interestRate: 0,
          standard: { penaltyRate: 2.5, withdrawalDelayHours: 24, locked: true },
          instant: { penaltyRate: 5, locked: true }
        },
        autoSave: { retryEnabled: true, maxRetries: 3 }
      };
      await settings.save();
    }

    if (!settings.loan || !settings.loan.penalty) {
      settings.loan = {
        minCreditScore: 0.4,
        autoApprovalLimit: 50000,
        collateral: { percentage: 50 },
        ladder: { levels: [], defaultInterest: 5 },
        penalty: { dailyRate: 10, gracePeriod: 1 }
      };
      await settings.save();
    }

    if (!settings.system) {
      settings.system = { currency: "NGN", maintenanceMode: false };
      await settings.save();
    }

    return settings;
  }

  /**
   * Update system settings.
   * - Admin-only operation.
   * - Automatically updates timestamp and updatedBy.
   */
  static async updateSettings(
    adminId: string,
    updates: Partial<ISettings>
  ): Promise<ISettings> {
    if (!adminId) throw new BadRequestError("Missing adminId");

    const settings = await Settings.findOneAndUpdate(
      { singleton: "singleton" },
      { ...updates, updatedBy: adminId, updatedAt: new Date() },
      { new: true, upsert: true }
    );

    return settings!;
  }

  /**
   * Retrieve profit configuration(s) by category.
   * Throws NotFoundError if no configuration exists for that category.
   */
  static async getProfitConfig(
    category: "bill-payment" | "transfer" | "loan" | "savings" | "escrow" | "marketplace"
  ) {
    const settings = await this.getSettings();

    if (!settings.profitRange || settings.profitRange.length === 0) {
      throw new NotFoundError("No profit configurations defined in settings");
    }

    const configs = settings.profitRange.filter((p) => p.category === category);

    if (configs.length === 0) {
      throw new NotFoundError(`No profit configuration found for ${category}`);
    }

    return configs;
  }

  /**
   * Compute profit for a transaction based on settings.
   * Automatically applies percentage or fixed rules within valid range.
   * - Reusable across LoanService, TransferService, ProfitService, etc.
   */
  static async calculateProfit(
    category: "bill-payment" | "transfer" | "loan" | "savings" | "escrow" | "marketplace",
    action: "send" | "receive",
    amount: number
  ): Promise<number> {
    if (!amount || amount <= 0)
      throw new BadRequestError("Invalid transaction amount");

    const configs = await this.getProfitConfig(category);

    // Find all configs where the amount falls within range
    const validConfigs = configs.filter(
      (c) => amount >= c.minAmount && amount <= c.maxAmount
    );

    if (validConfigs.length === 0) {
      throw new BadRequestError(
        `Amount ₦${amount} does not match any profit range for ${category}`
      );
    }

    // Calculate total profit (some categories may have multiple overlapping rules)
    let totalProfit = 0;

    for (const config of validConfigs) {
      if (action == config.action) {
        if (config.type === "percentage") {
          totalProfit += config.amount * amount;
        } else if (config.type === "amount") {
          totalProfit += config.amount || 0;
        }
      }
    }

    // Round to 2 decimal places for currency consistency
    return Number(totalProfit.toFixed(2));
  }

  /**
   * Calculate fee breakdown for one or more categories.
   * Returns individual line items with name, rate/amount, and computed fee.
   */
  static async calculateFeeBreakdown(
    categories: ("bill-payment" | "transfer" | "loan" | "savings" | "escrow" | "marketplace")[],
    action: "send" | "receive",
    amount: number
  ): Promise<{ name: string; type: string; rate: number; fee: number; category: string }[]> {
    if (!amount || amount <= 0) return [];

    const settings = await this.getSettings();
    const allConfigs = settings.profitRange || [];

    const breakdown: { name: string; type: string; rate: number; fee: number; category: string }[] = [];

    for (const category of categories) {
      const configs = allConfigs.filter(
        (c) => c.category === category && amount >= c.minAmount && amount <= c.maxAmount && c.action === action
      );

      for (const config of configs) {
        let fee = 0;
        if (config.type === "percentage") {
          fee = Number((config.amount * amount).toFixed(2));
        } else {
          fee = config.amount || 0;
        }

        breakdown.push({
          name: config.description,
          type: config.type,
          rate: config.amount,
          fee,
          category: config.category
        });
      }
    }

    return breakdown;
  }

  /**
   * Toggle maintenance mode (admin operation).
   */
  static async setMaintenanceMode(
    adminId: string,
    mode: boolean
  ): Promise<ISettings> {
    return this.updateSettings(adminId, { maintenanceMode: mode });
  }

  /**
   * Refresh settings manually (useful if cached in the future).
   */
  static async refresh(): Promise<ISettings> {
    return this.getSettings();
  }
}
