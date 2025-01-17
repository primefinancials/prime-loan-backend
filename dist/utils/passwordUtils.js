"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptPassword = exports.decodePassword = void 0;
const crypto_js_1 = __importDefault(require("crypto-js"));
const config_1 = require("../config");
const decodePassword = (password) => {
    const decrypted = crypto_js_1.default.AES.decrypt(password, String(config_1.CRYPTOJS_KEY)).toString(crypto_js_1.default.enc.Utf8);
    return decrypted;
};
exports.decodePassword = decodePassword;
const encryptPassword = (password) => {
    const encrypted = crypto_js_1.default.AES.encrypt(password, String(config_1.CRYPTOJS_KEY)).toString();
    return encrypted;
};
exports.encryptPassword = encryptPassword;
