"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dataController_1 = require("../controllers/dataController");
const middlewares_1 = require("../middlewares");
const router = express_1.default.Router();
router.get("/transaction", (0, middlewares_1.verifyJwtRest)(), dataController_1.transaction);
router.get("/transactions", (0, middlewares_1.verifyJwtRest)(), dataController_1.transactions);
router.get("/message", (0, middlewares_1.verifyJwtRest)(), dataController_1.message);
router.get("/messages", (0, middlewares_1.verifyJwtRest)(), dataController_1.messages);
router.get("/all-messages", (0, middlewares_1.verifyJwtRest)(), dataController_1.adminMessages);
router.get("/all-transactions", (0, middlewares_1.verifyJwtRest)(), dataController_1.adminTransactions);
exports.default = router;
