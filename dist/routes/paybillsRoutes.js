"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const paybillsController_1 = require("../controllers/paybillsController");
const router = express_1.default.Router();
router.get("/biller-list", paybillsController_1.getBillerList);
router.get("/biller-categories", paybillsController_1.getBillerCategories);
router.get("/biller-item", paybillsController_1.getBillerItems);
router.get("/validate-customer", paybillsController_1.validateCustomer);
router.post("/paybill", paybillsController_1.payBill);
exports.default = router;
