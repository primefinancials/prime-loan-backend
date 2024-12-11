import express from "express";
import { livenessCheck, bvnLookup, ninVerification } from "../controllers/kycController";

const router = express.Router();

router.post("/liveness", livenessCheck);
router.get("/bvn-lookup", bvnLookup);
router.post("/nin-verification", ninVerification);

export default router;
