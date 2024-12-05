"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
// import transactionRoutes from "./routes/transactionRoutes";
// import budgetRoutes from "./routes/loanRoutes";
const errorHandler_1 = require("./middlewares/errorHandler");
const app = (0, express_1.default)();
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Routes
app.use("/api/users", userRoutes_1.default);
// app.use("/api/transactions", transactionRoutes);
// app.use("/api/budgets", budgetRoutes);
// Global Error Handler
app.use(errorHandler_1.errorHandler);
exports.default = app;
