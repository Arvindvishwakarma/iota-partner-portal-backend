import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/utils/password';
import { generateAccessToken, verifyAccessToken } from '../src/utils/jwt';
import { Role } from '../src/shared';
import { prisma } from '../src/config/prisma';

describe('Password Security Utilities (Argon2id)', () => {
  it('should hash a password and verify it correctly', async () => {
    const rawPassword = 'SecurePassword@2026!';
    const hash = await hashPassword(rawPassword);

    expect(hash).toBeDefined();
    expect(hash.startsWith('$argon2id$')).toBe(true);

    const isMatch = await verifyPassword(rawPassword, hash);
    expect(isMatch).toBe(true);

    const isWrongMatch = await verifyPassword('WrongPassword', hash);
    expect(isWrongMatch).toBe(false);
  });
});

describe('JWT Utilities', () => {
  it('should generate a valid JWT access token and decode claims', () => {
    const payload = {
      userId: 'usr-12345',
      email: 'admin@iotaacademy.in',
      role: Role.ADMIN,
      partnerId: undefined
    };

    const token = generateAccessToken(payload);
    expect(token).toBeDefined();

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.role).toBe(Role.ADMIN);
  });
});

describe('Authentication API & RBAC Guards', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/v1/auth/login validates required fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'invalid-email-format',
      password: '123'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/auth/me rejects requests without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/v1/auth/me rejects requests with malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.value');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('POST /api/v1/auth/logout succeeds even without active cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

