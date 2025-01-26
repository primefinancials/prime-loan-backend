import express from "express";
import { transaction, transactions, message, messages, adminMessages, adminTransactions } from "../controllers/dataController";
import { verifyJwtRest } from "../middlewares";

const router = express.Router();

router.get("/transaction", verifyJwtRest(), transaction);
router.get("/transactions", verifyJwtRest(), transactions);
router.get("/message", verifyJwtRest(), message);
router.get("/messages", verifyJwtRest(), messages);
router.get("/all-messages", verifyJwtRest(), adminMessages);
router.get("/all-transactions", verifyJwtRest(), adminTransactions);

export default router;
