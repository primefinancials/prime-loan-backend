import express from "express";
import { getBillerList, getBillerCategories, validateCustomer, payBill, getBillerItems } from "../controllers/paybillsController";

const router = express.Router();

router.get("/biller-list", getBillerList);
router.get("/biller-categories", getBillerCategories);
router.get("/biller-item", getBillerItems);
router.get("/validate-customer", validateCustomer);
router.post("/paybill", payBill);

export default router;
