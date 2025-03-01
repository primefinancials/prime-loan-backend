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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletAlerts = exports.transfer = exports.bankListing = exports.beneficiaryEnquiry = exports.accountEnquiry = exports.changePassword = exports.forgotPassword = exports.updatePasswordOrPin = exports.validateReset = exports.initiateReset = exports.logout = exports.login = exports.updateClientAccount = exports.ActivateAndDeactivateAdmin = exports.ActivateAndDeactivateUser = exports.getUsers = exports.getUser = exports.getAdmin = exports.createSuperAdminAccount = exports.createAdminAccount = exports.createClientAccount = void 0;
const validateParams_1 = require("../utils/validateParams");
const convertDate_1 = require("../utils/convertDate");
const httpClient_1 = require("../utils/httpClient");
const js_sha512_1 = require("js-sha512");
const services_1 = require("../services");
const exceptions_1 = require("../exceptions");
const utils_1 = require("../utils");
const convertDate_2 = require("../utils/convertDate");
const utils_2 = require("../utils");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const constants_1 = require("../constants");
const config_1 = require("../config");
const loanReminder_1 = require("../jobs/loanReminder");
function isUser(object, value) {
    return value in object;
}
const { find, findByEmail, create, update } = new services_1.UserService();
const { create: createTransaction } = new services_1.TransactionService();
const createClientAccount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, surname, password, phone, bvn, nin, dob } = req.body;
        const duplicateEmail = yield findByEmail(email);
        const duplicateNumber = yield find({ user_metadata: { phone } }, "one");
        if (duplicateEmail)
            throw new exceptions_1.ConflictError(`A user already exists with the email ${email}`);
        if (duplicateNumber)
            throw new exceptions_1.ConflictError(`A user already exists with the phone number ${phone}`);
        req.body.password = (0, utils_1.encryptPassword)(password);
        const apiUrl = `/wallet2/client/create?bvn=${bvn}&dateOfBirth=${(0, convertDate_1.convertDate)(dob)}`;
        const response = yield (0, httpClient_1.httpClient)(apiUrl, "POST", {});
        if (response.data && response.data.status === "00") {
            const user = yield create({
                password: req.body.password,
                user_metadata: { email, first_name: name, surname, phone, bvn, nin, dateOfBirth: dob, accountNo: response.data.data.accountNo },
                role: "user",
                confirmation_sent_at: (0, convertDate_2.getCurrentTimestamp)(),
                confirmed_at: "",
                email,
                email_confirmed_at: "",
                is_anonymous: false,
                phone,
                is_super_admin: false,
                status: "active"
            });
            return res.status(201).json({ status: "success", data: Object.assign(Object.assign({}, response.data.data), { user }) });
        }
        return res.status(response.status).json({ status: "failed", message: response.data.message });
    }
    catch (error) {
        next(error);
    }
});
exports.createClientAccount = createClientAccount;
const createAdminAccount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, surname, password, phone } = req.body;
        const duplicateEmail = yield findByEmail(email);
        const duplicateNumber = yield find({ user_metadata: { phone } }, "one");
        if (duplicateEmail)
            throw new exceptions_1.ConflictError(`A user already exists with the email ${email}`);
        if (duplicateNumber)
            throw new exceptions_1.ConflictError(`A user already exists with the phone number ${phone}`);
        req.body.password = (0, utils_1.encryptPassword)(password);
        const user = yield create({
            password: req.body.password,
            user_metadata: { email, first_name: name, surname, phone },
            role: "admin",
            confirmation_sent_at: (0, convertDate_2.getCurrentTimestamp)(),
            confirmed_at: "",
            email,
            email_confirmed_at: "",
            is_anonymous: false,
            phone,
            is_super_admin: false,
            status: "active"
        });
        return res.status(201).json({ status: "success", data: { user } });
    }
    catch (error) {
        next(error);
    }
});
exports.createAdminAccount = createAdminAccount;
const createSuperAdminAccount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, surname, password, phone } = req.body;
        const duplicateEmail = yield findByEmail(email);
        const duplicateNumber = yield find({ user_metadata: { phone } }, "one");
        if (duplicateEmail)
            throw new exceptions_1.ConflictError(`A user already exists with the email ${email}`);
        if (duplicateNumber)
            throw new exceptions_1.ConflictError(`A user already exists with the phone number ${phone}`);
        req.body.password = (0, utils_1.encryptPassword)(password);
        const user = yield create({
            password: req.body.password,
            user_metadata: { email, first_name: name, surname, phone },
            role: "admin",
            confirmation_sent_at: (0, convertDate_2.getCurrentTimestamp)(),
            confirmed_at: "",
            email,
            email_confirmed_at: "",
            is_anonymous: false,
            phone,
            is_super_admin: true,
            status: "active"
        });
        return res.status(201).json({ status: "success", data: { user } });
    }
    catch (error) {
        next(error);
    }
});
exports.createSuperAdminAccount = createSuperAdminAccount;
const getAdmin = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const admin = req.admin;
        if (!admin)
            throw new exceptions_1.UnauthorizedError(`Unauthorized! Please log in as admin to continue`);
        const foundAdmin = yield find({ _id: admin._id }, "one");
        if (foundAdmin.status !== "active")
            throw new exceptions_1.UnauthorizedError(`Account has been suspended! Contact super admin for revert action.`);
        if (!foundAdmin)
            throw new exceptions_1.NotFoundError(`No admin found`);
        return res.status(200).json({ status: "success", data: foundAdmin });
    }
    catch (err) {
        next(err);
    }
});
exports.getAdmin = getAdmin;
const getUser = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user)
            throw new exceptions_1.UnauthorizedError(`Unauthorized! Please log in as user to continue`);
        const foundUser = yield find({ _id: user._id }, "one");
        if (foundUser.status !== "active")
            throw new exceptions_1.UnauthorizedError(`Account has been suspended! Contact admin for revert action.`);
        if (!foundUser)
            throw new exceptions_1.NotFoundError(`No user found`);
        return res.status(200).json({ status: "success", data: foundUser });
    }
    catch (err) {
        next(err);
    }
});
exports.getUser = getUser;
const getUsers = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const admin = req.admin;
        if (!admin)
            throw new exceptions_1.UnauthorizedError(`Unauthorized! Please log in as an admin to continue`);
        const foundUser = yield find({}, "many");
        return res.status(200).json({ status: "success", data: foundUser });
    }
    catch (err) {
        next(err);
    }
});
exports.getUsers = getUsers;
const ActivateAndDeactivateUser = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { admin } = req;
        if (!admin) {
            throw new exceptions_1.UnauthorizedError("Unauthorized! Please log in as a admin to continue");
        }
        const { status, userId } = req.body; // Extract update field and data from request body
        const updatedUser = yield update(userId, "status", status);
        console.log({ updatedUser });
        return res.status(200).json({ status: "success", data: { user: updatedUser } });
    }
    catch (error) {
        next(error);
    }
});
exports.ActivateAndDeactivateUser = ActivateAndDeactivateUser;
const ActivateAndDeactivateAdmin = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { admin } = req;
        if (!admin) {
            throw new exceptions_1.UnauthorizedError("Unauthorized! Please log in as a admin to continue");
        }
        const { status, adminId } = req.body; // Extract update field and data from request body
        const updatedAdmin = yield update(adminId, "status", status);
        console.log({ updatedAdmin });
        return res.status(200).json({ status: "success", data: { user: updatedAdmin } });
    }
    catch (error) {
        next(error);
    }
});
exports.ActivateAndDeactivateAdmin = ActivateAndDeactivateAdmin;
const updateClientAccount = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { user } = req;
        if (!user) {
            throw new exceptions_1.UnauthorizedError("Unauthorized! Please log in as a user to continue");
        }
        const { updateField, data } = req.body; // Extract update field and data from request body
        const updatedUser = yield update(user._id, updateField, data);
        console.log({ updatedUser });
        return res.status(200).json({ status: "success", data: { user: updatedUser } });
    }
    catch (error) {
        next(error);
    }
});
exports.updateClientAccount = updateClientAccount;
const login = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password } = req.body;
        let foundUser;
        foundUser = yield findByEmail(email);
        if (!foundUser)
            throw new exceptions_1.UnauthorizedError(`Invalid Email Address!`);
        if ((foundUser === null || foundUser === void 0 ? void 0 : foundUser.status) && foundUser.status !== "active")
            throw new exceptions_1.UnauthorizedError(`Account has been suspended! Contact admin for revert action.`);
        const { password: encrypted } = foundUser;
        // decrypt found user password
        const decrypted = (0, utils_2.decodePassword)(encrypted);
        // compare decrypted password with sent password
        if (password !== decrypted)
            throw new exceptions_1.UnauthorizedError(`Incorrect Password!`);
        const _a = foundUser._doc, { password: dbPassword, // strip out password so would'nt send back to client
        refreshToken: dbRefreshToken } = _a, //Strip out old refreshToken so it wont keep signing old ones
        _user = __rest(_a, ["password", "refreshToken"]);
        const userToSign = {
            accountType: foundUser.role,
            id: _user._id
        };
        // create JWTs
        const accessToken = jsonwebtoken_1.default.sign(userToSign, String(config_1.ACCESS_TOKEN_SECRET), {
            expiresIn: constants_1.ACCESS_TOKEN_EXPIRES_IN,
        });
        const refreshToken = jsonwebtoken_1.default.sign(userToSign, String(config_1.REFRESH_TOKEN_SECRET), {
            expiresIn: constants_1.REFRESH_TOKEN_EXPIRES,
        });
        // update current user refresh token
        const refreshTokens = foundUser.refresh_tokens;
        refreshTokens.push(refreshToken);
        foundUser.refresh_tokens = refreshTokens;
        yield foundUser.save();
        return res
            .cookie("jwt", refreshToken, {
            httpOnly: true,
            maxAge: constants_1.COOKIE_VALIDITY,
        })
            .status(200)
            .json({
            status: 'success',
            data: Object.assign(Object.assign({}, _user), { refreshToken, accessToken }),
        });
    }
    catch (error) {
        next(error);
    }
});
exports.login = login;
const logout = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cookies = req.cookies;
        if (!(cookies === null || cookies === void 0 ? void 0 : cookies.jwt))
            return res.sendStatus(204); //no content
        const refreshToken = cookies.jwt;
        const foundUser = yield find({ refresh_token: refreshToken }, "one");
        if (!foundUser) {
            res.clearCookie("jwt", {
                httpOnly: true,
                maxAge: constants_1.COOKIE_VALIDITY,
                /* set sameSite: "None" and secure: true if hosted on different tls/ssl secured domain from client */
            });
            return res.sendStatus(204);
        }
        // Delete refreshToken in db
        foundUser.refresh_token = "";
        const result = yield foundUser.save();
        return res
            .clearCookie("jwt", { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 })
            .sendStatus(204);
    }
    catch (error) {
        next(error);
    }
});
exports.logout = logout;
const initiateReset = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, type } = req.body;
        if (!email)
            throw new exceptions_1.BadRequestError("Provide a valid email");
        if (!type)
            throw new exceptions_1.BadRequestError("Provide a valid type");
        const foundUser = yield find({ email }, "one");
        if (!foundUser)
            throw new exceptions_1.NotFoundError("No user found");
        const pin = Math.floor(100000 + Math.random() * 900000);
        // Initialize updates array if it doesn't exist
        const updates = [
            ...(foundUser.updates || []), // Handle undefined updates array
            {
                pin,
                type,
                status: "awaiting_validation",
                created_at: new Date().toISOString() // Include full timestamp
            }
        ];
        yield (0, loanReminder_1.sendEmail)(email, "Reset Your Password – OTP Verification Code", `
      Dear ${foundUser.user_metadata.first_name},

      We received a request to reset your password. Use the One-Time Password (OTP) below to proceed:

      🔐 Your OTP Code: [${pin}]

      This code is valid for the next 10 minutes. If you did not request a password reset, please ignore this email or contact our support team immediately.

      Stay secure,
      Prime Finance Support Team
      support@primefinance.live | primefinance.live
      `);
        yield update(foundUser._id, "updates", updates);
        return res.status(200).json({
            status: "success",
            message: "OTP initiated successfully",
            data: true
        });
    }
    catch (err) {
        next(err);
    }
});
exports.initiateReset = initiateReset;
const validateReset = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, pin } = req.body;
        if (!email)
            throw new exceptions_1.BadRequestError('Email is required');
        if (!pin)
            throw new exceptions_1.BadRequestError('PIN is required');
        const foundUser = yield find({ email }, "one");
        if (!foundUser)
            throw new exceptions_1.NotFoundError('User not found with provided email');
        const updates = foundUser.updates;
        const lastUpdate = updates[updates.length - 1];
        if (!lastUpdate)
            throw new exceptions_1.BadRequestError('No reset request found');
        const currentTime = new Date();
        const createdAt = new Date(lastUpdate.created_at);
        // Calculate time difference in milliseconds
        const timeDiff = currentTime.getTime() - createdAt.getTime();
        console.log(`Time difference: timeDiff: ${timeDiff}, 10min: ${10 * 60 * 1000}`);
        // Check if PIN is correct and within 10-minute window
        if (lastUpdate.pin !== pin || timeDiff > 10 * 60 * 1000) { // 10 minutes in milliseconds
            lastUpdate.status = "invalid";
            yield update(foundUser._id, "updates", updates);
            throw new exceptions_1.BadRequestError('Invalid or expired OTP');
        }
        lastUpdate.status = "validated";
        yield update(foundUser._id, "updates", updates);
        return res.status(200).json({
            status: "success",
            message: "OTP validated successfully",
            data: true
        });
    }
    catch (err) {
        next(err);
    }
});
exports.validateReset = validateReset;
const updatePasswordOrPin = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, newPassword, newPin } = req.body;
        if (!email)
            throw new exceptions_1.BadRequestError(`Provide a valid email`);
        const foundUser = yield find({ email }, "one");
        if (!foundUser)
            throw new exceptions_1.NotFoundError(`No user found`);
        // Get the last update from the updates array
        const lastUpdate = foundUser.updates[foundUser.updates.length - 1];
        // Check if last update exists and is validated
        if (!lastUpdate || lastUpdate.status !== "validated") {
            throw new exceptions_1.BadRequestError(`Password or PIN update is not validated`);
        }
        // Hash the new password if provided
        if (newPassword) {
            const hashedPassword = yield (0, utils_1.encryptPassword)(newPassword); // Hashing the password with salt rounds
            yield update(foundUser._id, "password", hashedPassword); // Save password
            return res.status(200).json({ status: "success", message: "Password updated successfully", data: true });
        }
        // Update the new PIN if provided
        if (newPin) {
            yield update(foundUser._id, "user_metadata.pin", newPin); // Save PIN (if you have a separate update mechanism)
            return res.status(200).json({ status: "success", message: "PIN updated successfully", data: true });
        }
        return res.status(400).json({ status: "failed", message: "Missing Parameters" });
    }
    catch (err) {
        next(err);
    }
});
exports.updatePasswordOrPin = updatePasswordOrPin;
const forgotPassword = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = req.user;
        if (!user)
            throw new exceptions_1.UnauthorizedError(`Unauthorized! Please log in as user to continue`);
        const foundUser = yield find({ _id: user._id }, "one");
        if (!foundUser)
            throw new exceptions_1.NotFoundError(`No user found`);
        let userPassword = "";
        if (isUser(foundUser, "password") && foundUser.password)
            userPassword = foundUser.password;
        // Decoding password
        const decrypted = (0, utils_2.decodePassword)(userPassword);
        if (oldPassword !== decrypted)
            throw new exceptions_1.UnauthorizedError(`Invalid credentials`);
        const encrypted = (0, utils_1.encryptPassword)(newPassword);
        foundUser.password = encrypted;
        foundUser.save();
        return res.status(200).json({ status: "success", data: foundUser });
    }
    catch (err) {
        next(err);
    }
});
exports.forgotPassword = forgotPassword;
const changePassword = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = req.user;
        if (!user)
            throw new exceptions_1.UnauthorizedError(`Unauthorized! Please log in as user to continue`);
        const foundUser = yield find({ _id: user._id }, "one");
        if (!foundUser)
            throw new exceptions_1.NotFoundError(`No user found`);
        let userPassword = "";
        if (isUser(foundUser, "password") && foundUser.password)
            userPassword = foundUser.password;
        // Decoding password
        const decrypted = (0, utils_2.decodePassword)(userPassword);
        if (oldPassword !== decrypted)
            throw new exceptions_1.UnauthorizedError(`Invalid credentials`);
        const encrypted = (0, utils_1.encryptPassword)(newPassword);
        foundUser.password = encrypted;
        foundUser.save();
        return res.status(200).json({ status: "success", data: foundUser });
    }
    catch (err) {
        next(err);
    }
});
exports.changePassword = changePassword;
const accountEnquiry = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { accountNumber } = req.query;
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/account/enquiry${accountNumber ? `?accountNumber=${accountNumber}` : "?"}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting account enquiry:", error);
        next(error);
    }
});
exports.accountEnquiry = accountEnquiry;
const beneficiaryEnquiry = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { accountNo, bank, transferType } = req.query;
        // Validate required parameters
        (0, validateParams_1.validateRequiredParams)({ accountNo, bank, transferType }, ["accountNo", "bank", "transferType"]);
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting account enquiry:", error);
        next(error);
    }
});
exports.beneficiaryEnquiry = beneficiaryEnquiry;
const bankListing = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield (0, httpClient_1.httpClient)(`/wallet2/bank`, "GET");
        res.status(response.status).json({ status: "success", data: response.data.data });
    }
    catch (error) {
        console.log("Error getting bank list:", error);
        next(error);
    }
});
exports.bankListing = bankListing;
const transfer = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { fromAccount, fromClientId, fromClient, fromSavingsId, fromBvn, toClient, toSession, toBvn, toKyc, bank, toAccount, toBank, toSavingsId, amount, remark, reference, } = req.body;
        console.log(Object.assign({}, req.body));
        const { user } = req;
        if (!user || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        if (Number(user.user_metadata.wallet) < Number(amount)) {
            return res.status(409).json({
                status: "Insufficient Funds.",
                data: null
            });
        }
        const apiUrl = `/wallet2/transfer`;
        const response = yield (0, httpClient_1.httpClient)(apiUrl, "POST", {
            fromAccount,
            uniqueSenderAccountId: "",
            fromClientId,
            fromClient,
            fromSavingsId,
            fromBvn,
            toClient,
            toSession,
            toBvn,
            toKyc,
            toAccount,
            toSavingsId,
            toBank,
            signature: js_sha512_1.sha512.hex(`${fromAccount}${toAccount}`),
            amount,
            remark,
            transferType: "inter",
            reference
        });
        if (response.data && response.data.status === "00") {
            const data = yield update(user._id, "user_metadata.wallet", String(Number((_a = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) - Number(amount)));
            const transaction = yield createTransaction({
                name: "Withdrawal-" + reference,
                category: "debit",
                type: "transfer",
                user: user._id,
                details: remark,
                transaction_number: response.data.data.txnId || "no-txnId",
                amount,
                bank,
                receiver: toClient,
                account_number: toAccount,
                outstanding: 0.0,
                session_id: response.data.data.sessionId || "no-sessionId",
                status: "success"
            });
            res.status(response.status).json({ status: "success", data: Object.assign(Object.assign({}, response.data.data), { transaction }) });
        }
        res.status(400).json({ status: "failed", message: response.data.message });
    }
    catch (error) {
        console.log("Error making withdrawal:", error);
        next(error);
    }
});
exports.transfer = transfer;
// Function to handle wallet alerts
const walletAlerts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const body = req.body;
        // retrieve all identites linked to a user
        const user = yield find({ "user_metadata.accountNo": body.account_number }, "one");
        console.log({ user, account_number: body.account_number });
        if (!user || Array.isArray(user) || !user._id) {
            return res.status(404).json({
                status: "User not found.",
                data: null
            });
        }
        yield update(user._id, "user_metadata.wallet", String((((_a = user.user_metadata) === null || _a === void 0 ? void 0 : _a.wallet) ? Number((_b = user === null || user === void 0 ? void 0 : user.user_metadata) === null || _b === void 0 ? void 0 : _b.wallet) : 0) + Number(body.amount)));
        // Insert transaction into database
        const data = yield createTransaction({
            name: `Transfer from ${body.originator_account_name}`,
            category: "credit",
            type: "transfer",
            user: user._id,
            details: body.originator_narration,
            transaction_number: String(body.reference),
            amount: Number(Number(body.amount).toFixed(0)),
            account_number: body.originator_account_number,
            bank: body.originator_bank,
            receiver: body.account_number,
            outstanding: 0.0,
            session_id: body.session_id,
            status: "success",
        });
        console.log({ data });
        return res.status(200).json({ status: "Success", data });
    }
    catch (error) {
        console.error("Error handling wallet alerts:", error);
        res.status(400).json({ status: 400, message: error.message });
    }
});
exports.walletAlerts = walletAlerts;
