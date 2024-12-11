"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const userController_1 = require("../controllers/userController");
const router = express_1.default.Router();
router.get("/account-enquiry", userController_1.accountEnquiry);
router.post("/create-client", userController_1.createClientAccount);
router.get("/bank-listing", userController_1.bankListing);
router.post("/transfer", userController_1.transfer);
router.post("/wallet-alert", userController_1.walletAlerts);
exports.default = router;
