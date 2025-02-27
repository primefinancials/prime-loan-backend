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
const updateSchema = new mongoose_1.Schema({
    pin: { type: Number, required: true }, // Optional
    type: { type: String, enum: ["pin", "password"], required: true },
    status: { type: String, enum: ["validated", "invalid", "awaiting_validation"], required: true },
    created_at: { type: String, required: true },
});
const userSchema = new mongoose_1.Schema({
    confirmation_sent_at: { type: String, required: false },
    confirmed_at: { type: String, required: false },
    email: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function (email) {
                return __awaiter(this, void 0, void 0, function* () {
                    const self = this;
                    // Regex to validate email format
                    if (!/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
                        throw new Error("Invalid email address");
                    }
                    return true; // Validation passed
                });
            },
            message: (props) => props.reason.message || "Invalid email",
        },
    },
    password: { type: String, required: true },
    email_confirmed_at: { type: String, required: false },
    refresh_tokens: { type: [String], required: true },
    is_anonymous: { type: Boolean, required: true },
    last_sign_in_at: { type: String, required: false },
    phone: { type: String, required: false },
    role: { type: String, enum: ["user", "admin"], required: true },
    status: { type: String, enum: ["active", "inactive"], required: true },
    user_metadata: {
        bvn: { type: String, required: false },
        nin: { type: String, required: false },
        sub: { type: String, required: false },
        email: { type: String, required: false },
        gender: { type: String, required: false },
        phone: { type: String, required: false },
        surname: { type: String, required: false },
        wallet: { type: String, required: false },
        first_name: { type: String, required: false },
        dateOfBirth: { type: String, required: false },
        email_verified: { type: Boolean, required: false },
        phone_verified: { type: Boolean, required: false },
        accountNo: { type: String, required: false },
        address: { type: String, required: false },
        pin: { type: String, required: false },
        file: { type: String, required: false },
        profile_photo: { type: String, required: false },
        types: { type: String, required: false },
        verified_address: {
            type: String,
            enum: ["verified", "pending", "unverified"],
            required: false,
        },
    },
    updates: { type: [updateSchema], default: [] },
    is_super_admin: { type: Boolean, required: false, default: null },
}, { timestamps: true });
const User = (0, mongoose_1.model)('users', userSchema);
// Sync indexes with the database
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield User.syncIndexes();
}))();
exports.default = User;
