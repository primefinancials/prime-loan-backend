/**
 * Main Application Server
 * - Combines middleware, DB connection, and route setup
 * - Uses HTTP server wrapper for flexibility (WebSockets, etc.)
 * - Graceful shutdown and centralized logging
 */

import express from "express";
import http from "http";
import pino from "pino";
import { DatabaseService } from "./shared/db";
import { PORT } from "./config";
import createApp from "./app";

// === Workers ===
import { LoanPenaltiesCron } from "./workers/loans/penaltiesCron";
import { TransfersPoller } from "./workers/pollers/transfersPoller";
import { SavingsMaturitiesWorker } from "./workers/savings/maturitiesWorker";
import { ProfitRealizationCron } from "./workers/profits/profitsCron";
import { QueueService } from "./shared/queue";

const logger = pino({ name: "prime-finance-server" });

export async function startApp() {
  try {
    const app = express();

    // Connect to database first
    await DatabaseService.connect();

    // Configure Express app
    await createApp(app);

    // Start background workers (non-blocking)
    startBackgroundWorkers();

    const server = http.createServer(app);

    server
      .listen(PORT, "0.0.0.0", (): void => {
        logger.info("Prime Finance server initiated");
      })
      .on("listening", () => {
        logger.info(`✅ Server listening on port ${PORT}`);
        logger.info("Routes mounted under /api/*");
      })
      .on("error", (err: any) => {
        logger.error({ err }, "Server failed to start");
        process.exit(1);
      })
      .on("close", () => {
        logger.info("Server closed");
      });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
      await QueueService.closeAll();
    });

    return server;
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to start app");
    process.exit(1);
  }
}

/**
 * Initialize background workers after server & DB are ready
 */
async function startBackgroundWorkers() {
  try {
    await Promise.all([
      LoanPenaltiesCron.start(),
      TransfersPoller.start(),
      SavingsMaturitiesWorker.start(),
      ProfitRealizationCron.start(),
    ]);
    logger.info("✅ Background workers started successfully");
  } catch (err) {
    logger.error({ err }, "❌ Failed to start one or more workers");
  }
}

// Start server if run directly
if (require.main === module) {
  startApp().catch((err) => {
    logger.error({ err }, "Unhandled error while starting app");
    process.exit(1);
  });
}
