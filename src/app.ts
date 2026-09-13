import express, { Application, Request, Response } from "express";
import morgan from "morgan";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";

import { specs, swaggerUi, swaggerUiOptions } from "./swagger.config";
import userRoutes from "./routes/userRoutes";
import adminRoutes from "./routes/adminRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import { errHandler } from "./exceptions";
import crossOrigin from "./shared/utils/cross-origin";

export default function configureApp(app: Application): void {
  // Logger (dev only)
  if (process.env.ENV === "dev" || process.env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  }

  // Security & middleware
  app.use(crossOrigin());
  app.use(helmet());
  // Express's default JSON body limit is 100kb - too small for any endpoint
  // that (still) accepts a base64-encoded photo/document in the request body
  // (a 3-5MB image is ~4-6.5MB once base64-encoded). Those requests were
  // failing outright with 413 before reaching any route handler (e.g. every
  // KYC document submission). 12mb covers a base64 doc with headroom while
  // staying well under nginx's client_max_body_size (30M).
  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ extended: false, limit: "12mb" }));
  app.use(cookieParser());
  app.use(compression());

  // Swagger docs
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(specs, swaggerUiOptions)
  );

  // Health check is registered in server.ts (before DB connect)
  // so Railway gets a 200 even during cold-start initialization.

  // Routes
  app.use("/api", userRoutes);
  app.use("/backoffice", adminRoutes);
  app.use("/webhooks", webhookRoutes);

  // Error handler (must be last)
  app.use(errHandler);
}
