import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { RequestWithCorrelation } from './logging.middleware';

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError | ZodError,
  req: RequestWithCorrelation,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  const correlationId = req.correlationId;

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    const fieldErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      issue: e.message
    }));

    logger.warn(`Validation Error [${correlationId}]:`, { errors: fieldErrors });

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request payload validation failed',
        details: fieldErrors
      }
    });
  }

  // Handle Custom Application Errors
  if (err instanceof AppError) {
    logger.warn(`AppError [${correlationId}] ${err.statusCode} - ${err.code}: ${err.message}`, {
      details: err.details
    });

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  // Unhandled / Unexpected Server Errors
  logger.error(`Unhandled Exception [${correlationId}]: ${err.message}`, {
    stack: err.stack
  });

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected internal error occurred'
          : err.message
    }
  });
};

