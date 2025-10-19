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
      });
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
    category: "bill-payment" | "transfer" | "loan" | "savings" | "escrow"
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
    category: "bill-payment" | "transfer" | "loan" | "savings" | "escrow",
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
      if(action == config.action) {
        if (config.type === "percentage") {
          totalProfit += (config.amount! / 100) * amount;
        } else if (config.type === "amount") {
          totalProfit += config.amount || 0;
        }
      }
    }

    // Round to 2 decimal places for currency consistency
    return Number(totalProfit.toFixed(2));
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
