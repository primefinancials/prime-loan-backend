import express from "express";
import { transaction, transactions, message, messages } from "../controllers/dataController";
import { verifyJwtRest } from "../middlewares";

const router = express.Router();

router.get("/transaction", verifyJwtRest(), transaction);
router.get("/transactions", verifyJwtRest(), transactions);
router.get("/message", verifyJwtRest(), message);
router.get("/messages", verifyJwtRest(), messages);

export default router;
