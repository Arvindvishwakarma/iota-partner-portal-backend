import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateQrPngDataUrl, generateQrSvgString } from '../src/utils/qrcode';
import { normalizeIndianPhone } from '../src/validators/public-lead.validator';
import { generateAccessToken } from '../src/utils/jwt';
import { Role } from '../src/shared';

describe('QR Code Generation Engine', () => {
  it('generates high-resolution PNG Data URL for partner registration link', async () => {
    const testUrl = 'https://partners.iotaacademy.in/register/PTR-BLR-0001';
    const pngDataUrl = await generateQrPngDataUrl(testUrl);

    expect(pngDataUrl).toBeDefined();
    expect(pngDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('generates scalable SVG vector string for printable posters', async () => {
    const testUrl = 'https://partners.iotaacademy.in/register/PTR-BLR-0001';
    const svg = await generateQrSvgString(testUrl);

    expect(svg).toBeDefined();
    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('</svg>')).toBe(true);
  });
});

describe('Indian Phone Normalization (E.164)', () => {
  it('normalizes 10-digit raw numbers to +91XXXXXXXXXX', () => {
    expect(normalizeIndianPhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes numbers with leading 0 to +91XXXXXXXXXX', () => {
    expect(normalizeIndianPhone('09876543210')).toBe('+919876543210');
  });

  it('normalizes numbers with formatted spaces and dashes', () => {
    expect(normalizeIndianPhone('+91 98765-43210')).toBe('+919876543210');
  });
});

describe('Public Student Lead Intake & Validation API', () => {
  const app = createApp();

  it('POST /api/v1/public/leads validates phone format', async () => {
    const res = await request(app).post('/api/v1/public/leads').send({
      partnerCode: 'PTR-BLR-0001',
      studentName: 'Aarav Patel',
      mobile: '12345', // invalid
      currentEducation: 'B.Tech 3rd Year',
      city: 'Bengaluru',
      preferredContactTime: 'MORNING_10AM_1PM',
      communicationConsent: true
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /api/v1/public/leads requires communication consent', async () => {
    const res = await request(app).post('/api/v1/public/leads').send({
      partnerCode: 'PTR-BLR-0001',
      studentName: 'Aarav Patel',
      mobile: '9876543210',
      currentEducation: 'B.Tech 3rd Year',
      city: 'Bengaluru',
      communicationConsent: false // rejected
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/partner/dashboard rejects unauthorized access without partner role', async () => {
    const salesToken = generateAccessToken({
      userId: 'sales-usr',
      email: 'sales@iotaacademy.in',
      role: Role.SALES
    });

    const res = await request(app)
      .get('/api/v1/partner/dashboard')
      .set('Authorization', `Bearer ${salesToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

