import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

const customFormat = printf(({ level, message, timestamp, correlationId, ...meta }) => {
  const cid = correlationId ? `[${correlationId}] ` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${cid}${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    process.env.NODE_ENV === 'production' ? json() : customFormat
  ),
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' 
        ? json() 
        : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), customFormat)
    })
  ]
});

