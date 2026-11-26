import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { AppError } from '../middlewares/error.middleware';

interface StoredOtp {
  phone: string; // 10 digits
  sessionId?: string;
  otpHash: string; // SHA-256 hex digest of phone:otp
  expiresAt: number; // timestamp
  attempts: number;
  lastSentAt: number;
  verified: boolean;
  verifiedAt?: number;
}

export class WhatsAppOtpService {
  // In-memory store for OTPs ((phone or phone:sessionId) -> StoredOtp)
  private otpStore = new Map<string, StoredOtp>();

  // Rolling per-phone send timestamps for rate limiting
  private phoneSendHistory = new Map<string, number[]>();

  // Track single-use consumed verification token IDs to prevent replay
  private consumedTokenIds = new Map<string, number>();

  // Cooldown between resend requests (seconds)
  private readonly RESEND_COOLDOWN_SECONDS = 30;

  // Max OTPs sent per phone within rolling rate window
  private readonly PHONE_RATE_WINDOW_MS = 15 * 60 * 1000;
  private readonly MAX_OTP_PER_PHONE_WINDOW = 5;

  // OTP Validity (10 minutes)
  private readonly OTP_EXPIRY_MS = 10 * 60 * 1000;

  // Verified status validity to complete registration (30 minutes)
  private readonly VERIFIED_VALIDITY_MS = 30 * 60 * 1000;

  // Maximum verification attempts before invalidating
  private readonly MAX_ATTEMPTS = 5;

  constructor() {
    // Periodic cleanup of expired records every 15 minutes
    const timer = setInterval(() => {
      this.cleanupExpired();
    }, 15 * 60 * 1000);
    timer.unref?.();
  }

  private getStoreKey(cleanPhone: string, sessionId?: string): string {
    const cleanSession = (sessionId || '').trim();
    return cleanSession ? `${cleanPhone}:${cleanSession}` : cleanPhone;
  }

