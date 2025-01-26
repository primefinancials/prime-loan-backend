import express, { Application, Request, Response } from "express";
import morgan from "morgan";
import helmet from "helmet";
import userRoutes from "./routes/userRoutes";
import kycRoutes from "./routes/kycRoutes";
import paybillsRoutes from "./routes/paybillsRoutes";
import loanRoutes from "./routes/loanRoutes";
import dataRoutes from "./routes/dataRoutes"; 
import { errHandler } from './exceptions';
import compression from "compression";
import cookieParser from "cookie-parser";
import { crossOrigin } from "./utils";

export default async (app: Application) => {
    // Log to console using morgan if app is in development
    if (process.env.ENV === "dev") app.use(morgan("dev"));
    
    // CORS
    app.use(crossOrigin());
    app.use(helmet());
    // Request body parser
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    // Cookie parser
    app.use(cookieParser());
    app.use(compression());
  
    // Routes
    app.use("/api/users", userRoutes);
    app.use("/api/kyc", kycRoutes);
    app.use("/api/paybills", paybillsRoutes);
    app.use("/api/loans", loanRoutes);
    app.use("/api/data", dataRoutes);
  
    app.use(errHandler);
}
