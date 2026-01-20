/**
 * Profit Realization Cron Worker
 * ---------------------------------
 * - Checks for unrealized transaction-based profits
 * - Attempts to re-realize them every 2 hours using VFD provider
 */

import { QueueService } from "../../shared/queue";
import { DatabaseService } from "../../shared/db";
import { ProfitService } from "../../modules/profits/profits.service";
import Profit from "../../modules/profits/profits.model";
import { UserService } from "../../modules/users/user.service";
import { WorkerLogService } from "../../modules/worker-logs/worker-log.service";
import pino from "pino";

const logger = pino({ name: "profit-realization-cron" });

export class ProfitRealizationCron {
  static async start() {
    await DatabaseService.connect();
    await QueueService.connect();

    // Runs every 2 hours
    const worker = QueueService.createWorker(
      "profit-realization",
      async () => {
        await this.processUnrealizedProfits();
      },
      {
        repeat: { pattern: "0 */2 * * *" }, // Every 2 hours
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );

    logger.info("Profit realization cron started (every 2 hours)");

    process.on("SIGTERM", async () => {
      await worker.close();
      await QueueService.closeAll();
    });
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
      }).lean();

      if (unrealizedProfits.length === 0) {
        logger.info("No unrealized transaction profits found");
        return;
      }

      logger.info(`Processing ${unrealizedProfits.length} unrealized transaction profits`);
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
          await profitService.recordRealizedProfit({
            reference: profit.reference,
            userId: profit.userId,
            source: profit.source,
            amount: profit.amount,
            percentage: profit.percentage,
            description: profit.description,
          });

          logger.info(
            { reference: profit.reference, userId: profit.userId },
            "Profit re-realized successfully"
          );
          await WorkerLogService.log('profit-realization', 'info', 'Profit re-realized successfully', { reference: profit.reference, userId: profit.userId });
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
