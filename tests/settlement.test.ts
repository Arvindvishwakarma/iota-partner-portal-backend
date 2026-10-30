import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { Role } from '../src/shared';
import {
  verifyAdmissionSchema,
  refundAdmissionSchema,
  disburseSettlementSchema,
  generateSettlementBatchSchema
} from '../src/validators/settlement.validator';
import { Prisma } from '@prisma/client';

describe('Settlement & Admissions Validator Unit Tests', () => {
  it('validates admission approval without requiring a rejection reason', () => {
    const valid = verifyAdmissionSchema.safeParse({
      approved: true
    });
    expect(valid.success).toBe(true);
  });

  it('rejects admission decline if rejectionReason is missing', () => {
    const invalid = verifyAdmissionSchema.safeParse({
      approved: false
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0].message).toContain('Rejection reason is mandatory');
    }
  });

  it('accepts admission decline when rejectionReason is provided', () => {
    const valid = verifyAdmissionSchema.safeParse({
      approved: false,
      rejectionReason: 'Eligibility documents failed verification check'
    });
    expect(valid.success).toBe(true);
  });

  it('rejects student refund with non-positive amount or missing reason', () => {
    const invalidAmount = refundAdmissionSchema.safeParse({
      refundAmount: -500,
      refundReason: 'Candidate withdrew'
    });
    expect(invalidAmount.success).toBe(false);

    const invalidReason = refundAdmissionSchema.safeParse({
      refundAmount: 5000,
      refundReason: 'no'
    });
    expect(invalidReason.success).toBe(false);
  });

  it('accepts student refund with valid positive amount and descriptive reason', () => {
    const valid = refundAdmissionSchema.safeParse({
      refundAmount: 25000,
      refundReason: 'Student relocated outside Bangalore within 14-day window'
    });
    expect(valid.success).toBe(true);
  });

  it('validates settlement disbursal with bank UTR and valid payment modes', () => {
    const valid = disburseSettlementSchema.safeParse({
      transactionRef: 'HDFCN26123456789',
      paymentMode: 'NEFT'
    });
    expect(valid.success).toBe(true);

    const invalidMode = disburseSettlementSchema.safeParse({
      transactionRef: 'HDFCN26123456789',
      paymentMode: 'CASH'
    });
    expect(invalidMode.success).toBe(false);

    const shortRef = disburseSettlementSchema.safeParse({
      transactionRef: '123',
      paymentMode: 'UPI'
    });
    expect(shortRef.success).toBe(false);
  });
});

describe('Arbitrary-Precision Decimal Accounting Tests', () => {
  it('prevents standard IEEE 754 floating-point drift in commission calculations', () => {
    // In raw JavaScript floating point: 0.1 + 0.2 === 0.30000000000000004
    const jsSum = 0.1 + 0.2;
    expect(jsSum).not.toBe(0.3);

    // Using Prisma.Decimal
    const d1 = new Prisma.Decimal('0.10');
    const d2 = new Prisma.Decimal('0.20');
    const decimalSum = d1.add(d2);
    expect(decimalSum.toFixed(2)).toBe('0.30');
  });

  it('accurately computes gross, deductions, and net payouts across multiple partner commissions', () => {
    const comm1 = new Prisma.Decimal('1000.00');
    const comm2 = new Prisma.Decimal('1000.00');
    const comm3 = new Prisma.Decimal('1500.50');
    const totalGross = comm1.add(comm2).add(comm3);
    expect(totalGross.toFixed(2)).toBe('3500.50');

    // With a TDS or clawback adjustment
    const adjustment = new Prisma.Decimal('500.25');
    const netPayout = totalGross.sub(adjustment);
    expect(netPayout.toFixed(2)).toBe('3000.25');
  });
});

describe('Settlement & Admissions Security & RBAC Guards', () => {
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

  it('GET /api/v1/settlements/admissions blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/settlements/admissions');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/settlements blocks Counsellor role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/settlements')
      .set('Authorization', `Bearer ${counsellorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/settlements blocks Sales role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/settlements')
      .set('Authorization', `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/settlements blocks Partner role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/settlements')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
