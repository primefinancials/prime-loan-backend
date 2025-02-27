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
    changePassword,
    getUsers,
    getAdmin,
    createSuperAdminAccount,
    ActivateAndDeactivateAdmin,
    ActivateAndDeactivateUser,
    initiateReset,
    validateReset,
    updatePasswordOrPin
} from "../controllers/userController";
import { validateReqBody, verifyJwtRest } from "../middlewares";
import { 
    createAdminAccountSchema, 
    createClientAccountSchema, 
    loginReqBodySchema, 
    updateUserSchema, 
    transferSchema,
    changePasswordSchema,
    walletAlertsSchema,
    activateAdminReqBodySchema,
    activateUserReqBodySchema
} from "../validations";

const router = express.Router();

router.get("/account-enquiry", verifyJwtRest(), beneficiaryEnquiry);
router.get("/get-user", verifyJwtRest(), getUser);
router.get("/get-admin", verifyJwtRest(), getAdmin);
router.post("/create-super-admin", verifyJwtRest(), validateReqBody(createAdminAccountSchema), createSuperAdminAccount);
router.post("/activate-admin", verifyJwtRest(), validateReqBody(activateAdminReqBodySchema), ActivateAndDeactivateAdmin);
router.post("/activate-user", verifyJwtRest(), validateReqBody(activateUserReqBodySchema), ActivateAndDeactivateUser);
router.get("/get-users", verifyJwtRest(), getUsers);
router.get("/my-enquiry", verifyJwtRest(), accountEnquiry);
router.post("/create-admin", validateReqBody(createAdminAccountSchema), createAdminAccount);
router.post("/create-client", validateReqBody(createClientAccountSchema), createClientAccount);
router.patch("/update-client", validateReqBody(updateUserSchema), verifyJwtRest(), updateClientAccount);
router.post("/login", validateReqBody(loginReqBodySchema), login);
router.post("/initiate-reset", initiateReset); 
router.post("/validate-reset", validateReset); 
router.post("/update-password-or-pin", updatePasswordOrPin);
router.post("/change-password", validateReqBody(changePasswordSchema), changePassword);
router.get("/logout", verifyJwtRest(), logout);
router.get("/bank-listing", verifyJwtRest(), bankListing);
router.post("/transfer", verifyJwtRest(), validateReqBody(transferSchema), transfer);
router.post("/wallet-alert", validateReqBody(walletAlertsSchema), walletAlerts);

export default router;
