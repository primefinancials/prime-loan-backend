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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const generateBearerToken_1 = require("./generateBearerToken");
const exceptions_1 = require("../exceptions");
const httpClient = (endpoint_1, ...args_1) => __awaiter(void 0, [endpoint_1, ...args_1], void 0, function* (endpoint, method = "GET", body) {
    const url = `${config_1.baseUrl}${endpoint}`;
    const accessToken = yield (0, generateBearerToken_1.generateBearerToken)(config_1.customerKey, config_1.customerSecret);
    const headers = {
        "Content-Type": "application/json",
        "AccessToken": accessToken || "",
    };
    const options = {
        url,
        method,
        headers,
        data: body,
    };
    console.log({ body });
    try {
        const response = yield (0, axios_1.default)(options);
        console.log({ response });
        if (![200, 202].includes(response.status)) {
            throw new Error(`Client creation failed: ${response.data.message}`);
        }
        console.log({ httpClient: "passed" });
        return response;
    }
    catch (error) {
        throw new exceptions_1.APIError(error.status, error.response.data.message || error.message);
    }
});
exports.httpClient = httpClient;
