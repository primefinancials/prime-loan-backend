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
exports.MessageService = void 0;
const model_1 = require("../model");
const exceptions_1 = require("../exceptions");
class MessageService {
    create(messageData) {
        return __awaiter(this, void 0, void 0, function* () {
            const newMessage = yield model_1.MessageModel.create(messageData);
            return newMessage;
        });
    }
    ;
    update(uid, updateFields) {
        return __awaiter(this, void 0, void 0, function* () {
            const message = yield model_1.MessageModel.findById(uid);
            if (!message)
                throw new exceptions_1.NotFoundError(`No message found with the id ${uid}`);
            return yield model_1.MessageModel.findByIdAndUpdate(uid, updateFields).then(message => message);
        });
    }
    ;
    fetchAll(limitValue, offsetValue) {
        return __awaiter(this, void 0, void 0, function* () {
            const messages = yield model_1.MessageModel.find().limit(limitValue).skip(offsetValue);
            return messages;
        });
    }
    ;
    find(fields, option) {
        return __awaiter(this, void 0, void 0, function* () {
            if (option === 'one') {
                const message = yield model_1.MessageModel.findOne(fields).exec();
                return message;
            }
            else if (option === 'many') {
                const messages = yield model_1.MessageModel.find(fields).lean();
                if (messages.length < 1)
                    return null;
                return messages;
            }
            ;
        });
    }
    ;
    findById(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const message = yield model_1.MessageModel.findById(uid);
            // if (!message) throw new NotFoundError(`No message found with id ${uid}`)
            return message;
        });
    }
    ;
    countDocuments(countQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const count = yield model_1.MessageModel.countDocuments(countQuery !== null && countQuery !== void 0 ? countQuery : {});
            return count;
        });
    }
    ;
    deleteMessage(uid) {
        return __awaiter(this, void 0, void 0, function* () {
            yield model_1.MessageModel.deleteOne({
                _id: uid,
            });
        });
    }
    ;
}
exports.MessageService = MessageService;
;
