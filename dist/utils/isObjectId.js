"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isObjectId = void 0;
const mongoose_1 = require("mongoose");
/**
 * To check if a string is a valid ObjectId
 */
const isObjectId = (id) => {
    return mongoose_1.Types.ObjectId.isValid(id);
};
exports.isObjectId = isObjectId;
