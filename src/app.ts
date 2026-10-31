import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/environment';
import { requestLogger } from './middlewares/logging.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { notFoundHandler } from './middlewares/not-found.middleware';
import apiRouter from './routes/index';
import healthRoutes from './routes/health.routes';

export const createApp = (): Express => {
  const app = express();

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
    })
  );

  // CORS Configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin) return callback(null, true);

        const allowed = [env.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'];
        if (
          allowed.includes(origin) ||
          origin.endsWith('.vercel.app') ||
          (env.FRONTEND_URL && origin.startsWith(env.FRONTEND_URL))
        ) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'Idempotency-Key']
    })
  );

  // Parsers & Middlewares
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Root Status Endpoint
  app.get('/', (req, res) => {
    res.json({
      status: 'UP',
      message: 'IOTA Partner Portal Backend API is active',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // Base Health Checks
  app.use('/health', healthRoutes);
  app.use('/api/health', healthRoutes);

  // API v1 Router
  app.use('/api/v1', apiRouter);

  // 404 & Error Handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

// Instantiate default application instance
const app = createApp();

// Export as default function/server for Vercel Serverless Function & standard Node.js
export default app;
module.exports = app;
module.exports.createApp = createApp;
module.exports.default = app;


