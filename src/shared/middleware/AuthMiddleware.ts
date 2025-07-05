import { Request, Response, NextFunction } from 'express';
import { ITokenService } from '../../core/services/ITokenService';
import { IUserRepository } from '../../core/repositories/IUserRepository';
import { UnauthorizedError } from '../errors/AppError';

export interface AuthenticatedRequest extends Request {
  user?: any;
  admin?: any;
}

export class AuthMiddleware {
  constructor(
    private tokenService: ITokenService,
    private userRepository: IUserRepository
  ) {}

  authenticate() {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { authorization } = req.headers;

        if (!authorization) {
          throw new UnauthorizedError('No authorization headers passed');
        }

        const [bearer, token] = authorization.split(' ');

        if (!bearer || !token || bearer !== 'Bearer') {
          throw new UnauthorizedError('Invalid authorization format');
        }

        const decoded = this.tokenService.verifyAccessToken(token);
        const user = await this.userRepository.findById(decoded.id);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        if (decoded.accountType === 'user') {
          req.user = user;
        } else if (decoded.accountType === 'admin') {
          req.admin = user;
        } else {
          throw new UnauthorizedError('Invalid account type');
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }
}