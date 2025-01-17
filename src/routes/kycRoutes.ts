import express from "express";
import { livenessCheck, bvnLookup, ninVerification } from "../controllers/kycController";
import { livenessCheckSchema, ninVerificationSchema } from "../validations";
import { verifyJwtRest, validateReqBody } from "../middlewares";

const router = express.Router();

router.post("/liveness", verifyJwtRest(), validateReqBody(livenessCheckSchema), livenessCheck);
router.get("/bvn-lookup", verifyJwtRest(), bvnLookup);
router.post("/nin-verification", verifyJwtRest(), validateReqBody(ninVerificationSchema), ninVerification);

export default router;
