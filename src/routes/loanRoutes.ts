import express from "express";
import { createAndDisburseLoan, loanTransactionStatus, loanRepaymentSchedule, loanPortfolio, rejectLoan, repayLoan } from "../controllers/loanController";

const router = express.Router();

router.post("/create-and-disburse-loan", createAndDisburseLoan);
router.get("/loan-transaction-status", loanTransactionStatus);
router.get("/loan-repayment-schedule", loanRepaymentSchedule);
router.get("/loan-portfolio", loanPortfolio);
router.post("/repay-loan", repayLoan);
router.post("/reject-loan", rejectLoan);

export default router;