  private hashOtp(cleanPhone: string, otp: string): string {
    return crypto.createHash('sha256').update(`${cleanPhone}:${otp}`).digest('hex');
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [key, record] of this.otpStore.entries()) {
      if (record.expiresAt < now && (!record.verifiedAt || record.verifiedAt + this.VERIFIED_VALIDITY_MS < now)) {
        this.otpStore.delete(key);
      }
    }
    for (const [phone, stamps] of this.phoneSendHistory.entries()) {
      const active = stamps.filter((ts) => now - ts < this.PHONE_RATE_WINDOW_MS);
      if (active.length === 0) {
        this.phoneSendHistory.delete(phone);
      } else {
        this.phoneSendHistory.set(phone, active);
      }
    }
    for (const [jti, exp] of this.consumedTokenIds.entries()) {
      if (exp < now) {
        this.consumedTokenIds.delete(jti);
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
   * Generate signed HMAC verification token bound to phone, optional session, timestamp, and unique nonce
   */
  public generateVerificationToken(phone: string, sessionId?: string): string {
    const cleanPhone = this.normalizePhone(phone);
    const cleanSession = (sessionId || 'default').trim().replace(/:/g, '');
    const timestamp = Date.now();
    const jti = crypto.randomBytes(12).toString('hex');
    const secret = env.JWT_ACCESS_SECRET || 'iota_otp_secret_fallback_2026';
    const payload = `${cleanPhone}:${cleanSession}:${timestamp}:${jti}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64');
  }

  private parseAndVerifyToken(
    token: string,
    expectedPhone: string,
    expectedSessionId?: string
  ): { valid: boolean; jti?: string } {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      const cleanExpected = this.normalizePhone(expectedPhone);
      const secret = env.JWT_ACCESS_SECRET || 'iota_otp_secret_fallback_2026';

      // Support legacy 3-part tokens (phone:ts:sig) and session-bound 5-part tokens (phone:session:ts:jti:sig)
      if (parts.length === 3) {
        if (expectedSessionId) return { valid: false };
        const [phone, timestampStr, signature] = parts;
        if (phone !== cleanExpected) return { valid: false };
        const timestamp = parseInt(timestampStr, 10);
        if (isNaN(timestamp) || Date.now() - timestamp > this.VERIFIED_VALIDITY_MS) {
          return { valid: false };
        }
        const expectedSig = crypto.createHmac('sha256', secret).update(`${phone}:${timestampStr}`).digest('hex');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          return { valid: false };
        }
        return { valid: true };
      }

      if (parts.length !== 5) return { valid: false };
      const [phone, tokenSession, timestampStr, jti, signature] = parts;
      if (phone !== cleanExpected) return { valid: false };
      if (expectedSessionId) {
        const cleanExpectedSession = expectedSessionId.trim().replace(/:/g, '');
        if (tokenSession !== cleanExpectedSession) return { valid: false };
      }
      if (this.consumedTokenIds.has(jti)) return { valid: false };

      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp) || Date.now() - timestamp > this.VERIFIED_VALIDITY_MS) {
        return { valid: false };
      }

      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${phone}:${tokenSession}:${timestampStr}:${jti}`)
        .digest('hex');
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false };
      }
      return { valid: true, jti };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Verify an HMAC verification token
   */
  public verifyToken(token: string, expectedPhone: string, expectedSessionId?: string): boolean {
    return this.parseAndVerifyToken(token, expectedPhone, expectedSessionId).valid;
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
            body: `Your IOTA Academy verification OTP is *${otp}* (valid for 10 minutes).`
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
  async sendOtp(
    rawPhone: string,
    sessionId?: string
  ): Promise<{ success: boolean; message: string; cooldown: number; expiresInSeconds: number }> {
    const cleanPhone = this.normalizePhone(rawPhone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      throw new AppError('Please enter a valid 10-digit Indian mobile number starting with 6–9', 400, 'INVALID_PHONE');
    }

    const now = Date.now();
    const storeKey = this.getStoreKey(cleanPhone, sessionId);
    const existing = this.otpStore.get(storeKey);

    // Cooldown check (30 seconds)
    if (existing && now - existing.lastSentAt < this.RESEND_COOLDOWN_SECONDS * 1000) {
      const remainingSeconds = Math.ceil((this.RESEND_COOLDOWN_SECONDS * 1000 - (now - existing.lastSentAt)) / 1000);
      throw new AppError(
        `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        429,
        'OTP_COOLDOWN'
      );
    }

    // Per-phone rolling window rate limit (prevents abuse across sessions)
    const history = (this.phoneSendHistory.get(cleanPhone) || []).filter(
      (ts) => now - ts < this.PHONE_RATE_WINDOW_MS
    );
    if (history.length >= this.MAX_OTP_PER_PHONE_WINDOW) {
      throw new AppError(
        'Too many OTP requests for this WhatsApp number. Please try again after 15 minutes.',
        429,
        'OTP_RATE_LIMITED'
      );
    }

    // Generate cryptographically secure 6-digit OTP and store only its hash
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = this.hashOtp(cleanPhone, otp);

    // Dispatch via WhatsApp Cloud API first before committing send history
    await this.dispatchMetaWhatsApp(cleanPhone, otp);

    history.push(now);
    this.phoneSendHistory.set(cleanPhone, history);

    this.otpStore.set(storeKey, {
      phone: cleanPhone,
      sessionId: sessionId?.trim() || undefined,
      otpHash,
      expiresAt: now + this.OTP_EXPIRY_MS,
      attempts: 0,
      lastSentAt: now,
      verified: false
    });

    return {
      success: true,
      message: `OTP sent successfully to your WhatsApp number +91 ${cleanPhone}.`,
      cooldown: this.RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: Math.floor(this.OTP_EXPIRY_MS / 1000)
    };
  }

  /**
   * Verify WhatsApp OTP
   */
  async verifyOtp(
    rawPhone: string,
    enteredOtp: string,
    sessionId?: string
  ): Promise<{ success: boolean; verified: boolean; verificationToken: string; message: string }> {
    const cleanPhone = this.normalizePhone(rawPhone);
    const cleanOtp = (enteredOtp || '').trim();

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      throw new AppError('Please enter a valid 10-digit WhatsApp number', 400, 'INVALID_PHONE');
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      throw new AppError('Please enter a valid 6-digit OTP code', 400, 'INVALID_OTP');
    }

    const storeKey = this.getStoreKey(cleanPhone, sessionId);
    const record = this.otpStore.get(storeKey);
    if (!record) {
      throw new AppError('No active OTP found for this WhatsApp number. Please request a new OTP.', 400, 'NO_OTP_FOUND');
    }

    if (record.verified || !record.otpHash) {
      throw new AppError('This OTP has already been used. Please request a new OTP if needed.', 400, 'OTP_ALREADY_USED');
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(storeKey);
      throw new AppError('The OTP has expired. Please request a new one.', 400, 'OTP_EXPIRED');
    }

    if (record.attempts >= this.MAX_ATTEMPTS) {
      this.otpStore.delete(storeKey);
      throw new AppError('Too many failed verification attempts. Please request a new OTP.', 400, 'MAX_ATTEMPTS_EXCEEDED');
    }

    const enteredHash = this.hashOtp(cleanPhone, cleanOtp);
    const isMatch = crypto.timingSafeEqual(Buffer.from(enteredHash, 'hex'), Buffer.from(record.otpHash, 'hex'));

    if (!isMatch) {
      record.attempts++;
      const remainingAttempts = this.MAX_ATTEMPTS - record.attempts;
      if (remainingAttempts <= 0) {
        this.otpStore.delete(storeKey);
        throw new AppError('Incorrect OTP. Maximum attempts reached. Please request a new OTP.', 400, 'MAX_ATTEMPTS_EXCEEDED');
      }
      throw new AppError(
        `Incorrect OTP. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`,
        400,
        'OTP_MISMATCH'
      );
    }

    // Mark verified and wipe OTP hash so the same OTP cannot be reused
    record.verified = true;
    record.verifiedAt = Date.now();
    record.otpHash = '';

    const verificationToken = this.generateVerificationToken(cleanPhone, sessionId);

    return {
      success: true,
      verified: true,
      verificationToken,
      message: 'WhatsApp Number Verified'
    };
  }

  /**
   * Check if a phone is verified (either via in-memory record or signed verification token)
   */
  public isPhoneVerified(rawPhone: string, verificationToken?: string | null, sessionId?: string): boolean {
    const cleanPhone = this.normalizePhone(rawPhone);

    // 1. Verify token if passed
    if (verificationToken && this.verifyToken(verificationToken, cleanPhone, sessionId)) {
      return true;
    }

    // 2. Check in-memory store
    const storeKey = this.getStoreKey(cleanPhone, sessionId);
    const record = this.otpStore.get(storeKey);
    if (record && record.verified && record.verifiedAt) {
      if (Date.now() - record.verifiedAt <= this.VERIFIED_VALIDITY_MS) {
        return true;
      }
    }

    return false;
  }

  /**
   * Strictly validate and consume a session-bound WhatsApp OTP verification token (single-use).
   */
  public consumePhoneVerification(rawPhone: string, verificationToken?: string | null, sessionId?: string): boolean {
    const cleanPhone = this.normalizePhone(rawPhone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone) || !verificationToken) {
      return false;
    }

    const parsed = this.parseAndVerifyToken(verificationToken, cleanPhone, sessionId);
    if (!parsed.valid) {
      return false;
    }

    const storeKey = this.getStoreKey(cleanPhone, sessionId);
    this.otpStore.delete(storeKey);

    if (parsed.jti) {
      this.consumedTokenIds.set(parsed.jti, Date.now() + this.VERIFIED_VALIDITY_MS);
    }

    return true;
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

  /**
   * Shared helper to dispatch a 1-parameter ({{1}} = first name) Meta WhatsApp template
   */
  private async sendAffiliateTemplateWhatsApp(
    phone: string,
    templateName: string,
    affiliateName: string,
    contextLabel: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const cleanPhone = this.normalizePhone(phone);
    // Use only first name with Capital Case (e.g. "Hi Arvind")
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const { waToken, waPhoneId } = this.getCredentials();

    if (!waToken || !waPhoneId) {
      logger.info(`[WhatsApp API] Credentials missing. Simulated ${contextLabel} WhatsApp (${templateName}) to +91${cleanPhone} for ${firstName}.`);
      return { ok: false, error: 'Credentials not configured' };
    }

    const recipientWithCountry = `91${cleanPhone}`;
    const url = `https://graph.facebook.com/v20.0/${waPhoneId}/messages`;

    // Try candidates: en first (matching Meta configuration), then en_US
    const candidates = ['en', 'en_US'].map((langCode) => ({
      desc: `${templateName} (${langCode})`,
      payload: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientWithCountry,
        type: 'template',
        template: {
          name: templateName,
          language: { code: langCode },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: firstName }]
            }
          ]
        }
      }
    }));

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
        if (response.ok && data?.messages?.[0]?.id) {
          const msgId = data.messages[0].id;
          logger.info(`[WhatsApp API Success] ${contextLabel} sent via template '${templateName}' to +91${cleanPhone}. ID: ${msgId}`);
          return { ok: true, messageId: msgId };
        } else {
          logger.warn(`[WhatsApp API] Template candidate ${candidate.desc} response:`, data?.error?.message || data);
        }
      } catch (err: any) {
        logger.warn(`[WhatsApp API] Network error for candidate ${candidate.desc}:`, err.message);
      }
    }

    return { ok: false, error: `Failed to deliver WhatsApp template '${templateName}'` };
  }

  /**
   * Dispatch Registration Confirmation message via Meta WhatsApp template "affiliate_registration_done"
   */
  public async sendAffiliateRegistrationWhatsApp(
    phone: string,
    affiliateName: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    return this.sendAffiliateTemplateWhatsApp(
      phone,
      'affiliate_registration_done',
      affiliateName,
      'Registration confirmation'
    );
  }

  /**
   * Dispatch Profile Rejection notification via Meta WhatsApp template "affiliate_profile_rejected"
   */
  public async sendAffiliateRejectionWhatsApp(
    phone: string,
    affiliateName: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    return this.sendAffiliateTemplateWhatsApp(
      phone,
      'affiliate_profile_rejected',
      affiliateName,
      'Profile rejection'
    );
  }
}

export const whatsappOtpService = new WhatsAppOtpService();
