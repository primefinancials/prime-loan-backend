"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class BaseException extends Error {
    constructor(message) {
        super(message);
        this.message = "";
        this.isGaxiosError = () => "GaxiosError" === this.error.constructor.name;
        this.isNetworkError = () => this.error.message.includes("getaddrinfo");
    }
    refineException(error) {
        this.error = error;
        return this;
    }
}
exports.default = BaseException;
