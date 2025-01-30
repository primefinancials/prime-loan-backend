import "dotenv/config";
import { NextFunction, RequestHandler, Response } from "express";
import JWT from "jsonwebtoken";
import { UnauthorizedError } from '../exceptions'
import { UserService } from '../services'
import { ACCESS_TOKEN_SECRET } from '../config';
import { ProtectedRequest } from '../interfaces';

const {
  findById
} = new UserService()

export default function (): RequestHandler {
  return async (req: ProtectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { authorization } = req.headers

      if (!authorization) throw new UnauthorizedError(`No authorization headers passed`)

      const bearer = authorization.split(" ")[0]
      const token = authorization.split(" ")[1]

      if (!bearer || !token) throw new UnauthorizedError(`Token not passed in authorization headers`)

      if (bearer !== "Bearer") throw new UnauthorizedError(`Bearer not passed in authorization headers`)

      const decoded: any = JWT.verify(token, String(ACCESS_TOKEN_SECRET))
      
      if (decoded.accountType === 'user') {
          const user = await findById(decoded.id)
          if(!user) throw new UnauthorizedError(`User recently deleted.`)
          req.user = user
      } else if (decoded.accountType === 'admin') {
        const admin = await findById(decoded.id)
        if(!admin) throw new UnauthorizedError(`Admin recently deleted.`)
        req.admin = admin;
      } else throw new UnauthorizedError();
      next()

    } catch(err: any) {
      next(err)
    }
  }
}

