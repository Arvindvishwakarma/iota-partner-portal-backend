import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateAccessToken } from '../src/utils/jwt';
import { Role, NotificationChannel } from '../src/shared';
import { notificationService } from '../src/services/notification.service';
import { sendNotificationSchema } from '../src/validators/notification.validator';

describe('Notification Service Template Generators Unit Tests', () => {
  it('correctly renders lead_welcome_student WhatsApp template', () => {
    const rendered = notificationService.renderWhatsAppTemplate('lead_welcome_student', {
      studentName: 'Aarav Patel',
      partnerName: 'Apex Computer Center',
      leadCode: 'LEAD-BLR-0045'
    });

    expect(rendered.templateName).toBe('iota_lead_welcome_v1');
    expect(rendered.textPreview).toContain('Aarav Patel');
    expect(rendered.textPreview).toContain('Apex Computer Center');
    expect(rendered.textPreview).toContain('LEAD-BLR-0045');
  });

  it('correctly renders counsellor_assigned WhatsApp template', () => {
    const rendered = notificationService.renderWhatsAppTemplate('counsellor_assigned', {
      studentName: 'Meera Rao',
      counsellorName: 'Anita Sharma',
      counsellorPhone: '+91 98450 99887'
    });

    expect(rendered.templateName).toBe('iota_counsellor_assigned_v1');
    expect(rendered.textPreview).toContain('Meera Rao');
    expect(rendered.textPreview).toContain('Anita Sharma');
    expect(rendered.textPreview).toContain('+91 98450 99887');
  });

  it('correctly renders partner_settlement_disbursed template', () => {
    const rendered = notificationService.renderWhatsAppTemplate('partner_settlement_disbursed', {
      partnerName: 'Sri Sai Cyber Zone',
      settlementCode: 'SET-2026-1002',
      amount: '5,000.00',
      utrNumber: 'HDFCN26123456789',
      bankAccount: '1234'
    });

    expect(rendered.templateName).toBe('iota_payout_disbursed_v1');
    expect(rendered.textPreview).toContain('SET-2026-1002');
    expect(rendered.textPreview).toContain('₹5,000.00');
    expect(rendered.textPreview).toContain('HDFCN26123456789');
  });

  it('correctly generates responsive transactional HTML email', () => {
    const html = notificationService.renderEmailTemplate(
      'Admission Approved',
      'Your admission for Full Stack AI has been verified.',
      'https://partners.iotaacademy.in/admin/admissions'
    );

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Admission Approved');
    expect(html).toContain('Your admission for Full Stack AI has been verified.');
    expect(html).toContain('https://partners.iotaacademy.in/admin/admissions');
  });
});

describe('Notification Validator Schema Tests', () => {
  it('rejects IN_APP notification if userId is missing', () => {
    const result = sendNotificationSchema.safeParse({
      channel: NotificationChannel.IN_APP,
      title: 'Alert',
      message: 'Hello'
    });
    expect(result.success).toBe(false);
  });

  it('accepts IN_APP notification with valid userId', () => {
    const result = sendNotificationSchema.safeParse({
      channel: NotificationChannel.IN_APP,
      userId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test Notification',
      message: 'You have a new student assignment.'
    });
    expect(result.success).toBe(true);
  });

  it('rejects WHATSAPP notification with invalid Indian mobile number', () => {
    const result = sendNotificationSchema.safeParse({
      channel: NotificationChannel.WHATSAPP,
      phone: '12345',
      title: 'WhatsApp Alert',
      message: 'Test message'
    });
    expect(result.success).toBe(false);
  });

  it('accepts WHATSAPP notification with valid Indian mobile number', () => {
    const result = sendNotificationSchema.safeParse({
      channel: NotificationChannel.WHATSAPP,
      phone: '+919845011223',
      title: 'WhatsApp Alert',
      message: 'Test message'
    });
    expect(result.success).toBe(true);
  });

  it('accepts EMAIL notification with valid recipient email', () => {
    const result = sendNotificationSchema.safeParse({
      channel: NotificationChannel.EMAIL,
      email: 'student@example.com',
      title: 'Email Alert',
      message: 'Test email message'
    });
    expect(result.success).toBe(true);
  });
});

describe('Notification Hub API Security & RBAC Guards', () => {
  const app = createApp();

  const counsellorToken = generateAccessToken({
    userId: 'counsellor-user-id',
    email: 'counsellor@iotaacademy.in',
    role: Role.COUNSELLOR
  });

  const partnerToken = generateAccessToken({
    userId: 'partner-user-id',
    email: 'partner@iotaacademy.in',
    role: Role.PARTNER,
    partnerId: 'partner-uuid-1'
  });

  it('GET /api/v1/notifications/me blocks unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/v1/notifications/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/v1/notifications/send blocks non-admin roles (403 for COUNSELLOR)', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${counsellorToken}`)
      .send({
        channel: NotificationChannel.WHATSAPP,
        phone: '+919845011223',
        title: 'Unauthorized blast',
        message: 'This should be blocked'
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/notifications/admin/logs blocks Partner role (403)', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/admin/logs')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

