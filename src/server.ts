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

/** Connect with exponential-ish backoff instead of crashing the process. */
async function connectWithRetry(name: string, fn: () => Promise<any>, maxAttempts = 30) {
  for (let attempt = 1; ; attempt++) {
    try {
      logger.info(`Connecting to ${name}... (attempt ${attempt})`);
      await fn();
      logger.info(`✅ Connected to ${name}`);
      return;
    } catch (err: any) {
      const wait = Math.min(30000, 2000 * attempt);
      logger.error({ err: err?.message }, `❌ ${name} connection failed — retrying in ${wait}ms`);
      if (attempt >= maxAttempts) {
        logger.error(`Giving up on ${name} after ${maxAttempts} attempts — the instance stays up serving /health so config can be fixed without a crash loop.`);
        return;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function startApp() {
  try {
    validateEnv();

    const app = express();
    const server = http.createServer(app);

    // ─── PHASE 1: Bind to port immediately ───────────────────────
    // Serve a basic health endpoint so the PaaS health check passes
    // while we initialize DB and Redis in the background. This is the
    // endpoint EB's health check hits — it must stay 200 during cold start.
    app.get("/health", (_req, res) => {
      res.status(200).json({
        status: servicesReady ? "healthy" : "starting",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
      });
    });

    // Deep readiness — actually checks MongoDB + Redis. Use this for
    // dashboards / uptime monitors; NOT for the EB health check (a transient
    // DB blip would cycle the single instance).
    app.get("/health/ready", async (_req, res) => {
      const out: any = { ready: false, mongo: "unknown", redis: "unknown", servicesReady };
      try {
        const mongoose = (await import("mongoose")).default;
        out.mongo = mongoose.connection.readyState === 1 ? "up" : "down";
      } catch { out.mongo = "error"; }
      try {
        const { QueueService } = await import("./shared/queue");
        out.redis = (await QueueService.ping()) ? "up" : "down";
      } catch { out.redis = "error"; }
      out.ready = servicesReady && out.mongo === "up" && out.redis === "up";
      res.status(out.ready ? 200 : 503).json(out);
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
    // Retry rather than exit — a crash-loop on a transient DB/Redis blip (or
    // during first provisioning before env vars are set) takes the whole
    // instance down. The port is already bound and /health answers "starting".
    await connectWithRetry("MongoDB", () => DatabaseService.connect());
    await connectWithRetry("Redis (BullMQ)", () => QueueService.connect());

    // ─── PHASE 3: Configure Express app & routes ─────────────────
    await createApp(app);

    // Initialize Socket.io
    SocketService.init(server);

    // Mark services ready only if MongoDB actually connected.
    try {
      const mongoose = (await import("mongoose")).default;
      servicesReady = mongoose.connection.readyState === 1;
    } catch {
      servicesReady = false;
    }
    if (servicesReady) {
      logger.info("✅ All services initialized — server is fully operational");
    } else {
      logger.warn("⚠️ Routes mounted but MongoDB is not connected — check env config. Instance stays up; it will connect once config is fixed.");
      // keep trying in the background so a later `eb setenv` recovers without a redeploy
      connectWithRetry("MongoDB (background)", () => DatabaseService.connect(), 999999).then(async () => {
        try {
          const mongoose = (await import("mongoose")).default;
          if (mongoose.connection.readyState === 1) { servicesReady = true; startBackgroundWorkers(); }
        } catch { /* noop */ }
      });
    }
    logger.info("Routes mounted under /api/*");

    // ─── PHASE 4: Start background workers (non-blocking) ────────
    // Only when services are actually up — otherwise the background retry
    // above starts them once MongoDB connects.
    if (servicesReady) startBackgroundWorkers();

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

    // Workers are always registered (so the admin panel can start them on
    // demand), but auto-start can be suppressed with WORKERS_AUTOSTART=false.
    // Use this when bringing an environment up after a long outage so an
    // operator can review the backlog before penalty accrual, Mono debits and
    // defaulter calls resume.
    if (String(process.env.WORKERS_AUTOSTART ?? "true").toLowerCase() === "false") {
      logger.warn("⏸️  WORKERS_AUTOSTART=false - workers registered but NOT started. Start them from the admin panel.");
      return;
    }

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
