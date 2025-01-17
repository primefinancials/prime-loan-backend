import express from "express";
import { getBillerList, getBillerCategories, validateCustomer, payBill, getBillerItems } from "../controllers/paybillsController";
import { payBillSchema } from "../validations";
import { verifyJwtRest, validateReqBody } from "../middlewares";

const router = express.Router();

router.get("/biller-list", verifyJwtRest(), getBillerList);
router.get("/biller-categories", verifyJwtRest(), getBillerCategories);
router.get("/biller-item", verifyJwtRest(), getBillerItems);
router.get("/validate-customer", verifyJwtRest(), validateCustomer);
router.post("/paybill", verifyJwtRest(), validateReqBody(payBillSchema), payBill);

export default router;
