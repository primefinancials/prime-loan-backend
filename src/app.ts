import express, { Application, Request, Response } from "express";
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
import cors from "cors";

const app = express();
// CORS
app.use(cors());
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
// app.use("/api/data", dataRoutes);

// Catch and handle all 404 errors
app.all("*", function (req: Request, res: Response): Response {
  console.log("Not Found");
  return res.sendStatus(404);
});

app.use(errHandler);

export default app;
