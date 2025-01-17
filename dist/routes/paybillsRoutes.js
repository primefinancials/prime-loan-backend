"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const paybillsController_1 = require("../controllers/paybillsController");
const validations_1 = require("../validations");
const middlewares_1 = require("../middlewares");
const router = express_1.default.Router();
router.get("/biller-list", (0, middlewares_1.verifyJwtRest)(), paybillsController_1.getBillerList);
router.get("/biller-categories", (0, middlewares_1.verifyJwtRest)(), paybillsController_1.getBillerCategories);
router.get("/biller-item", (0, middlewares_1.verifyJwtRest)(), paybillsController_1.getBillerItems);
router.get("/validate-customer", (0, middlewares_1.verifyJwtRest)(), paybillsController_1.validateCustomer);
router.post("/paybill", (0, middlewares_1.verifyJwtRest)(), (0, middlewares_1.validateReqBody)(validations_1.payBillSchema), paybillsController_1.payBill);
exports.default = router;
