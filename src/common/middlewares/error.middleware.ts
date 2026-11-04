import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors';
import { ApiResponse } from '../utils/api-response.util';
import { logger } from '../../config/logger.config';
import { env } from '../../config/env.config';

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): Response => {
  // 1. AppError (Custom handled operational errors)
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`[${req.method} ${req.originalUrl}] Operational Server Error: ${err.message}`, { stack: err.stack });
    } else {
      logger.warn(`[${req.method} ${req.originalUrl}] ${err.statusCode} - ${err.message}`);
    }

    return ApiResponse.error(res, err.message, err.statusCode, err.details);
  }

  // 2. Prisma Known Request Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.warn(`[Prisma Known Error] Code: ${err.code} | Message: ${err.message}`);

    // P2002: Unique constraint failed
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[]) || [];
      return ApiResponse.error(
        res,
        `Duplicate record error: A record with this ${target.join(', ')} already exists.`,
        409
      );
    }

    // P2025: Record to update not found
    if (err.code === 'P2025') {
      return ApiResponse.error(res, 'The requested record was not found.', 404);
    }

    // P2003: Foreign key constraint failed
    if (err.code === 'P2003') {
      return ApiResponse.error(res, 'Invalid relational reference: Related entity does not exist.', 400);
    }
  }

  // 3. Unhandled Unexpected Server Errors (500)
  logger.error(`[Unhandled Error] [${req.method} ${req.originalUrl}] ${err.message}`, {
    stack: err.stack,
  });

  const responseMessage =
    env.NODE_ENV === 'production' ? 'An unexpected internal server error occurred.' : err.message;

  return ApiResponse.error(
    res,
    responseMessage,
    500,
    env.NODE_ENV === 'development' ? { stack: err.stack } : undefined
  );
};

export const notFoundHandler = (req: Request, res: Response): Response => {
  return ApiResponse.error(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
};

