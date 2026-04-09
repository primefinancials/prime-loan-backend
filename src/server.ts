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
import { BillPaymentsPoller } from "./workers/pollers/billPaymentsPoller";
import { DefaulterCallWorker } from "./workers/loans/defaulterCallWorker";
import { EscrowTimeoutWorker } from "./workers/escrow/escrowTimeoutWorker";
import { SavingsEarlyWithdrawalWorker } from "./workers/savings/earlyWithdrawalWorker";
import { SavingsContributionWorker } from "./workers/savings/contributionWorker";
import { MonoDebitPoller } from "./workers/pollers/monoDebitPoller";
import { QueueService } from "./shared/queue";
import { WorkerControlService } from "./modules/workers/worker-control.service";
import { SocketService } from "./shared/sockets";

const logger = pino({ name: "prime-finance-server" });

export async function startApp() {
  try {
    const app = express();

    // Connect to database first
    await DatabaseService.connect();

    // Connect to Queue Service (Redis)
    await QueueService.connect();

    // Configure Express app
    await createApp(app);

    // Start background workers (non-blocking)
    startBackgroundWorkers();

    const server = http.createServer(app);

    // Initialize Socket.io
    SocketService.init(server);


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
    // Register all workers
    LoanPenaltiesCron.register();
    TransfersPoller.register();
    SavingsMaturitiesWorker.register();
    ProfitRealizationCron.register();
    BillPaymentsPoller.register();
    DefaulterCallWorker.register();
    EscrowTimeoutWorker.register();
    SavingsEarlyWithdrawalWorker.register();
    SavingsContributionWorker.register(); // Flexible savings contributions
    MonoDebitPoller.register(); // Mono direct debit status polling

    // Start all registered workers
    await WorkerControlService.startAll();

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
