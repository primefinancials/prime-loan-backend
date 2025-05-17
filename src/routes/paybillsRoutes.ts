import express from "express";
import {
  buyAirtime,
  buyData,
  buyWaec,
  buyTv,
  buyPower,
  buyBetting,
  buyInternet,
  buyJamb,
  queryTransaction,
  cancelTransaction,
  verifyTvNumber,
  verifyPowerNumber,
  verifyBettingNumber,
  verifySmileNumber,
  verifyJambNumber,
  getTvPackages,
  getDataPlans,
  getInternetPlans,
  getWaecTypes,
  getJambTypes,
  getBettingPlatforms,
  getPowerSubscriptions,
} from "../controllers/paybillsController";
import { verifyJwtRest, validateReqBody } from "../middlewares";
import {
  airtimeSchema,
  dataSchema,
  waecSchema,
  tvSchema,
  powerSchema,
  bettingSchema,
  internetSchema,
  jambSchema
} from "../validations/paybillsReqBodyValidationSchema";

const router = express.Router();

// POST routes
router.post("/airtime", verifyJwtRest(), validateReqBody(airtimeSchema), buyAirtime);
router.post("/data", verifyJwtRest(), validateReqBody(dataSchema), buyData);
router.post("/waec", verifyJwtRest(), validateReqBody(waecSchema), buyWaec);
router.post("/tv", verifyJwtRest(), validateReqBody(tvSchema), buyTv);
router.post("/power", verifyJwtRest(), validateReqBody(powerSchema), buyPower);
router.post("/betting", verifyJwtRest(), validateReqBody(bettingSchema), buyBetting);
router.post("/internet", verifyJwtRest(), validateReqBody(internetSchema), buyInternet);
router.post("/jamb", verifyJwtRest(), validateReqBody(jambSchema), buyJamb);

// GET routes (Verifications)
router.get("/verify/tv", verifyJwtRest(), verifyTvNumber);
router.get("/verify/power", verifyJwtRest(), verifyPowerNumber);
router.get("/verify/betting", verifyJwtRest(), verifyBettingNumber);
router.get("/verify/smile", verifyJwtRest(), verifySmileNumber);
router.get("/verify/jamb", verifyJwtRest(), verifyJambNumber);

// Transaction operations
router.get("/transaction/:orderId", verifyJwtRest(), queryTransaction);
router.delete("/transaction/:orderId", verifyJwtRest(), cancelTransaction);

// GET options
router.get("/packages/tv", verifyJwtRest(), getTvPackages);
router.get("/packages/data", verifyJwtRest(), getDataPlans);
router.get("/packages/internet", verifyJwtRest(), getInternetPlans);
router.get("/packages/waec", verifyJwtRest(), getWaecTypes);
router.get("/packages/jamb", verifyJwtRest(), getJambTypes);
router.get("/platforms/betting", verifyJwtRest(), getBettingPlatforms);
router.get("/platforms/power", verifyJwtRest(), getPowerSubscriptions);

export default router;
