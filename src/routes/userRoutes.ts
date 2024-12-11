import express from "express";
import { accountEnquiry, createClientAccount, bankListing, transfer, walletAlerts } from "../controllers/userController";

const router = express.Router();

router.get("/account-enquiry", accountEnquiry);
router.post("/create-client", createClientAccount);
router.get("/bank-listing", bankListing);
router.post("/transfer", transfer);
router.post("/wallet-alert", walletAlerts);

export default router;
