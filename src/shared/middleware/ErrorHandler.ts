import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
    });
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token',
    });
  }

  // Handle Axios errors
  if ((error as any).isAxiosError) {
    const axiosError = error as any;
    if (axiosError.code === 'ECONNREFUSED') {
      return res.status(503).json({
        status: 'error',
        message: 'Service unavailable',
      });
    }
    if (axiosError.response) {
      return res.status(axiosError.response.status).json({
        status: 'error',
        message: axiosError.response.data.message || 'External service error',
      });
    }
  }

  // Log unexpected errors
  console.error('Unexpected error:', error);

  return res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
};