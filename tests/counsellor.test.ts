import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { Role, LeadStatus, LeadActivityType } from '../src/shared';

describe('Counselor CRM Module API & Security Guards', () => {
  const app = createApp();

  const counsellorToken = generateAccessToken({
    userId: 'counsellor-test-user-id',
    email: 'counsellor@iotaacademy.in',
    role: Role.COUNSELLOR
  });

  const partnerToken = generateAccessToken({
    userId: 'partner-test-user-id',
    email: 'partner@iotaacademy.in',
    role: Role.PARTNER,
    partnerId: 'partner-123'
  });

  const salesToken = generateAccessToken({
    userId: 'sales-test-user-id',
    email: 'sales@iotaacademy.in',
    role: Role.SALES
  });

  it('GET /api/v1/counsellor/dashboard blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/counsellor/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/v1/counsellor/dashboard blocks Partner role requests (403)', async () => {
    const res = await request(app)
      .get('/api/v1/counsellor/dashboard')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/v1/counsellor/dashboard blocks Sales role requests (403)', async () => {
    const res = await request(app)
      .get('/api/v1/counsellor/dashboard')
      .set('Authorization', `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /api/v1/counsellor/leads/:id/activities validates required activityType and remarks', async () => {
    const res = await request(app)
      .post('/api/v1/counsellor/leads/test-lead-id/activities')
      .set('Authorization', `Bearer ${counsellorToken}`)
      .send({
        activityType: 'INVALID_TYPE',
        remarks: ''
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH /api/v1/counsellor/leads/:id/status requires mandatory reason when marking as LOST', async () => {
    const res = await request(app)
      .patch('/api/v1/counsellor/leads/test-lead-id/status')
      .set('Authorization', `Bearer ${counsellorToken}`)
      .send({
        status: LeadStatus.LOST
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /api/v1/counsellor/leads/:id/convert-admission validates that paidFee cannot exceed totalFee', async () => {
    const res = await request(app)
      .post('/api/v1/counsellor/leads/test-lead-id/convert-admission')
      .set('Authorization', `Bearer ${counsellorToken}`)
      .send({
        courseId: 'f87a87e8-466d-4952-ba78-2d2d0cbbcf61',
        totalFee: 45000,
        paidFee: 50000, // exceeds total fee
        paymentMode: 'UPI'
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

