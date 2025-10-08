/**
 * Idempotency Middleware - Prevents duplicate operations
 * Checks for existing operations and returns cached responses
 */
import { Request, Response, NextFunction } from 'express';
import { IdempotencyKey } from './model';
import { ProtectedRequest } from '../../interfaces';

export const idempotencyMiddleware = () => {
  return async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    
    if (!idempotencyKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Idempotency-Key header is required for this operation'
      });
    }

    try {
      // Check if we've seen this key before
      const existingKey = await IdempotencyKey.findOne({ 
        key: idempotencyKey,
        userId: req.user?._id 
      });

      console.log({ existingKey })

      if (existingKey) {
        // Return cached response
        return res.status(200).json(existingKey.response);
      }

      // Store the key and userId for later use
      req.idempotencyKey = idempotencyKey;
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const saveIdempotentResponse = async (
  idempotencyKey: string,
  userId: string | undefined,
  response: any
) => {
  await IdempotencyKey.create({
    key: idempotencyKey,
    userId,
    response,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  });
};