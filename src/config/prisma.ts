import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' }
    ]
  });

// Attach logging listeners
// @ts-ignore
prisma.$on('error', (e: any) => {
  logger.error('Prisma Error:', e);
});

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

