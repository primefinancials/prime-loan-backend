import express, { Application } from "express";
import cors from "cors";
import userRoutes from "./routes/userRoutes";
// import transactionRoutes from "./routes/transactionRoutes";
// import budgetRoutes from "./routes/loanRoutes";
import { errorHandler } from "./middlewares/errorHandler";

const app: Application = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRoutes);
// app.use("/api/transactions", transactionRoutes);
// app.use("/api/budgets", budgetRoutes);

// Global Error Handler
app.use(errorHandler);

export default app;
