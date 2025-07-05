import { Request, Response, NextFunction } from 'express';
import { CreateUserUseCase } from '../../core/use-cases/user/CreateUserUseCase';
import { AuthenticateUserUseCase } from '../../core/use-cases/user/AuthenticateUserUseCase';
import { createUserSchema, loginSchema } from '../../shared/validation/ValidationSchemas';
import { AuthenticatedRequest } from '../../shared/middleware/AuthMiddleware';

export class UserController {
  constructor(
    private createUserUseCase: CreateUserUseCase,
    private authenticateUserUseCase: AuthenticateUserUseCase
  ) {}

  async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = createUserSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          message: error.details[0].message,
        });
      }

      const result = await this.createUserUseCase.execute({
        email: value.email,
        name: value.name,
        surname: value.surname,
        password: value.password,
        phone: value.phone,
        bvn: value.bvn,
        nin: value.nin,
        dateOfBirth: value.dob,
      });

      res.status(201).json({
        status: 'success',
        data: {
          user: result.user,
          accountData: result.accountData,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          message: error.details[0].message,
        });
      }

      const result = await this.authenticateUserUseCase.execute({
        email: value.email,
        password: value.password,
      });

      res
        .cookie('jwt', result.refreshToken, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000 * 182, // 6 months
        })
        .status(200)
        .json({
          status: 'success',
          data: {
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
          },
        });
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = req.user || req.admin;
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'Unauthorized',
        });
      }

      res.status(200).json({
        status: 'success',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }
}