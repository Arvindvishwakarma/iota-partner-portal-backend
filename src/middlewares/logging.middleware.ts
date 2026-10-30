import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../config/logger';

export interface RequestWithCorrelation extends Request {
  correlationId?: string;
}

export const requestLogger = (req: RequestWithCorrelation, res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl } = req;
    const { statusCode } = res;

    logger.info(`${method} ${originalUrl} ${statusCode} - ${duration}ms`, {
      correlationId,
      statusCode,
      duration
    });
  });

  next();
};

