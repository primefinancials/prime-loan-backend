/**
 * Profit Realization Cron Worker
 * ---------------------------------
 * - Checks for unrealized transaction-based profits
 * - Attempts to re-realize them every 2 hours using VFD provider
 */

import { QueueService } from "../../shared/queue";
import { SettingsService } from "../../modules/admin/settings.service";
import { DatabaseService } from "../../shared/db";
import { ProfitService } from "../../modules/profits/profits.service";
import Profit from "../../modules/profits/profits.model";
import { UserService } from "../../modules/users/user.service";
import { WorkerLogService } from "../../modules/worker-logs/worker-log.service";
import { WorkerControlService } from "../../modules/workers/worker-control.service";
import pino from "pino";

const logger = pino({ name: "profit-realization-cron" });

export class ProfitRealizationCron {
  static register() {
    WorkerControlService.register("profit-realization", async () => {
      const settings = await SettingsService.getSettings();
      let schedule = '*/5 * * * *'; // Every 5 minutes
      if (settings.workersConfig?.has('profit-realization')) {
        const config = settings.workersConfig.get('profit-realization');
        if (config?.cronSchedule) schedule = config.cronSchedule;
      }

      await QueueService.removeRepeatableJobs('profit-realization');
      await QueueService.scheduleRepeatableJob('profit-realization', schedule);

      return QueueService.createWorker(
        "profit-realization",
        async () => {
          await this.processUnrealizedProfits();
        }
      );
    });
  }

  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();
    this.register();
    await WorkerControlService.start("profit-realization");
  }

  /**
   * Process all unrealized transaction-based profits
   */
  private static async processUnrealizedProfits() {
    try {
      const unrealizedProfits = await Profit.find({
        type: "unrealized",
        isRealized: false,
        source: "transaction",
        amount: { $gt: 0 },
      }).lean();

      if (unrealizedProfits.length === 0) {
        logger.info("No unrealized transaction profits found");
        return;
      }

      logger.info(`Processing ${unrealizedProfits.length} unrealized transaction profits`);
      await WorkerControlService.reportActivity('profit-realization', `Processing ${unrealizedProfits.length} profits`);
      await WorkerLogService.log('profit-realization', 'info', `Processing ${unrealizedProfits.length} unrealized transaction profits`);

      const profitService = new ProfitService();

      for (const profit of unrealizedProfits) {
        try {
          const user = await UserService.getUser(profit.userId);
          if (!user || Array.isArray(user) || !user._id) {
            logger.warn(
              { reference: profit.reference },
              "User not found, skipping profit realization"
            );
            continue;
          }

          // Attempt to re-realize the profit
          const savedProfit = await profitService.recordRealizedProfit({
            reference: profit.reference,
            userId: profit.userId,
            source: profit.source,
            amount: profit.amount,
            percentage: profit.percentage,
            description: profit.description,
          });

          if (savedProfit.isRealized) {
            logger.info(
              { reference: profit.reference, userId: profit.userId },
              "Profit re-realized successfully"
            );
            await WorkerLogService.log('profit-realization', 'info', 'Profit re-realized successfully', { reference: profit.reference, userId: profit.userId });
          } else {
            logger.warn(
              { reference: profit.reference, userId: profit.userId },
              "Profit re-realization failed, will retry later"
            );
          }
        } catch (err: any) {
          logger.error(
            { reference: profit.reference, error: err.message },
            "Error realizing profit"
          );
          await WorkerLogService.log('profit-realization', 'error', `Error realizing profit: ${err.message}`, { reference: profit.reference });
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "Error fetching unrealized profits");
      await WorkerLogService.log('profit-realization', 'error', `Fatal error in profit realization cron: ${err.message}`);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  ProfitRealizationCron.start().catch(console.error);
}
