import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { Role, VisitStatus, PartnerCategory } from '../src/shared';
import { calculateHaversineDistanceMeters } from '../src/services/sales.service';

describe('Haversine Distance Calculator Utility', () => {
  it('calculates accurate distance between known coordinates within meters', () => {
    // Indiranagar Metro (12.9784, 77.6408) to MG Road Metro (12.9756, 77.6066) ~ 3.7 km
    const distance = calculateHaversineDistanceMeters(12.9784, 77.6408, 12.9756, 77.6066);
    expect(distance).toBeGreaterThan(3500);
    expect(distance).toBeLessThan(3900);
  });

  it('returns 0 for identical coordinates', () => {
    const distance = calculateHaversineDistanceMeters(12.9784, 77.6408, 12.9784, 77.6408);
    expect(distance).toBe(0);
  });
});

describe('Field Sales Module API & Proximity Guards', () => {
  const app = createApp();

  const salesToken = generateAccessToken({
    userId: 'sales-test-user-id',
    email: 'sales@iotaacademy.in',
    role: Role.SALES
  });

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

  it('GET /api/v1/sales/dashboard blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/sales/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/v1/sales/dashboard blocks Partner role requests (403)', async () => {
    const res = await request(app)
      .get('/api/v1/sales/dashboard')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/v1/sales/dashboard blocks Counselor role requests (403)', async () => {
    const res = await request(app)
      .get('/api/v1/sales/dashboard')
      .set('Authorization', `Bearer ${counsellorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /api/v1/sales/visits/:premisesId/check-in validates GPS coordinate format', async () => {
    const res = await request(app)
      .post('/api/v1/sales/visits/test-premises-id/check-in')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        latitude: 999, // invalid latitude
        longitude: 77.6408
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /api/v1/sales/visits/:visitId/check-out validates required status and notes', async () => {
    const res = await request(app)
      .post('/api/v1/sales/visits/test-visit-id/check-out')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        status: 'INVALID_STATUS',
        remarks: ''
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /api/v1/sales/partners/onboard validates mobile and pincode formats', async () => {
    const res = await request(app)
      .post('/api/v1/sales/partners/onboard')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        businessName: 'Apex Computer Academy',
        category: PartnerCategory.COMPUTER_CENTER,
        ownerName: 'Suresh Reddy',
        email: 'invalid-email',
        mobile: '12345', // invalid
        addressLine1: 'MG Road',
        city: 'Bengaluru',
        area: 'Indiranagar',
        pincode: '123' // invalid
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

