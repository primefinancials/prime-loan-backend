"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const kycController_1 = require("../controllers/kycController");
const validations_1 = require("../validations");
const middlewares_1 = require("../middlewares");
const router = express_1.default.Router();
router.post("/liveness", (0, middlewares_1.verifyJwtRest)(), (0, middlewares_1.validateReqBody)(validations_1.livenessCheckSchema), kycController_1.livenessCheck);
router.get("/bvn-lookup", (0, middlewares_1.verifyJwtRest)(), kycController_1.bvnLookup);
router.post("/nin-verification", (0, middlewares_1.verifyJwtRest)(), (0, middlewares_1.validateReqBody)(validations_1.ninVerificationSchema), kycController_1.ninVerification);
exports.default = router;
