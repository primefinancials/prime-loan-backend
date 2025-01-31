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
exports.UserService = void 0;
const model_1 = require("../model");
const exceptions_1 = require("../exceptions");
class UserService {
    create(userData) {
        return __awaiter(this, void 0, void 0, function* () {
            const newUser = yield model_1.UserModel.create(userData);
            return newUser;
        });
    }
    ;
    update(uid, updateFields, data) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield model_1.UserModel.findById(uid);
            if (!user)
                throw new exceptions_1.NotFoundError(`No user found with the id ${uid}`);
            const updatedUser = yield model_1.UserModel.findByIdAndUpdate(uid, { $set: { [updateFields]: data } }, { new: true }); // Ensures the updated document is returned);
            return updatedUser;
        });
    }
    ;
    fetchAll(limitValue, offsetValue) {
        return __awaiter(this, void 0, void 0, function* () {
            const users = yield model_1.UserModel.find().limit(limitValue).skip(offsetValue);
            return users;
        });
    }
    ;
    find(fields, option) {
        return __awaiter(this, void 0, void 0, function* () {
            if (option === 'one') {
                const user = yield model_1.UserModel.findOne(fields).exec();
                return user;
            }
            else if (option === 'many') {
                const users = yield model_1.UserModel.find(fields).lean();
                if (users.length < 1)
                    return null;
                return users;
            }
            ;
        });
    }
    ;
    findById(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield model_1.UserModel.findById(uid);
            // if (!user) throw new NotFoundError(`No user found with id ${uid}`)
            return user;
        });
    }
    ;
    findByEmail(email) {
        return __awaiter(this, void 0, void 0, function* () {
            const foundUser = yield model_1.UserModel.findOne({ email }).exec();
            return foundUser;
        });
    }
    ;
    findByRefreshToken(refreshToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const foundUser = yield model_1.UserModel.findOne({
                refresh_tokens: refreshToken,
            });
            return foundUser;
        });
    }
    ;
    countDocuments(countQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const count = yield model_1.UserModel.countDocuments(countQuery !== null && countQuery !== void 0 ? countQuery : {});
            return count;
        });
    }
    ;
    appendRefreshToken(uid, refreshToken) {
        return __awaiter(this, void 0, void 0, function* () {
            yield model_1.UserModel.updateOne({ _id: uid, }, { $push: { refresh_tokens: refreshToken }, }).exec();
        });
    }
    ;
    deleteRefreshToken(uid, refreshToken) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield model_1.UserModel.updateOne({ _id: uid, }, { $pull: { refresh_tokens: refreshToken, }, }, { new: true, }).exec();
        });
    }
    ;
    deleteUser(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            yield model_1.UserModel.deleteOne({ _id: uid, });
        });
    }
    ;
}
exports.UserService = UserService;
;
