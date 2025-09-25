import express, { Application, Request, Response } from "express";
import morgan from "morgan";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";

import { specs, swaggerUi, swaggerUiOptions } from "./swagger.config";
import userRoutes from "./routes/userRoutes";
import adminRoutes from "./routes/adminRoutes";
import { errHandler } from "./exceptions";
import crossOrigin from "./shared/utils/cross-origin";
import cors from "cors";

export default function configureApp(app: Application): void {
  // Logger (dev only)
  if (process.env.ENV === "dev" || process.env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  }

  // Security & middleware
  app.use("*", cors());
  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(compression());

  // Swagger docs
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(specs, swaggerUiOptions)
  );

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
    });
  });

  // Routes
  app.use("/api", userRoutes);
  app.use("/backoffice", adminRoutes);

  // Error handler (must be last)
  app.use(errHandler);
}
