import express, { Application } from "express";
import cors from "cors";
import userRoutes from "./routes/userRoutes";
import kycRoutes from "./routes/kycRoutes";
import paybillsRoutes from "./routes/paybillsRoutes";
import loanRoutes from "./routes/loanRoutes";
import { errorHandler } from "./middlewares/errorHandler";

const app: Application = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/paybills", paybillsRoutes);
app.use("/api/loans", loanRoutes);

// Global Error Handler
app.use(errorHandler);

export default app;
