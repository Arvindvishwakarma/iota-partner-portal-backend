import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),

  // Optional Third-Party Services
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(''),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(''),

  EMAIL_HOST: z.string().optional().default(''),
  EMAIL_PORT: z.string().optional().default('587').transform((v) => parseInt(v, 10)),
  EMAIL_USER: z.string().optional().default(''),
  EMAIL_PASSWORD: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('IOTA Academy <noreply@iotaacademy.in>'),

  FILE_STORAGE_PROVIDER: z.enum(['local', 's3', 'r2']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads')
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  const formatted = JSON.stringify(parseResult.error.format(), null, 2);
  console.error('❌ Invalid backend environment configuration:', formatted);
  throw new Error(`Invalid backend environment configuration. Missing or invalid variables in Vercel settings: ${formatted}`);
}

export const env = parseResult.data;

