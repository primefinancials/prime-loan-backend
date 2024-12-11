"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const kycController_1 = require("../controllers/kycController");
const router = express_1.default.Router();
router.post("/liveness", kycController_1.livenessCheck);
router.get("/bvn-lookup", kycController_1.bvnLookup);
router.post("/nin-verification", kycController_1.ninVerification);
exports.default = router;
