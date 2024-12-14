"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRandomString = generateRandomString;
const crypto_1 = __importDefault(require("crypto"));
// Function to generate a random string of specified length
function generateRandomString(length) {
    if (length <= 0) {
        throw new Error("Length must be greater than 0");
    }
    // Generate random bytes and convert to base64
    const randomBytes = crypto_1.default.randomBytes(Math.ceil(length / 2));
    const randomString = randomBytes.toString('hex');
    // Return the string truncated to the desired length
    return randomString.slice(0, length);
}
