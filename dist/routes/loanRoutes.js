"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const loanController_1 = require("../controllers/loanController");
const validations_1 = require("../validations");
const middlewares_1 = require("../middlewares");
const router = express_1.default.Router();
router.post("/create-and-disburse-loan", (0, middlewares_1.validateReqBody)(validations_1.createAndDisburseLoanSchema), (0, middlewares_1.verifyJwtRest)(), loanController_1.createAndDisburseLoan);
router.post("/loan-transaction-status", (0, middlewares_1.validateReqBody)(validations_1.loanTransactionStatusSchema), (0, middlewares_1.verifyJwtRest)(), loanController_1.loanTransactionStatus);
router.post("/create-loan", (0, middlewares_1.validateReqBody)(validations_1.createClientLoanSchema), (0, middlewares_1.verifyJwtRest)(), loanController_1.createClientLoan);
router.get("/loan-portfolio", (0, middlewares_1.verifyJwtRest)(), loanController_1.loanPortfolio);
router.post("/repay-loan", (0, middlewares_1.validateReqBody)(validations_1.repayLoanSchema), (0, middlewares_1.verifyJwtRest)(), loanController_1.repayLoan);
router.post("/reject-loan", (0, middlewares_1.validateReqBody)(validations_1.rejectLoanSchema), (0, middlewares_1.verifyJwtRest)(), loanController_1.rejectLoan);
router.post("/update-amount", (0, middlewares_1.validateReqBody)(validations_1.updateLoanAmountSchema), (0, middlewares_1.verifyJwtRest)(), loanController_1.UpdateLoanAmount);
router.get("/all-loans", (0, middlewares_1.verifyJwtRest)(), loanController_1.loans);
exports.default = router;
