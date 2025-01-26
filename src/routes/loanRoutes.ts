import express from "express";
import { 
    createAndDisburseLoan, 
    loanTransactionStatus, 
    createClientLoan,
    loanPortfolio, 
    rejectLoan, 
    repayLoan,
    loans
} from "../controllers/loanController";
import {
    createAndDisburseLoanSchema,
    createClientLoanSchema,
    loanTransactionStatusSchema,
    rejectLoanSchema,
    repayLoanSchema
} from "../validations";
import { verifyJwtRest, validateReqBody } from "../middlewares";

const router = express.Router();

router.post("/create-and-disburse-loan", validateReqBody(createAndDisburseLoanSchema), verifyJwtRest(), createAndDisburseLoan);
router.post("/loan-transaction-status", validateReqBody(loanTransactionStatusSchema), verifyJwtRest(), loanTransactionStatus);
router.post("/create-loan", validateReqBody(createClientLoanSchema), verifyJwtRest(), createClientLoan);
router.get("/loan-portfolio", verifyJwtRest(), loanPortfolio);
router.post("/repay-loan", validateReqBody(repayLoanSchema), verifyJwtRest(), repayLoan);
router.post("/reject-loan", validateReqBody(rejectLoanSchema), verifyJwtRest(), rejectLoan); 
router.get("/all-loans", verifyJwtRest(), loans); 

export default router;
