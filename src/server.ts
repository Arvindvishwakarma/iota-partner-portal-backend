import app from './app';
import { env } from './config/environment';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

// Only start listening if NOT in a serverless environment (e.g., local development)
if (!process.env.VERCEL) {
  const PORT = env.PORT || 5000;

  const server = app.listen(PORT, () => {
    logger.info(`🚀 IOTA Partner Portal Backend running on http://localhost:${PORT}`);
    logger.info(`Environment: ${env.NODE_ENV} | Frontend: ${env.FRONTEND_URL}`);
  });

  // Graceful Shutdown
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    server.close(async () => {
      logger.info('HTTP server closed.');
      try {
        await prisma.$disconnect();
        logger.info('Database connection pool disconnected.');
      } catch (err) {
        logger.error('Error disconnecting database:', err);
      }
      process.exit(0);
    });

    // Force shutdown after 10 seconds if hanging
    setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcing termination.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

export default app;
module.exports = app;
