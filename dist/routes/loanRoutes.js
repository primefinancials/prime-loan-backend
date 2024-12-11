"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const loanController_1 = require("../controllers/loanController");
const router = express_1.default.Router();
router.post("/create-and-disburse-loan", loanController_1.createAndDisburseLoan);
router.get("/loan-transaction-status", loanController_1.loanTransactionStatus);
router.get("/loan-repayment-schedule", loanController_1.loanRepaymentSchedule);
router.get("/loan-portfolio", loanController_1.loanPortfolio);
router.post("/repay-loan", loanController_1.repayLoan);
router.post("/reject-loan", loanController_1.rejectLoan);
exports.default = router;
