"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ninVerification = exports.bvnLookup = exports.livenessCheck = void 0;
const validateParams_1 = require("../utils/validateParams");
const httpClient_1 = require("../utils/httpClient");
const livenessCheck = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { base64Image } = req.body;
        const response = yield (0, httpClient_1.httpClient)("/wallet2/checkliveness", "POST", { base64Image });
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error checking liveness:", error);
        next(error);
    }
});
exports.livenessCheck = livenessCheck;
const bvnLookup = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { bvn } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ bvn }, ["bvn"]);
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/bvn-account-lookup?bvn=${bvn}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error checking bvn:", error);
        next(error);
    }
});
exports.bvnLookup = bvnLookup;
const ninVerification = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { idNumber } = req.body;
        const response = yield (0, httpClient_1.httpClient)("/kyc/verify/nin", "POST", { idNumber });
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error verifying nin:", error);
        next(error);
    }
});
exports.ninVerification = ninVerification;
