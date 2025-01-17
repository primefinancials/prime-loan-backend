"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERequestFileQuantity = exports.ERequestFileQuality = exports.ERequestFileType = exports.EResponseStatus = exports.EDeviceStatus = exports.EUserStatus = exports.EStatusCode = void 0;
var EUserStatus;
(function (EUserStatus) {
    EUserStatus["ACTIVE"] = "active";
    EUserStatus["PENDING"] = "pending";
})(EUserStatus || (exports.EUserStatus = EUserStatus = {}));
;
var EDeviceStatus;
(function (EDeviceStatus) {
    EDeviceStatus["ACTIVE"] = "active";
    EDeviceStatus["PENDING"] = "pending";
})(EDeviceStatus || (exports.EDeviceStatus = EDeviceStatus = {}));
;
// Helper code for the API consumer to understand the error and handle it accordingly
var EStatusCode;
(function (EStatusCode) {
    EStatusCode["OK"] = "10000";
    EStatusCode["CREATED"] = "10001";
    EStatusCode["NO_CONTENT"] = "10002";
    EStatusCode["FAILURE"] = "10003";
    EStatusCode["RETRY"] = "10004";
    EStatusCode["INVALID_ACCESS_TOKEN"] = "10005";
})(EStatusCode || (exports.EStatusCode = EStatusCode = {}));
;
// Response status codes
var EResponseStatus;
(function (EResponseStatus) {
    EResponseStatus[EResponseStatus["OK"] = 200] = "OK";
    EResponseStatus[EResponseStatus["CREATED"] = 201] = "CREATED";
    EResponseStatus[EResponseStatus["NO_CONTENT"] = 204] = "NO_CONTENT";
    EResponseStatus[EResponseStatus["BAD_REQUEST"] = 400] = "BAD_REQUEST";
    EResponseStatus[EResponseStatus["UN_AUTHORISED"] = 401] = "UN_AUTHORISED";
    EResponseStatus[EResponseStatus["FORBIDDEN"] = 403] = "FORBIDDEN";
    EResponseStatus[EResponseStatus["NOT_FOUND"] = 404] = "NOT_FOUND";
    EResponseStatus[EResponseStatus["NO_ENTRY"] = 404] = "NO_ENTRY";
    EResponseStatus[EResponseStatus["CONFLICT"] = 409] = "CONFLICT";
    EResponseStatus[EResponseStatus["ENTITY_TOO_LARGE"] = 413] = "ENTITY_TOO_LARGE";
    EResponseStatus[EResponseStatus["UNPROCESSABLE_ENTITY"] = 422] = "UNPROCESSABLE_ENTITY";
    EResponseStatus[EResponseStatus["RATE_LIMIT_EXCEEDED"] = 429] = "RATE_LIMIT_EXCEEDED";
    EResponseStatus[EResponseStatus["INTERNAL_ERROR"] = 500] = "INTERNAL_ERROR";
})(EResponseStatus || (exports.EResponseStatus = EResponseStatus = {}));
;
var ERequestFileType;
(function (ERequestFileType) {
    ERequestFileType["IMAGE"] = "image";
    ERequestFileType["VIDEO"] = "video";
    ERequestFileType["AUDIO"] = "audio";
    ERequestFileType["DOCUMENT"] = "document";
    ERequestFileType["OTHER"] = "other";
})(ERequestFileType || (exports.ERequestFileType = ERequestFileType = {}));
;
var ERequestFileQuality;
(function (ERequestFileQuality) {
    ERequestFileQuality["LOW"] = "low";
    ERequestFileQuality["MEDIUM"] = "medium";
    ERequestFileQuality["HIGH"] = "high";
})(ERequestFileQuality || (exports.ERequestFileQuality = ERequestFileQuality = {}));
;
var ERequestFileQuantity;
(function (ERequestFileQuantity) {
    ERequestFileQuantity["SINGLE"] = "single";
    ERequestFileQuantity["MULTIPLE"] = "multiple";
})(ERequestFileQuantity || (exports.ERequestFileQuantity = ERequestFileQuantity = {}));
;
