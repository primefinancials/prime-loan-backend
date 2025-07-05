import JWT from 'jsonwebtoken';
import { ITokenService, TokenPayload } from '../../core/services/ITokenService';
import { ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET } from '../../config';
import { ACCESS_TOKEN_EXPIRES_IN, REFRESH_TOKEN_EXPIRES } from '../../constants';

export class JwtTokenService implements ITokenService {
  generateAccessToken(payload: TokenPayload): string {
    return JWT.sign(payload, String(ACCESS_TOKEN_SECRET), {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  }

  generateRefreshToken(payload: TokenPayload): string {
    return JWT.sign(payload, String(REFRESH_TOKEN_SECRET), {
      expiresIn: REFRESH_TOKEN_EXPIRES,
    });
  }

  verifyAccessToken(token: string): TokenPayload {
    return JWT.verify(token, String(ACCESS_TOKEN_SECRET)) as TokenPayload;
  }

  verifyRefreshToken(token: string): TokenPayload {
    return JWT.verify(token, String(REFRESH_TOKEN_SECRET)) as TokenPayload;
  }
}