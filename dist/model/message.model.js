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
const mongoose_1 = require("mongoose");
const messageSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true, // Name of the notification
    },
    user: {
        type: String,
        required: true, // User ID (UUID)
    },
    message: {
        type: String,
        required: true, // Notification message
    },
    type: {
        type: String,
        required: true,
    },
    status: {
        type: String,
        required: true,
    },
}, { timestamps: true });
const MessageModel = (0, mongoose_1.model)('messages', messageSchema);
// Sync indexes with the database
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield MessageModel.syncIndexes();
}))();
exports.default = MessageModel;
