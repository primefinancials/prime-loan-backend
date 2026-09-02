/**
 * Main Application Server
 * - Combines middleware, DB connection, and route setup
 * - Uses HTTP server wrapper for flexibility (WebSockets, etc.)
 * - Graceful shutdown and centralized logging
 * 
 * ARCHITECTURE NOTE: The server binds to the port IMMEDIATELY with a
 * minimal health-check endpoint, then connects to DB/Redis in the
 * background. This prevents Railway (or any PaaS) from marking the
 * service as unhealthy during slow cold-starts.
 */

import express from "express";
import http from "http";
import pino from "pino";
import { DatabaseService } from "./shared/db";
import { PORT } from "./config";
import { validateEnv } from "./config/validateEnv";
import createApp from "./app";

// === Workers ===
import { LoanPenaltiesCron } from "./workers/loans/penaltiesCron";
import { MonoReconcileCron } from "./workers/loans/monoReconcileCron";
import { TransfersPoller } from "./workers/pollers/transfersPoller";
import { SavingsMaturitiesWorker } from "./workers/savings/maturitiesWorker";
import { ProfitRealizationCron } from "./workers/profits/profitsCron";
import { BillPaymentsPoller } from "./workers/pollers/billPaymentsPoller";
import { DefaulterCallWorker } from "./workers/loans/defaulterCallWorker";
import { EscrowTimeoutWorker } from "./workers/escrow/escrowTimeoutWorker";
import { SavingsEarlyWithdrawalWorker } from "./workers/savings/earlyWithdrawalWorker";
import { SavingsContributionWorker } from "./workers/savings/contributionWorker";
import { QueueService } from "./shared/queue";
import { WorkerControlService } from "./modules/workers/worker-control.service";
import { SocketService } from "./shared/sockets";

const logger = pino({ name: "prime-finance-server" });

/** Tracks whether all backend services are ready */
let servicesReady = false;

export async function startApp() {
  try {
    validateEnv();

    const app = express();
    const server = http.createServer(app);

    // ─── PHASE 1: Bind to port immediately ───────────────────────
    // Serve a basic health endpoint so Railway's health checks pass
    // while we initialize DB and Redis in the background.
    app.get("/health", (_req, res) => {
      res.status(200).json({
        status: servicesReady ? "healthy" : "starting",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
      });
    });

    await new Promise<void>((resolve, reject) => {
      server
        .listen(PORT, "0.0.0.0", () => {
          logger.info(`✅ Server listening on port ${PORT} (health-check ready)`);
          resolve();
        })
        .on("error", (err: any) => {
          logger.error({ err }, "Server failed to bind to port");
          reject(err);
        });
    });

    // ─── PHASE 2: Connect backend services ───────────────────────
    logger.info("Connecting to MongoDB...");
    await DatabaseService.connect();
    logger.info("✅ Connected to MongoDB");

    logger.info("Connecting to Redis (BullMQ)...");
    await QueueService.connect();
    logger.info("✅ Connected to Redis");

    // ─── PHASE 3: Configure Express app & routes ─────────────────
    await createApp(app);

    // Initialize Socket.io
    SocketService.init(server);

    // Mark services as fully ready
    servicesReady = true;
    logger.info("✅ All services initialized — server is fully operational");
    logger.info("Routes mounted under /api/*");

    // ─── PHASE 4: Start background workers (non-blocking) ────────
    startBackgroundWorkers();

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
    logger.error({ error: error.message, stack: error.stack }, "Failed to start app");
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
    MonoReconcileCron.register();
    TransfersPoller.register();
    SavingsMaturitiesWorker.register();
    ProfitRealizationCron.register();
    BillPaymentsPoller.register();
    DefaulterCallWorker.register();
    EscrowTimeoutWorker.register();
    SavingsEarlyWithdrawalWorker.register();
    SavingsContributionWorker.register(); // Flexible savings contributions

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
