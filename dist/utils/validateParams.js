"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequiredParams = void 0;
const validateRequiredParams = (params, requiredFields) => {
    const missingFields = requiredFields.filter((field) => !params[field]);
    if (missingFields.length > 0) {
        throw new Error(`Mandatory Property Missing: ${missingFields.join(", ")}`);
    }
};
exports.validateRequiredParams = validateRequiredParams;
