import { Response, } from 'express';
import { EStatusCode, EResponseStatus, } from '../enums';

export abstract class ApiResponse {
  constructor(
    protected statusCode: EStatusCode,
    protected status: EResponseStatus,
    protected message: string,
    protected data: any = {}
  ) { };

  protected prepare<T extends ApiResponse>(
    res: Response,
    response: T,
    headers: { [key: string]: string },
  ): Response {
    for (const [key, value] of Object.entries(headers)) res.append(key, value);
    return res.status(this.status).json(ApiResponse.sanitize(response));
  };

  public send(
    res: Response,
    headers: { [key: string]: string } = {},
  ): Response {
    return this.prepare<ApiResponse>(res, this, headers);
  };

  private static sanitize<T extends ApiResponse>(response: T): T {
    const clone: T = {} as T;
    Object.assign(clone, response);
    // @ts-ignore
    delete clone.status;
    for (const i in clone) if (typeof clone[i] === 'undefined') delete clone[i];
    return clone;
  };
};

export class AccessTokenErrorResponse extends ApiResponse {
  private instruction = 'refresh_token';

  constructor(message = 'Access token invalid') {
    super(
      EStatusCode.INVALID_ACCESS_TOKEN,
      EResponseStatus.BAD_REQUEST,
      message,
    );
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    headers.instruction = this.instruction;
    return super.prepare<AccessTokenErrorResponse>(res, this, headers);
  };
};

export class AuthFailureResponse extends ApiResponse {
  constructor(message = 'Authentication Failure') {
    super(EStatusCode.FAILURE, EResponseStatus.UN_AUTHORISED, message);
  };
};

export class PermissionErrorResponse<T> extends ApiResponse {
  constructor(message = 'You are not allowed to perform this action', data?: T) {
    super(EStatusCode.FAILURE, EResponseStatus.UN_AUTHORISED, message, data);
  };
};

export class UnknownPolicyMethod extends ApiResponse {
  constructor(message = 'The policy method you are trying to call does not exist') {
    super(EStatusCode.FAILURE, EResponseStatus.INTERNAL_ERROR, message);
  };
};

export class UnauthorizedErrorResponse extends ApiResponse {
  constructor(message = 'Unathorized') {
    super(EStatusCode.FAILURE, EResponseStatus.UN_AUTHORISED, message);
  }
}

export class BadRequestErrorResponse<T> extends ApiResponse {
  constructor(message = 'Bad Parameters', data?: T) {
    super(EStatusCode.FAILURE, EResponseStatus.BAD_REQUEST, message, data);
  };
};

export class BadRequestResponse<T> extends ApiResponse {
  constructor(message = 'Bad Parameters', data: T) {
    super(EStatusCode.FAILURE, EResponseStatus.BAD_REQUEST, message, data);
  };
};

export class BadTokenErrorResponse extends ApiResponse {
  constructor(message = 'Bad Token Provided') {
    super(EStatusCode.FAILURE, EResponseStatus.BAD_REQUEST, message);
  };
};

export class ConflictErrorResponse extends ApiResponse {
  constructor(message = 'Conflict') {
    super(EStatusCode.FAILURE, EResponseStatus.BAD_REQUEST, message);
  };
};

export class UnprocessableEntityErrorResponse<T> extends ApiResponse {
  constructor(message = 'Unprocessable Entity', data?: T) {
    super(EStatusCode.FAILURE, EResponseStatus.UNPROCESSABLE_ENTITY, message, data);
  };
};

export class CreateSuccessMsgResponse extends ApiResponse {
  constructor(message: string) {
    super(EStatusCode.CREATED, EResponseStatus.CREATED, message);
  };
};

export class CreateSuccessResponse<T> extends ApiResponse {
  constructor(message: string, data: T) {
    super(EStatusCode.CREATED, EResponseStatus.CREATED, message, data);
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    return super.prepare<CreateSuccessResponse<T>>(res, this, headers);
  };
};

export class DeleteSuccessMsgResponse extends ApiResponse {
  constructor(message: string) {
    super(EStatusCode.NO_CONTENT, EResponseStatus.NO_CONTENT, message);
  };
};

export class FailureMsgResponse extends ApiResponse {
  constructor(message: string) {
    super(EStatusCode.FAILURE, EResponseStatus.OK, message);
  };
};

export class ForbiddenErrorResponse extends ApiResponse {
  constructor(message = 'Forbidden') {
    super(EStatusCode.FAILURE, EResponseStatus.FORBIDDEN, message);
  };
};

export class InternalServerErrorResponse extends ApiResponse {
  constructor(message = 'Internal Error') {
    super(EStatusCode.FAILURE, EResponseStatus.INTERNAL_ERROR, message);
  };
};

export class NoEntryErrorResponse extends ApiResponse {
  constructor(message = 'Entry does not exists') {
    super(EStatusCode.FAILURE, EResponseStatus.NO_ENTRY, message);
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    return super.prepare<NotFoundErrorResponse>(res, this, headers);
  };
};

export class NotFoundErrorResponse extends ApiResponse {
  constructor(message = 'Not Found') {
    super(EStatusCode.FAILURE, EResponseStatus.NOT_FOUND, message);
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    return super.prepare<NotFoundErrorResponse>(res, this, headers);
  };
};


export class TokenExpiredErrorResponse extends ApiResponse {
  constructor(message = 'Token expired!') {
    super(EStatusCode.FAILURE, EResponseStatus.FORBIDDEN, message);
  };
};

export class SuccessMsgResponse extends ApiResponse {
  constructor(message: string) {
    super(EStatusCode.OK, EResponseStatus.OK, message);
  };
};

export class SuccessResponse<T> extends ApiResponse {
  constructor(message: string, data: T | null = null) {
    super(EStatusCode.OK, EResponseStatus.OK, message, data);
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    return super.prepare<SuccessResponse<T>>(res, this, headers);
  };
};

export class TokenRefreshResponse extends ApiResponse {
  constructor(
    message: string,
    private accessToken: string,
    private refreshToken: string,
  ) {
    super(EStatusCode.OK, EResponseStatus.OK, message);
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    return super.prepare<TokenRefreshResponse>(res, this, headers);
  };
};

export class FilesizeErrorResponse extends ApiResponse {
  constructor(message = 'File size exceeds limit!') {
    super(EStatusCode.FAILURE, EResponseStatus.ENTITY_TOO_LARGE, message);
  };
};

export class RefreshTokenErrorResponse extends ApiResponse {
  constructor(message = 'Invalid refresh token') {
    super(EStatusCode.FAILURE, EResponseStatus.BAD_REQUEST, message);
  };
};

export class NoContentResponse extends ApiResponse {
  constructor() {
    super(EStatusCode.NO_CONTENT, EResponseStatus.NO_CONTENT, 'No Content');
  };
};

export class RateLimitExceededErrorResponse extends ApiResponse {
  constructor(message = `Too many requests. Please try again later.`) {
    super(EStatusCode.FAILURE, EResponseStatus.RATE_LIMIT_EXCEEDED, message);
  };

  send(res: Response, headers: { [key: string]: string } = {}): Response {
    return super.prepare<RateLimitExceededErrorResponse>(res, this, headers);
  };
};