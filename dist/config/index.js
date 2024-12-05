"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerSecret = exports.customerKey = exports.PORT = exports.SUPABASE_KEY = exports.SUPABASE_URL = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.SUPABASE_URL = process.env.SUPABASE_URL;
exports.SUPABASE_KEY = process.env.SUPABASE_KEY;
exports.PORT = process.env.PORT || 3000;
exports.customerKey = process.env.CUSTOMER_KEY;
exports.customerSecret = process.env.CUSTOMER_SECRET;
