import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { Role, PartnerStatus } from '../src/shared';

describe('Admin Management Module API & Security', () => {
  const app = createApp();

  const adminToken = generateAccessToken({
    userId: 'admin-usr-1',
    email: 'admin@iotaacademy.in',
    role: Role.ADMIN
  });

  const salesToken = generateAccessToken({
    userId: 'sales-usr-2',
    email: 'sales@iotaacademy.in',
    role: Role.SALES
  });

  const counsellorToken = generateAccessToken({
    userId: 'counsellor-usr-3',
    email: 'counsellor@iotaacademy.in',
    role: Role.COUNSELLOR
  });

  it('GET /api/v1/admin/dashboard blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/admin/dashboard blocks Sales role requests (403)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${salesToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/v1/admin/dashboard blocks Counselor role requests (403)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${counsellorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /api/v1/admin/staff validates email format and required role', async () => {
    const res = await request(app)
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Test Staff',
        email: 'invalid-email',
        phone: '123'
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH /api/v1/admin/partners/:id/review enforces mandatory rejection reason', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/partners/test-id/review')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: PartnerStatus.REJECTED
        // Missing rejectionReason
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

