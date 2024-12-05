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
exports.getUsers = exports.createClientAccount = void 0;
const supabaseClient_1 = require("../utils/supabaseClient");
const axios_1 = __importDefault(require("axios"));
const generateBearerToken_1 = require("../utils/generateBearerToken");
const validateParams_1 = require("../utils/validateParams");
const convertDate_1 = require("../utils/convertDate");
const config_1 = require("../config");
const createClientAccount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, surname, password, phone, bvn, nin, dob } = req.body;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ bvn, dateOfBirth: dob, password, surname, email, name, phone, nin }, ["bvn", "dateOfBirth", "password", "phone", "nin", "email", "name", "surname"]);
        console.log({ customerKey: config_1.customerKey, customerSecret: config_1.customerSecret });
        const accessToken = yield (0, generateBearerToken_1.generateBearerToken)(config_1.customerKey, config_1.customerSecret);
        const apiUrl = `https://api-apps.vfdbank.systems/vtech-wallet/api/v1/wallet2/client/create`;
        const response = yield axios_1.default.post(`${apiUrl}?bvn=${bvn}&dateOfBirth=${(0, convertDate_1.convertDate)(dob)}`, {}, {
            headers: {
                "Content-Type": "application/json",
                AccessToken: accessToken,
            },
        });
        if (![200, 202].includes(response.status)) {
            throw new Error(`Client creation failed: ${response.data.message}`);
        }
        if (response.data) {
            const { data: { user }, error } = yield supabaseClient_1.supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { first_name: name, surname, phone, bvn, nin, dob: (0, convertDate_1.convertDate)(dob), accountNo: response.data.data.accountNo },
                },
            });
            if (error) {
                throw new Error(`Error storing to supabase: ${error.message}`);
            }
            res.status(200).json({ status: "success", data: Object.assign(Object.assign({}, response.data.data), { user }) });
        }
        res.status(400).json({ status: "error", message: response.data.message });
    }
    catch (error) {
        console.error("Error creating client account:", error);
        res.status(error.response.status || error.status || 500).json({ status: "error", message: error.response.data.message || error.message });
    }
});
exports.createClientAccount = createClientAccount;
const getUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, error } = yield supabaseClient_1.supabase.from("users").select("*");
        if (error)
            throw error;
        res.status(200).json({ status: "success", data });
    }
    catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});
exports.getUsers = getUsers;
