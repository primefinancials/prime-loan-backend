"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitExceededErrorResponse = exports.NoContentResponse = exports.RefreshTokenErrorResponse = exports.FilesizeErrorResponse = exports.TokenRefreshResponse = exports.SuccessResponse = exports.SuccessMsgResponse = exports.TokenExpiredErrorResponse = exports.NotFoundErrorResponse = exports.NoEntryErrorResponse = exports.InternalServerErrorResponse = exports.ForbiddenErrorResponse = exports.FailureMsgResponse = exports.DeleteSuccessMsgResponse = exports.CreateSuccessResponse = exports.CreateSuccessMsgResponse = exports.UnprocessableEntityErrorResponse = exports.ConflictErrorResponse = exports.BadTokenErrorResponse = exports.BadRequestResponse = exports.BadRequestErrorResponse = exports.UnauthorizedErrorResponse = exports.UnknownPolicyMethod = exports.PermissionErrorResponse = exports.AuthFailureResponse = exports.AccessTokenErrorResponse = exports.ApiResponse = void 0;
const enums_1 = require("../enums");
class ApiResponse {
    constructor(statusCode, status, message, data = {}) {
        this.statusCode = statusCode;
        this.status = status;
        this.message = message;
        this.data = data;
    }
    ;
    prepare(res, response, headers) {
        for (const [key, value] of Object.entries(headers))
            res.append(key, value);
        return res.status(this.status).json(ApiResponse.sanitize(response));
    }
    ;
    send(res, headers = {}) {
        return this.prepare(res, this, headers);
    }
    ;
    static sanitize(response) {
        const clone = {};
        Object.assign(clone, response);
        // @ts-ignore
        delete clone.status;
        for (const i in clone)
            if (typeof clone[i] === 'undefined')
                delete clone[i];
        return clone;
    }
    ;
}
exports.ApiResponse = ApiResponse;
;
class AccessTokenErrorResponse extends ApiResponse {
    constructor(message = 'Access token invalid') {
        super(enums_1.EStatusCode.INVALID_ACCESS_TOKEN, enums_1.EResponseStatus.BAD_REQUEST, message);
        this.instruction = 'refresh_token';
    }
    ;
    send(res, headers = {}) {
        headers.instruction = this.instruction;
        return super.prepare(res, this, headers);
    }
    ;
}
exports.AccessTokenErrorResponse = AccessTokenErrorResponse;
;
class AuthFailureResponse extends ApiResponse {
    constructor(message = 'Authentication Failure') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.UN_AUTHORISED, message);
    }
    ;
}
exports.AuthFailureResponse = AuthFailureResponse;
;
class PermissionErrorResponse extends ApiResponse {
    constructor(message = 'You are not allowed to perform this action', data) {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.UN_AUTHORISED, message, data);
    }
    ;
}
exports.PermissionErrorResponse = PermissionErrorResponse;
;
class UnknownPolicyMethod extends ApiResponse {
    constructor(message = 'The policy method you are trying to call does not exist') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.INTERNAL_ERROR, message);
    }
    ;
}
exports.UnknownPolicyMethod = UnknownPolicyMethod;
;
class UnauthorizedErrorResponse extends ApiResponse {
    constructor(message = 'Unathorized') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.UN_AUTHORISED, message);
    }
}
exports.UnauthorizedErrorResponse = UnauthorizedErrorResponse;
class BadRequestErrorResponse extends ApiResponse {
    constructor(message = 'Bad Parameters', data) {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.BAD_REQUEST, message, data);
    }
    ;
}
exports.BadRequestErrorResponse = BadRequestErrorResponse;
;
class BadRequestResponse extends ApiResponse {
    constructor(message = 'Bad Parameters', data) {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.BAD_REQUEST, message, data);
    }
    ;
}
exports.BadRequestResponse = BadRequestResponse;
;
class BadTokenErrorResponse extends ApiResponse {
    constructor(message = 'Bad Token Provided') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.BAD_REQUEST, message);
    }
    ;
}
exports.BadTokenErrorResponse = BadTokenErrorResponse;
;
class ConflictErrorResponse extends ApiResponse {
    constructor(message = 'Conflict') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.BAD_REQUEST, message);
    }
    ;
}
exports.ConflictErrorResponse = ConflictErrorResponse;
;
class UnprocessableEntityErrorResponse extends ApiResponse {
    constructor(message = 'Unprocessable Entity', data) {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.UNPROCESSABLE_ENTITY, message, data);
    }
    ;
}
exports.UnprocessableEntityErrorResponse = UnprocessableEntityErrorResponse;
;
class CreateSuccessMsgResponse extends ApiResponse {
    constructor(message) {
        super(enums_1.EStatusCode.CREATED, enums_1.EResponseStatus.CREATED, message);
    }
    ;
}
exports.CreateSuccessMsgResponse = CreateSuccessMsgResponse;
;
class CreateSuccessResponse extends ApiResponse {
    constructor(message, data) {
        super(enums_1.EStatusCode.CREATED, enums_1.EResponseStatus.CREATED, message, data);
    }
    ;
    send(res, headers = {}) {
        return super.prepare(res, this, headers);
    }
    ;
}
exports.CreateSuccessResponse = CreateSuccessResponse;
;
class DeleteSuccessMsgResponse extends ApiResponse {
    constructor(message) {
        super(enums_1.EStatusCode.NO_CONTENT, enums_1.EResponseStatus.NO_CONTENT, message);
    }
    ;
}
exports.DeleteSuccessMsgResponse = DeleteSuccessMsgResponse;
;
class FailureMsgResponse extends ApiResponse {
    constructor(message) {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.OK, message);
    }
    ;
}
exports.FailureMsgResponse = FailureMsgResponse;
;
class ForbiddenErrorResponse extends ApiResponse {
    constructor(message = 'Forbidden') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.FORBIDDEN, message);
    }
    ;
}
exports.ForbiddenErrorResponse = ForbiddenErrorResponse;
;
class InternalServerErrorResponse extends ApiResponse {
    constructor(message = 'Internal Error') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.INTERNAL_ERROR, message);
    }
    ;
}
exports.InternalServerErrorResponse = InternalServerErrorResponse;
;
class NoEntryErrorResponse extends ApiResponse {
    constructor(message = 'Entry does not exists') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.NO_ENTRY, message);
    }
    ;
    send(res, headers = {}) {
        return super.prepare(res, this, headers);
    }
    ;
}
exports.NoEntryErrorResponse = NoEntryErrorResponse;
;
class NotFoundErrorResponse extends ApiResponse {
    constructor(message = 'Not Found') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.NOT_FOUND, message);
    }
    ;
    send(res, headers = {}) {
        return super.prepare(res, this, headers);
    }
    ;
}
exports.NotFoundErrorResponse = NotFoundErrorResponse;
;
class TokenExpiredErrorResponse extends ApiResponse {
    constructor(message = 'Token expired!') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.FORBIDDEN, message);
    }
    ;
}
exports.TokenExpiredErrorResponse = TokenExpiredErrorResponse;
;
class SuccessMsgResponse extends ApiResponse {
    constructor(message) {
        super(enums_1.EStatusCode.OK, enums_1.EResponseStatus.OK, message);
    }
    ;
}
exports.SuccessMsgResponse = SuccessMsgResponse;
;
class SuccessResponse extends ApiResponse {
    constructor(message, data = null) {
        super(enums_1.EStatusCode.OK, enums_1.EResponseStatus.OK, message, data);
    }
    ;
    send(res, headers = {}) {
        return super.prepare(res, this, headers);
    }
    ;
}
exports.SuccessResponse = SuccessResponse;
;
class TokenRefreshResponse extends ApiResponse {
    constructor(message, accessToken, refreshToken) {
        super(enums_1.EStatusCode.OK, enums_1.EResponseStatus.OK, message);
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
    }
    ;
    send(res, headers = {}) {
        return super.prepare(res, this, headers);
    }
    ;
}
exports.TokenRefreshResponse = TokenRefreshResponse;
;
class FilesizeErrorResponse extends ApiResponse {
    constructor(message = 'File size exceeds limit!') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.ENTITY_TOO_LARGE, message);
    }
    ;
}
exports.FilesizeErrorResponse = FilesizeErrorResponse;
;
class RefreshTokenErrorResponse extends ApiResponse {
    constructor(message = 'Invalid refresh token') {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.BAD_REQUEST, message);
    }
    ;
}
exports.RefreshTokenErrorResponse = RefreshTokenErrorResponse;
;
class NoContentResponse extends ApiResponse {
    constructor() {
        super(enums_1.EStatusCode.NO_CONTENT, enums_1.EResponseStatus.NO_CONTENT, 'No Content');
    }
    ;
}
exports.NoContentResponse = NoContentResponse;
;
class RateLimitExceededErrorResponse extends ApiResponse {
    constructor(message = `Too many requests. Please try again later.`) {
        super(enums_1.EStatusCode.FAILURE, enums_1.EResponseStatus.RATE_LIMIT_EXCEEDED, message);
    }
    ;
    send(res, headers = {}) {
        return super.prepare(res, this, headers);
    }
    ;
}
exports.RateLimitExceededErrorResponse = RateLimitExceededErrorResponse;
;
