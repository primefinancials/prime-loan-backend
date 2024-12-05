import express from "express";
import { getUsers, createClientAccount } from "../controllers/userController";

const router = express.Router();

router.get("/", getUsers);
router.post("/", createClientAccount);

export default router;
