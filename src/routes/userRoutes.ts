import express from "express";
import { accountEnquiry, createClientAccount, bankListing, transfer, walletAlerts, beneficiaryEnquiry } from "../controllers/userController";

const router = express.Router();

router.get("/account-enquiry", beneficiaryEnquiry);
router.get("/my-enquiry", accountEnquiry);
router.post("/create-client", createClientAccount);
router.get("/bank-listing", bankListing);
router.post("/transfer", transfer);
router.post("/wallet-alert", walletAlerts);

export default router;
