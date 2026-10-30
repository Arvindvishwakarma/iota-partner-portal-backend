import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { Role } from '../src/shared';
import { exportQuerySchema, reportFilterSchema } from '../src/validators/report.validator';

describe('Report & Export Schema Validator Tests', () => {
  it('validates correct report date filters', () => {
    const valid = reportFilterSchema.safeParse({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      city: 'Bengaluru'
    });
    expect(valid.success).toBe(true);
  });

  it('validates export query types', () => {
    const validLeads = exportQuerySchema.safeParse({ type: 'leads' });
    expect(validLeads.success).toBe(true);

    const validSettlements = exportQuerySchema.safeParse({ type: 'settlements' });
    expect(validSettlements.success).toBe(true);

    const invalid = exportQuerySchema.safeParse({ type: 'invalid_type' });
    expect(invalid.success).toBe(false);
  });
});

describe('Report & Analytics RBAC Security Guards', () => {
  const app = createApp();

  const counsellorToken = generateAccessToken({
    userId: 'counsellor-user-id',
    email: 'counsellor@iotaacademy.in',
    role: Role.COUNSELLOR
  });

  const salesToken = generateAccessToken({
    userId: 'sales-user-id',
    email: 'sales@iotaacademy.in',
    role: Role.SALES
  });

  const partnerToken = generateAccessToken({
    userId: 'partner-user-id',
    email: 'partner@iotaacademy.in',
    role: Role.PARTNER,
    partnerId: 'partner-uuid-1'
  });

  const adminToken = generateAccessToken({
    userId: 'admin-user-id',
    email: 'admin@iotaacademy.in',
    role: Role.ADMIN
  });

  it('GET /api/v1/reports/overview blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/reports/overview');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/reports/overview blocks Counselor role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/reports/overview')
      .set('Authorization', `Bearer ${counsellorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/reports/overview blocks Sales role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/reports/overview')
      .set('Authorization', `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/reports/overview blocks Partner role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/reports/overview')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/reports/export blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/reports/export?type=leads');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/reports/export streams CSV with correct content headers for Admin', async () => {
    const res = await request(app)
      .get('/api/v1/reports/export?type=leads')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="iota_leads_export_');
    // First line should be CSV header
    expect(res.text).toContain('Lead Code,Student Name,Mobile Number');
  });

  it('GET /api/v1/reports/export streams settlements CSV for Admin', async () => {
    const res = await request(app)
      .get('/api/v1/reports/export?type=settlements')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="iota_settlements_export_');
    expect(res.text).toContain('Settlement Code,Partner Code,Business Name');
  });
});
