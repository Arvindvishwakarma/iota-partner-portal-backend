import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { AppError } from '../middlewares/error.middleware';

interface StoredOtp {
  phone: string; // 10 digits
  otp: string; // 6 digits
  expiresAt: number; // timestamp
  attempts: number;
  lastSentAt: number;
  verified: boolean;
  verifiedAt?: number;
}

export class WhatsAppOtpService {
  // In-memory store for OTPs (phone -> StoredOtp)
  private otpStore = new Map<string, StoredOtp>();

  // Cooldown between resend requests (seconds)
  private readonly RESEND_COOLDOWN_SECONDS = 30;

  // OTP Validity (10 minutes)
  private readonly OTP_EXPIRY_MS = 10 * 60 * 1000;

  // Verified status validity to complete registration (30 minutes)
  private readonly VERIFIED_VALIDITY_MS = 30 * 60 * 1000;

  // Maximum verification attempts before invalidating
  private readonly MAX_ATTEMPTS = 5;

  constructor() {
    // Periodic cleanup of expired records every 15 minutes
    setInterval(() => {
      this.cleanupExpired();
    }, 15 * 60 * 1000);
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [phone, record] of this.otpStore.entries()) {
      if (record.expiresAt < now && (!record.verifiedAt || record.verifiedAt + this.VERIFIED_VALIDITY_MS < now)) {
        this.otpStore.delete(phone);
      }
    }
  }

  /**
   * Normalize phone number to 10-digit Indian mobile format
   */
  public normalizePhone(rawPhone: string): string {
    const digits = (rawPhone || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      return digits.slice(2);
    }
    if (digits.length === 11 && digits.startsWith('0')) {
      return digits.slice(1);
    }
    return digits.slice(-10);
  }

  /**
   * Load current credentials dynamically from backend/.env so edits take effect immediately
   */
  private getCredentials() {
    let waToken = env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '';
    let waPhoneId = env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    let waWabaId = env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
    let waTemplate = env.WHATSAPP_OTP_TEMPLATE_NAME || process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'iota_affiliate_registration_otp';

    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const fileContent = fs.readFileSync(envPath, 'utf-8');
        const parsed = dotenv.parse(fileContent);
        if (parsed.WHATSAPP_ACCESS_TOKEN) waToken = parsed.WHATSAPP_ACCESS_TOKEN.trim();
        if (parsed.WHATSAPP_PHONE_NUMBER_ID) waPhoneId = parsed.WHATSAPP_PHONE_NUMBER_ID.trim();
        if (parsed.WHATSAPP_BUSINESS_ACCOUNT_ID) waWabaId = parsed.WHATSAPP_BUSINESS_ACCOUNT_ID.trim();
        if (parsed.WHATSAPP_OTP_TEMPLATE_NAME) waTemplate = parsed.WHATSAPP_OTP_TEMPLATE_NAME.trim();
      }
    } catch (e) {
      // Fallback to process.env
    }

    return { waToken, waPhoneId, waWabaId, waTemplate };
  }

  /**
   * Write diagnostic payload to backend/last_meta_response.json for debugging
   */
  private logMetaDiagnostic(info: any) {
    try {
      const diagPath = path.resolve(process.cwd(), 'last_meta_response.json');
      fs.writeFileSync(diagPath, JSON.stringify(info, null, 2), 'utf-8');
    } catch {
      // ignore file write failure
    }
  }

  /**
   * Generate signed HMAC verification token for a verified phone number
   */
  public generateVerificationToken(phone: string): string {
    const cleanPhone = this.normalizePhone(phone);
    const timestamp = Date.now();
    const secret = env.JWT_ACCESS_SECRET || 'iota_otp_secret_fallback_2026';
    const payload = `${cleanPhone}:${timestamp}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64');
  }

  /**
   * Verify an HMAC verification token
   */
  public verifyToken(token: string, expectedPhone: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length !== 3) return false;

      const [phone, timestampStr, signature] = parts;
      const cleanExpected = this.normalizePhone(expectedPhone);
      if (phone !== cleanExpected) return false;

      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp) || Date.now() - timestamp > this.VERIFIED_VALIDITY_MS) {
        return false;
      }

      const secret = env.JWT_ACCESS_SECRET || 'iota_otp_secret_fallback_2026';
      const expectedSig = crypto.createHmac('sha256', secret).update(`${phone}:${timestampStr}`).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
    } catch {
      return false;
    }
  }

  /**
   * Dispatch OTP via WhatsApp Cloud API with multi-candidate fallback
   */
  private async dispatchMetaWhatsApp(cleanPhone: string, otp: string): Promise<{ ok: boolean; messageId?: string }> {
    const { waToken, waPhoneId, waWabaId, waTemplate } = this.getCredentials();

    if (!waToken || !waPhoneId) {
      const errMsg = 'WhatsApp API credentials are missing. Please configure WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in backend/.env.';
      logger.error(`[WhatsApp API] ${errMsg}`);
      this.logMetaDiagnostic({
        timestamp: new Date().toISOString(),
        error: errMsg,
        status: 'CREDENTIALS_MISSING'
      });
      throw new AppError(errMsg, 400, 'WHATSAPP_CONFIG_MISSING');
    }

    const recipientWithCountry = `91${cleanPhone}`;
    const url = `https://graph.facebook.com/v20.0/${waPhoneId}/messages`;

    // Candidate payload structures for Meta Authentication Templates
    const candidates = [
      // 1. Authentication Template: en_US with Copy-Code URL Button
      {
        desc: "en_US with url button",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: otp }]
              }
            ]
          }
        }
      },
      // 2. Authentication Template: en with Copy-Code URL Button
      {
        desc: "en with url button",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: otp }]
              }
            ]
          }
        }
      },
      // 3. Authentication Template: en_US Body Only (no button parameters)
      {
        desc: "en_US body only",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              }
            ]
          }
        }
      },
      // 4. Authentication Template: en Body Only (no button parameters)
      {
        desc: "en body only",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              }
            ]
          }
        }
      },
      // 5. Authentication Template: en_US with copy_code button sub_type
      {
        desc: "en_US with copy_code button sub_type",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              },
              {
                type: 'button',
                sub_type: 'copy_code',
                index: '0',
                parameters: [{ type: 'coupon_code', coupon_code: otp }]
              }
            ]
          }
        }
      },
      // 6. Authentication Template: en_GB with url button
      {
        desc: "en_GB with url button",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en_GB' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: otp }]
              }
            ]
          }
        }
      },
      // 7. Authentication Template: en_GB body only
      {
        desc: "en_GB body only",
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en_GB' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otp }]
              }
            ]
          }
        }
      }
    ];

    const attemptLogs: any[] = [];
    let lastErrorData: any = null;

    for (const candidate of candidates) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${waToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(candidate.payload)
        });

        const data: any = await response.json();
        attemptLogs.push({
          candidate: candidate.desc,
          httpStatus: response.status,
          response: data
        });

        if (response.ok && data?.messages?.[0]?.id) {
          const msgId = data.messages[0].id;
          logger.info(`[WhatsApp API Success] OTP sent via template '${waTemplate}' (${candidate.desc}) to +91${cleanPhone}. ID: ${msgId}`);
          this.logMetaDiagnostic({
            timestamp: new Date().toISOString(),
            success: true,
            successfulCandidate: candidate.desc,
            recipient: recipientWithCountry,
            templateName: waTemplate,
            messageId: msgId,
            response: data
          });
          return { ok: true, messageId: msgId };
        }

        lastErrorData = data?.error;

        // If the error is fatal and independent of candidate structure (e.g., token expired or recipient not in sandbox list), stop early
        if (lastErrorData?.code === 190 || lastErrorData?.code === 131030 || lastErrorData?.code === 131042) {
          break;
        }
      } catch (err: any) {
        attemptLogs.push({
          candidate: candidate.desc,
          networkError: err.message
        });
      }
    }

    // Direct Text message attempt fallback (Works only if user messaged within 24h)
    try {
      const textRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipientWithCountry,
          type: 'text',
          text: {
            preview_url: false,
            body: `Your IOTA Academy Partner OTP is *${otp}* (valid for 10 minutes).`
          }
        })
      });
      const textData: any = await textRes.json();
      attemptLogs.push({
        candidate: "Direct text message",
        httpStatus: textRes.status,
        response: textData
      });
      if (textRes.ok && textData?.messages?.[0]?.id) {
        const msgId = textData.messages[0].id;
        logger.info(`[WhatsApp API Success] Direct text message sent to +91${cleanPhone}. ID: ${msgId}`);
        this.logMetaDiagnostic({
          timestamp: new Date().toISOString(),
          success: true,
          successfulCandidate: "Direct text message",
          recipient: recipientWithCountry,
          messageId: msgId,
          response: textData
        });
        return { ok: true, messageId: msgId };
      }
      if (textData?.error) {
        lastErrorData = textData.error;
      }
    } catch (e: any) {
      attemptLogs.push({ candidate: "Direct text message", networkError: e.message });
    }

    // If all attempts failed, log diagnostics and formulate informative error
    this.logMetaDiagnostic({
      timestamp: new Date().toISOString(),
      success: false,
      recipient: recipientWithCountry,
      phoneId: waPhoneId,
      templateName: waTemplate,
      attempts: attemptLogs,
      lastError: lastErrorData
    });

    let userFriendlyError = 'Meta WhatsApp API was unable to deliver the OTP message.';

    if (lastErrorData) {
      const { code, message, error_subcode } = lastErrorData;
      if (code === 190) {
        userFriendlyError = 'Meta Access Token has expired or is invalid. Please generate a fresh System User Token in Meta Business Suite.';
      } else if (code === 131030) {
        userFriendlyError = `Meta Developer Sandbox Restriction: The WhatsApp number +91${cleanPhone} is not in your allowed test list. Add this phone number under Meta Developer Portal > WhatsApp > API Setup > Step 2 ("To" phone numbers), or switch your Meta App to Live Mode.`;
      } else if (code === 132000) {
        userFriendlyError = `Meta Template Error: Template '${waTemplate}' does not exist or has not been approved in English (en_US / en). Check template status in WhatsApp Manager.`;
      } else if (code === 132001) {
        userFriendlyError = `Meta Template Error: Parameters for template '${waTemplate}' do not match the expected placeholders. Check template layout in WhatsApp Manager.`;
      } else if (code === 131042) {
        userFriendlyError = 'Meta Business Error: Your WhatsApp Business Account requires a payment method or business verification to send messages.';
      } else if (code === 131026) {
        userFriendlyError = `Meta Message Delivery Error: Unable to deliver message to +91${cleanPhone}. Please check that this number is active on WhatsApp.`;
      } else if (message) {
        userFriendlyError = `Meta WhatsApp Error (${code}${error_subcode ? '/' + error_subcode : ''}): ${message}`;
      }
    }

    logger.error(`[WhatsApp API Failure] ${userFriendlyError}`);
    throw new AppError(userFriendlyError, 400, 'WHATSAPP_DELIVERY_FAILED');
  }

  /**
   * Send WhatsApp OTP
   */
  async sendOtp(rawPhone: string): Promise<{ success: boolean; message: string; cooldown: number; debugOtp?: string }> {
    const cleanPhone = this.normalizePhone(rawPhone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      throw new AppError('Please enter a valid 10-digit Indian mobile number starting with 6–9', 400, 'INVALID_PHONE');
    }

    const now = Date.now();
    const existing = this.otpStore.get(cleanPhone);

    // Cooldown check (30 seconds)
    if (existing && now - existing.lastSentAt < this.RESEND_COOLDOWN_SECONDS * 1000) {
      const remainingSeconds = Math.ceil((this.RESEND_COOLDOWN_SECONDS * 1000 - (now - existing.lastSentAt)) / 1000);
      throw new AppError(
        `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        429,
        'OTP_COOLDOWN'
      );
    }

    // Generate cryptographically secure 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Store in-memory
    this.otpStore.set(cleanPhone, {
      phone: cleanPhone,
      otp,
      expiresAt: now + this.OTP_EXPIRY_MS,
      attempts: 0,
      lastSentAt: now,
      verified: false
    });

    // Dispatch via WhatsApp Cloud API
    const dispatchResult = await this.dispatchMetaWhatsApp(cleanPhone, otp);

    return {
      success: true,
      message: `OTP sent successfully to your WhatsApp number +91 ${cleanPhone}.`,
      cooldown: this.RESEND_COOLDOWN_SECONDS
    };
  }

  /**
   * Verify WhatsApp OTP
   */
  async verifyOtp(rawPhone: string, enteredOtp: string): Promise<{ success: boolean; verified: boolean; verificationToken: string; message: string }> {
    const cleanPhone = this.normalizePhone(rawPhone);
    const cleanOtp = (enteredOtp || '').trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new AppError('Please enter a valid 6-digit OTP code', 400, 'INVALID_OTP');
    }

    const record = this.otpStore.get(cleanPhone);
    if (!record) {
      throw new AppError('No active OTP found for this number. Please request a new OTP.', 400, 'NO_OTP_FOUND');
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(cleanPhone);
      throw new AppError('The OTP has expired. Please request a new one.', 400, 'OTP_EXPIRED');
    }

    if (record.attempts >= this.MAX_ATTEMPTS) {
      this.otpStore.delete(cleanPhone);
      throw new AppError('Too many failed verification attempts. Please request a new OTP.', 400, 'MAX_ATTEMPTS_EXCEEDED');
    }

    if (record.otp !== cleanOtp) {
      record.attempts++;
      const remainingAttempts = this.MAX_ATTEMPTS - record.attempts;
      throw new AppError(
        `Incorrect OTP. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`,
        400,
        'OTP_MISMATCH'
      );
    }

    // Mark verified
    record.verified = true;
    record.verifiedAt = Date.now();

    const verificationToken = this.generateVerificationToken(cleanPhone);

    return {
      success: true,
      verified: true,
      verificationToken,
      message: 'WhatsApp number verified successfully!'
    };
  }

  /**
   * Check if a phone is verified (either via in-memory record or signed verification token)
   */
  public isPhoneVerified(rawPhone: string, verificationToken?: string | null): boolean {
    const cleanPhone = this.normalizePhone(rawPhone);

    // 1. Verify token if passed
    if (verificationToken && this.verifyToken(verificationToken, cleanPhone)) {
      return true;
    }

    // 2. Check in-memory store
    const record = this.otpStore.get(cleanPhone);
    if (record && record.verified && record.verifiedAt) {
      if (Date.now() - record.verifiedAt <= this.VERIFIED_VALIDITY_MS) {
        return true;
      }
    }

    return false;
  }

  /**
   * Diagnostic inspector for Meta credentials and template status
   */
  public async getWhatsAppStatus(): Promise<any> {
    const { waToken, waPhoneId, waWabaId, waTemplate } = this.getCredentials();

    const result: any = {
      credentialsConfigured: Boolean(waToken && waPhoneId),
      tokenPrefix: waToken ? `${waToken.slice(0, 10)}...${waToken.slice(-6)}` : null,
      phoneId: waPhoneId || null,
      wabaId: waWabaId || null,
      templateName: waTemplate || null,
      phoneCheck: null,
      templateCheck: null,
      lastMetaResponse: null
    };

    try {
      const diagPath = path.resolve(process.cwd(), 'last_meta_response.json');
      if (fs.existsSync(diagPath)) {
        result.lastMetaResponse = JSON.parse(fs.readFileSync(diagPath, 'utf-8'));
      }
    } catch {
      // ignore
    }

    if (!waToken || !waPhoneId) {
      return result;
    }

    try {
      const pRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}`, {
        headers: { Authorization: `Bearer ${waToken}` }
      });
      result.phoneCheck = {
        httpStatus: pRes.status,
        data: await pRes.json()
      };
    } catch (e: any) {
      result.phoneCheck = { error: e.message };
    }

    if (waWabaId) {
      try {
        const tRes = await fetch(`https://graph.facebook.com/v20.0/${waWabaId}/message_templates?name=${waTemplate}`, {
          headers: { Authorization: `Bearer ${waToken}` }
        });
        result.templateCheck = {
          httpStatus: tRes.status,
          data: await tRes.json()
        };
      } catch (e: any) {
        result.templateCheck = { error: e.message };
      }
    }

    return result;
  }
}

export const whatsappOtpService = new WhatsAppOtpService();
