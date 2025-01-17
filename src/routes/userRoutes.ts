import express from "express";
import {
    accountEnquiry, 
    createClientAccount, 
    bankListing, 
    transfer, 
    walletAlerts, 
    beneficiaryEnquiry,
    createAdminAccount,
    getUser,
    updateClientAccount,
    login,
    logout,
    changePassword
} from "../controllers/userController";
import { validateReqBody, verifyJwtRest } from "../middlewares";
import { 
    createAdminAccountSchema, 
    createClientAccountSchema, 
    loginReqBodySchema, 
    updateUserSchema, 
    transferSchema,
    changePasswordSchema,
    walletAlertsSchema
} from "../validations";

const router = express.Router();

router.get("/account-enquiry", verifyJwtRest(), beneficiaryEnquiry);
router.get("/get-user", verifyJwtRest(), getUser);
router.get("/my-enquiry", verifyJwtRest(), accountEnquiry);
router.post("/create-admin", validateReqBody(createClientAccountSchema), createAdminAccount);
router.post("/create-client", validateReqBody(createAdminAccountSchema), createClientAccount);
router.patch("/update-client", validateReqBody(updateUserSchema), verifyJwtRest(), updateClientAccount);
router.post("/login", validateReqBody(loginReqBodySchema), login);
router.post("/change-password", validateReqBody(changePasswordSchema), changePassword);
router.get("/logout", verifyJwtRest(), logout);
router.get("/bank-listing", verifyJwtRest(), bankListing);
router.post("/transfer", verifyJwtRest(), validateReqBody(transferSchema), transfer);
router.post("/wallet-alert", validateReqBody(walletAlertsSchema), walletAlerts);

export default router;
