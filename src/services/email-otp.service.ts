import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import net from 'net';
import tls from 'tls';
import dotenv from 'dotenv';
import { logger } from '../config/logger';
import { env } from '../config/environment';
import { AppError } from '../middlewares/error.middleware';

interface StoredEmailOtp {
  email: string;
  otp: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
  verified: boolean;
  verifiedAt?: number;
}

export interface EmailOtpContext {
  title?: string;
  heading?: string;
  description?: string;
  subject?: string;
}

export class EmailOtpService {
  private otpStore = new Map<string, StoredEmailOtp>();

  private readonly RESEND_COOLDOWN_SECONDS = 30;
  private readonly OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 mins
  private readonly VERIFIED_VALIDITY_MS = 30 * 60 * 1000; // 30 mins
  private readonly MAX_ATTEMPTS = 5;

  constructor() {
    setInterval(() => {
      this.cleanupExpired();
    }, 15 * 60 * 1000);
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [email, record] of this.otpStore.entries()) {
      if (record.expiresAt < now && (!record.verifiedAt || record.verifiedAt + this.VERIFIED_VALIDITY_MS < now)) {
        this.otpStore.delete(email);
      }
    }
  }

  public normalizeEmail(rawEmail: string): string {
    return (rawEmail || '').trim().toLowerCase();
  }

  private getCredentials() {
    let host = env.EMAIL_HOST || process.env.EMAIL_HOST || '';
    let port = env.EMAIL_PORT || (process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT, 10) : 587);
    let secure = port === 465;
    let user = env.EMAIL_USER || process.env.EMAIL_USER || '';
    let pass = env.EMAIL_PASSWORD || process.env.EMAIL_PASSWORD || '';
    let from = env.EMAIL_FROM || process.env.EMAIL_FROM || 'IOTA Academy <no-reply@iotaacademy.in>';

    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const fileContent = fs.readFileSync(envPath, 'utf-8');
        const parsed = dotenv.parse(fileContent);
        if (parsed.EMAIL_HOST) host = parsed.EMAIL_HOST.trim();
        if (parsed.EMAIL_PORT) port = parseInt(parsed.EMAIL_PORT.trim(), 10) || port;
        if (parsed.EMAIL_USER) user = parsed.EMAIL_USER.trim();
        if (parsed.EMAIL_PASSWORD) pass = parsed.EMAIL_PASSWORD.trim();
        if (parsed.EMAIL_FROM) from = parsed.EMAIL_FROM.trim();
        if (parsed.EMAIL_SECURE !== undefined) {
          secure = parsed.EMAIL_SECURE === 'true' || port === 465;
        }
      }
    } catch {
      // Ignore
    }

    // Google Workspace App Passwords often contain spaces like "xxxx xxxx xxxx xxxx" when copied
    if (host.includes('gmail') || host.includes('google')) {
      pass = pass.replace(/\s+/g, '');
    }

    return { host, port, secure, user, pass, from };
  }

  private logEmailDiagnostic(info: any) {
    try {
      const diagPath = path.resolve(process.cwd(), 'last_email_response.json');
      fs.writeFileSync(diagPath, JSON.stringify(info, null, 2), 'utf-8');
    } catch {
      // Ignore
    }
  }

  public generateVerificationToken(email: string): string {
    const cleanEmail = this.normalizeEmail(email);
    const timestamp = Date.now();
    const secret = env.JWT_ACCESS_SECRET || 'iota_email_otp_secret_2026';
    const payload = `${cleanEmail}:${timestamp}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64');
  }

  public verifyToken(token: string, expectedEmail: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length !== 3) return false;

      const [email, timestampStr, signature] = parts;
      const cleanExpected = this.normalizeEmail(expectedEmail);
      if (email !== cleanExpected) return false;

      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp) || Date.now() - timestamp > this.VERIFIED_VALIDITY_MS) {
        return false;
      }

      const secret = env.JWT_ACCESS_SECRET || 'iota_email_otp_secret_2026';
      const expectedSig = crypto.createHmac('sha256', secret).update(`${email}:${timestampStr}`).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
    } catch {
      return false;
    }
  }

  /**
   * Send Email OTP via SMTP (supports nodemailer or native socket SMTP)
   */
  private async dispatchSmtp(toEmail: string, otp: string, context?: EmailOtpContext): Promise<boolean> {
    const { host, port, secure, user, pass, from } = this.getCredentials();

    if (!host || !user || !pass || host === 'smtp.example.com') {
      logger.info(`[Email Sandbox] Live SMTP credentials not configured in backend/.env. Simulated OTP for ${toEmail}: ${otp}`);
      this.logEmailDiagnostic({
        timestamp: new Date().toISOString(),
        status: 'SANDBOX_SIMULATION',
        toEmail,
        otp,
        notice: 'Configure EMAIL_HOST, EMAIL_PORT, EMAIL_USER, and EMAIL_PASSWORD in backend/.env for live delivery.'
      });
      return false;
    }

    const emailTitle = context?.title || 'IOTA Academy Partner Verification';
    const emailHeading = context?.heading || 'Verify Your Email Address';
    const emailDesc =
      context?.description ||
      'Thank you for applying to the IOTA Academy Affiliate Program. Please use the verification code below to verify your email address:';
    const emailSubject = context?.subject || `${otp} is your IOTA Academy Partner verification code`;

    const htmlBody = this.wrapEmailHtml({
      title: emailTitle,
      maxWidth: 540,
      footerText: `© 2026 TECHIOTA LLP (IOTA Academy). All rights reserved. | Sent from <strong>${from}</strong>`,
      bodyHtml: `
              <h2 class="email-heading" style="color: #0f172a; font-size: 18px; margin: 0 0 12px; font-weight: 700;">${emailHeading}</h2>
              <p class="email-muted" style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                ${emailDesc}
              </p>
              
              <!-- OTP Box -->
              <div class="callout-success" style="background-color: #f0fdf4; border: 2px dashed #86efac; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 24px;">
                <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #15803d;">${otp}</span>
              </div>

              <p class="email-muted" style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 8px;">
                ⏳ This code is valid for <strong>10 minutes</strong>.
              </p>
              <p class="email-muted" style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
                If you did not request this verification, please safely ignore this email.
              </p>`
    });

    // Strategy 1: Try nodemailer if installed
    try {
      const nodemailer = require('nodemailer');
      const transportConfig: any = {
        auth: { user, pass }
      };

      if (host.includes('gmail') || host.includes('google')) {
        transportConfig.service = 'gmail';
      } else {
        transportConfig.host = host;
        transportConfig.port = port;
        transportConfig.secure = secure;
      }

      const transporter = nodemailer.createTransport(transportConfig);

      const info = await transporter.sendMail({
        from,
        to: toEmail,
        subject: emailSubject,
        text: `Your IOTA Academy verification code is: ${otp} (valid for 10 minutes).`,
        html: htmlBody
      });

      logger.info(`[Email Service] Sent OTP email to ${toEmail} via nodemailer. ID: ${info.messageId || 'OK'}`);
      this.logEmailDiagnostic({
        timestamp: new Date().toISOString(),
        success: true,
        transport: 'nodemailer',
        toEmail,
        messageId: info.messageId
      });
      return true;
    } catch (e: any) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        logger.warn(`[Email Service] Nodemailer dispatch failed: ${e.message}. Trying socket transport.`);
      }
    }

    // Strategy 2: Built-in native Socket SMTP Client (Zero-dependency pure Node.js)
    return new Promise<boolean>((resolve, reject) => {
      let socket: net.Socket;
      let buffer = '';
      let step = 0;

      const timeoutId = setTimeout(() => {
        if (socket) socket.destroy();
        this.logEmailDiagnostic({
          timestamp: new Date().toISOString(),
          success: false,
          error: 'SMTP Connection Timed Out'
        });
        reject(new AppError('SMTP connection timed out while sending email OTP.', 504, 'EMAIL_TIMEOUT'));
      }, 12000);

      const onConnect = () => {
        // Socket connected
      };

      if (secure || port === 465) {
        socket = tls.connect(port, host, { rejectUnauthorized: false }, onConnect);
      } else {
        socket = net.createConnection(port, host, onConnect);
      }

      socket.setEncoding('utf-8');

      const send = (cmd: string) => {
        socket.write(cmd + '\r\n');
      };

      socket.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const code = parseInt(line.slice(0, 3), 10);
          if (isNaN(code) || line.charAt(3) === '-') continue; // Handle multiline SMTP response

          if (step === 0 && code === 220) {
            step = 1;
            send(`EHLO localhost`);
          } else if (step === 1 && code === 250) {
            step = 2;
            send(`AUTH LOGIN`);
          } else if (step === 2 && code === 334) {
            step = 3;
            send(Buffer.from(user).toString('base64'));
          } else if (step === 3 && code === 334) {
            step = 4;
            send(Buffer.from(pass).toString('base64'));
          } else if (step === 4 && code === 235) {
            step = 5;
            const fromAddr = from.includes('<') ? from.split('<')[1].replace('>', '').trim() : from;
            send(`MAIL FROM:<${fromAddr}>`);
          } else if (step === 5 && code === 250) {
            step = 6;
            send(`RCPT TO:<${toEmail}>`);
          } else if (step === 6 && code === 250) {
            step = 7;
            send(`DATA`);
          } else if (step === 7 && code === 354) {
            step = 8;
            const emailData = [
              `From: ${from}`,
              `To: <${toEmail}>`,
              `Subject: ${otp} is your IOTA Academy Partner verification code`,
              `MIME-Version: 1.0`,
              `Content-Type: text/html; charset=UTF-8`,
              ``,
              htmlBody,
              `.`
            ].join('\r\n');
            send(emailData);
          } else if (step === 8 && code === 250) {
            clearTimeout(timeoutId);
            send(`QUIT`);
            socket.end();
            logger.info(`[Email Service] Successfully sent OTP email to ${toEmail} via socket.`);
            this.logEmailDiagnostic({
              timestamp: new Date().toISOString(),
              success: true,
              transport: 'socket',
              toEmail
            });
            resolve(true);
            return;
          } else if (code >= 400) {
            clearTimeout(timeoutId);
            socket.destroy();
            const errStr = `SMTP server rejected command: ${line}`;
            logger.error(`[Email Service Failure] ${errStr}`);
            this.logEmailDiagnostic({
              timestamp: new Date().toISOString(),
              success: false,
              transport: 'socket',
              error: errStr
            });
            reject(new AppError(`Email delivery failed: ${line}`, 400, 'SMTP_ERROR'));
            return;
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeoutId);
        logger.error(`[Email Service Socket Error] ${err.message}`);
        this.logEmailDiagnostic({
          timestamp: new Date().toISOString(),
          success: false,
          error: err.message
        });
        reject(new AppError(`Failed to connect to email server (${host}): ${err.message}`, 400, 'EMAIL_CONNECT_ERROR'));
      });
    });
  }

  /**
   * Send Email OTP
   */
  async sendOtp(
    rawEmail: string,
    context?: EmailOtpContext
  ): Promise<{ success: boolean; message: string; cooldown: number; expiresInSeconds: number; debugOtp?: string }> {
    const cleanEmail = this.normalizeEmail(rawEmail);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      throw new AppError('Please enter a valid email address', 400, 'INVALID_EMAIL');
    }

    const now = Date.now();
    const existing = this.otpStore.get(cleanEmail);

    if (existing && now - existing.lastSentAt < this.RESEND_COOLDOWN_SECONDS * 1000) {
      const remainingSeconds = Math.ceil((this.RESEND_COOLDOWN_SECONDS * 1000 - (now - existing.lastSentAt)) / 1000);
      throw new AppError(
        `Please wait ${remainingSeconds} seconds before requesting a new verification code.`,
        429,
        'EMAIL_OTP_COOLDOWN'
      );
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    this.otpStore.set(cleanEmail, {
      email: cleanEmail,
      otp,
      expiresAt: now + this.OTP_EXPIRY_MS,
      attempts: 0,
      lastSentAt: now,
      verified: false
    });

    let sent = false;
    try {
      sent = await this.dispatchSmtp(cleanEmail, otp, context);
    } catch (e: any) {
      const creds = this.getCredentials();
      const isConfigured = Boolean(creds.host && creds.user && creds.pass && creds.host !== 'smtp.example.com');
      if (isConfigured) {
        throw e;
      }
    }

    const creds = this.getCredentials();
    const isLive = Boolean(creds.host && creds.user && creds.pass && creds.host !== 'smtp.example.com' && sent);
    const isDev = process.env.NODE_ENV !== 'production' || !isLive;

    return {
      success: true,
      message: `A 6-digit verification code has been sent to ${cleanEmail}.`,
      cooldown: this.RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: Math.floor(this.OTP_EXPIRY_MS / 1000),
      debugOtp: isDev ? otp : undefined
    };
  }

  /**
   * Verify Email OTP
   */
  async verifyOtp(rawEmail: string, enteredOtp: string): Promise<{ success: boolean; verified: boolean; verificationToken: string; message: string }> {
    const cleanEmail = this.normalizeEmail(rawEmail);
    const cleanOtp = (enteredOtp || '').trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new AppError('Please enter a valid 6-digit OTP code', 400, 'INVALID_OTP');
    }

    const record = this.otpStore.get(cleanEmail);
    if (!record) {
      throw new AppError('No active OTP found for this email. Please request a new OTP.', 400, 'NO_OTP_FOUND');
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(cleanEmail);
      throw new AppError('The email OTP has expired. Please request a new one.', 400, 'OTP_EXPIRED');
    }

    if (record.attempts >= this.MAX_ATTEMPTS) {
      this.otpStore.delete(cleanEmail);
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

    record.verified = true;
    record.verifiedAt = Date.now();

    const verificationToken = this.generateVerificationToken(cleanEmail);

    return {
      success: true,
      verified: true,
      verificationToken,
      message: 'Email address verified successfully!'
    };
  }

  public isEmailVerified(rawEmail: string, verificationToken?: string | null): boolean {
    const cleanEmail = this.normalizeEmail(rawEmail);
    if (!cleanEmail) return false;

    if (verificationToken && this.verifyToken(verificationToken, cleanEmail)) {
      return true;
    }

    const record = this.otpStore.get(cleanEmail);
    if (record && record.verified && record.verifiedAt) {
      if (Date.now() - record.verifiedAt <= this.VERIFIED_VALIDITY_MS) {
        return true;
      }
    }

    return false;
  }

  /**
   * Internal generic mail dispatcher using nodemailer
   */
  public async sendCustomEmail(toEmail: string, subject: string, text: string, html: string): Promise<boolean> {
    const { host, port, secure, user, pass, from } = this.getCredentials();

    if (!host || !user || !pass || host === 'smtp.example.com') {
      logger.info(`[Email Sandbox] Live SMTP credentials not configured. Simulated email for ${toEmail}: ${subject}`);
      return false;
    }

    try {
      const nodemailer = require('nodemailer');
      const transportConfig: any = {
        auth: { user, pass }
      };

      if (host.includes('gmail') || host.includes('google')) {
        transportConfig.service = 'gmail';
      } else {
        transportConfig.host = host;
        transportConfig.port = port;
        transportConfig.secure = secure;
      }

      const transporter = nodemailer.createTransport(transportConfig);

      const info = await transporter.sendMail({
        from,
        to: toEmail,
        subject,
        text,
        html
      });

      logger.info(`[Email Service] Sent email to ${toEmail} via nodemailer. ID: ${info.messageId || 'OK'}`);
      this.logEmailDiagnostic({
        timestamp: new Date().toISOString(),
        success: true,
        transport: 'nodemailer',
        toEmail,
        subject,
        messageId: info.messageId
      });
      return true;
    } catch (e: any) {
      logger.error(`[Email Service] Failed to send email to ${toEmail}:`, e.message);
      return false;
    }
  }

  /**
   * Shared dark-mode-safe HTML wrapper for all IOTA Academy Affiliate Program emails
   */
  private wrapEmailHtml(opts: {
    title: string;
    bodyHtml: string;
    maxWidth?: number;
    footerText?: string;
  }): string {
    const maxWidth = opts.maxWidth ?? 580;
    const footerText =
      opts.footerText ?? '© 2026 TECHIOTA LLP (IOTA Academy). All rights reserved.';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${opts.title}</title>
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #0f172a !important; }
      .email-card { background-color: #1e293b !important; border-color: #334155 !important; }
      .email-body { color: #e2e8f0 !important; }
      .email-heading { color: #f8fafc !important; }
      .email-muted { color: #cbd5e1 !important; }
      .email-brand { color: #93c5fd !important; }
      .email-link { color: #60a5fa !important; }
      .email-divider { border-top-color: #334155 !important; }
      .email-footer { background-color: #0f172a !important; border-top-color: #334155 !important; }
      .callout-danger { background-color: #2b1619 !important; }
      .callout-warning { background-color: #292011 !important; }
      .callout-success { background-color: #0f2922 !important; }
      .callout-info { background-color: #172554 !important; }
      .callout-neutral { background-color: #0f172a !important; }
    }
    [data-ogsc] .email-bg { background-color: #0f172a !important; }
    [data-ogsc] .email-card { background-color: #1e293b !important; border-color: #334155 !important; }
    [data-ogsc] .email-body { color: #e2e8f0 !important; }
    [data-ogsc] .email-heading { color: #f8fafc !important; }
    [data-ogsc] .email-muted { color: #cbd5e1 !important; }
    [data-ogsc] .email-brand { color: #93c5fd !important; }
    [data-ogsc] .email-link { color: #60a5fa !important; }
    [data-ogsc] .email-divider { border-top-color: #334155 !important; }
    [data-ogsc] .email-footer { background-color: #0f172a !important; border-top-color: #334155 !important; }
    [data-ogsc] .callout-danger { background-color: #2b1619 !important; }
    [data-ogsc] .callout-warning { background-color: #292011 !important; }
    [data-ogsc] .callout-success { background-color: #0f2922 !important; }
    [data-ogsc] .callout-info { background-color: #172554 !important; }
    [data-ogsc] .callout-neutral { background-color: #0f172a !important; }
  </style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table class="email-bg" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table class="email-card" width="100%" style="max-width: ${maxWidth}px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          <tr>
            <td bgcolor="#1e3a8a" style="background-color: #1e3a8a; background-image: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 32px 30px; text-align: center;">
              <div style="background: #000000; mix-blend-mode: screen;">
                <div style="background: #000000; mix-blend-mode: difference;">
                  <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">IOTA ACADEMY</h1>
                  <p style="color: #e2e8f0; font-size: 13px; margin: 6px 0 0; font-weight: 500;">Affiliate Program</p>
                </div>
              </div>
            </td>
          </tr>
          <tr>
            <td class="email-body" style="padding: 36px 32px; color: #1e293b; font-size: 14px; line-height: 1.65;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td class="email-footer" style="background-color: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p class="email-muted" style="color: #94a3b8; font-size: 11px; margin: 0;">${footerText}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  /**
   * Send Welcome / Registration confirmation email to newly registered affiliate
   */
  public async sendAffiliateRegistrationEmail(toEmail: string, affiliateName: string): Promise<boolean> {
    const cleanEmail = this.normalizeEmail(toEmail);
    // Use only first name with Capital Case (e.g. "Hi Arvind" not "Hi Arvind Vishwakarma")
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const subject = 'Thank you for registering with the IOTA Academy Affiliate Program!';

    const textBody = `Hi ${firstName},

Thank you for registering with the IOTA Academy Affiliate Program!
Your profile has been successfully created and is currently Pending Approval.

What happens next?
Our team is reviewing your registration details. Please wait while this process is completed.
We will notify you within 7 business days with an update and the next steps to complete your KYC verification.
Once your profile is approved, you will receive further instructions to proceed with KYC document submission.

Thank you for your patience and interest in partnering with IOTA Academy.

Regards,
Team IOTA Academy
Website: https://affiliate.iotaacademy.in
Email: wecare@iotaacademy.in
WhatsApp: +91 89625 45150`;

    const htmlBody = this.wrapEmailHtml({
      title: 'IOTA Academy Affiliate Program',
      bodyHtml: `
              <p class="email-heading" style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${firstName},</p>
              <p style="margin: 0 0 16px;">Thank you for registering with the <strong>IOTA Academy Affiliate Program</strong>!</p>
              <p style="margin: 0 0 20px;">Your profile has been successfully created and is currently <strong>Pending Approval</strong>.</p>
              
              <div class="callout-neutral" style="background-color: #f1f5f9; border-left: 4px solid #2563eb; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;">
                <h3 class="email-heading" style="margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #0f172a;">What happens next?</h3>
                <p class="email-muted" style="margin: 0 0 8px; color: #334155; font-size: 13px;">• Our team is reviewing your registration details. Please wait while this process is completed.</p>
                <p class="email-muted" style="margin: 0 0 8px; color: #334155; font-size: 13px;">• We will notify you within <strong>7 business days</strong> with an update and the next steps to complete your KYC verification.</p>
                <p class="email-muted" style="margin: 0; color: #334155; font-size: 13px;">• Once your profile is approved, you will receive further instructions to proceed with KYC document submission.</p>
              </div>

              <p style="margin: 0 0 24px;">Thank you for your patience and interest in partnering with IOTA Academy.</p>

              <p style="margin: 0 0 4px; font-weight: 600;">Regards,</p>
              <p class="email-brand" style="margin: 0 0 16px; font-weight: 700; color: #1e3a8a;">Team IOTA Academy</p>

              <hr class="email-divider" style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">

              <table class="email-muted" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #475569;">
                <tr>
                  <td style="padding: 3px 0;"><strong>Website:</strong> <a class="email-link" href="https://affiliate.iotaacademy.in" style="color: #2563eb; text-decoration: none;" target="_blank">https://affiliate.iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><strong>Email:</strong> <a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><strong>WhatsApp:</strong> <a class="email-link" href="https://wa.me/918962545150" style="color: #2563eb; text-decoration: none;" target="_blank">+91 89625 45150</a></td>
                </tr>
              </table>`
    });

    return this.sendCustomEmail(cleanEmail, subject, textBody, htmlBody);
  }

  /**
   * Send Profile Rejection notification email to an affiliate
   */
  public async sendAffiliateRejectionEmail(toEmail: string, affiliateName: string): Promise<boolean> {
    const cleanEmail = this.normalizeEmail(toEmail);
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const subject = 'Update on your IOTA Academy Affiliate Program application';

    const textBody = `Hi ${firstName},
After reviewing your registration details, we regret to inform you that your affiliate profile has been rejected.
To understand the reason for rejection, please log in to your affiliate profile using the link below:
Login to Your Affiliate Profile:
https://affiliate.iotaacademy.in/login
You can view the rejection reason and related details directly in your profile.
For any clarification or assistance, please contact us at wecare@iotaacademy.in
Thank you for your interest in joining the IOTA Academy Affiliate Program.
Regards,
Affiliate Program Team
IOTA Academy
wecare@iotaacademy.in
https://www.iotaacademy.in`;

    const htmlBody = this.wrapEmailHtml({
      title: 'IOTA Academy Affiliate Program',
      bodyHtml: `
              <p class="email-heading" style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${firstName},</p>
              <p style="margin: 0 0 16px;">After reviewing your registration details, we regret to inform you that your affiliate profile has been rejected.</p>
              <p style="margin: 0 0 12px;">To understand the reason for rejection, please log in to your affiliate profile using the link below:</p>
              <div class="callout-danger" style="background-color: #fef2f2; border-left: 4px solid #dc2626; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
                <p style="margin: 0 0 8px; font-weight: 700; color: #ef4444;">Login to Your Affiliate Profile:</p>
                <p style="margin: 0;"><a class="email-link" href="https://affiliate.iotaacademy.in/login" style="color: #2563eb; font-weight: 600; text-decoration: none;" target="_blank">https://affiliate.iotaacademy.in/login</a></p>
              </div>
              <p style="margin: 0 0 16px;">You can view the rejection reason and related details directly in your profile.</p>
              <p style="margin: 0 0 16px;">For any clarification or assistance, please contact us at <a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></p>
              <p style="margin: 0 0 24px;">Thank you for your interest in joining the IOTA Academy Affiliate Program.</p>
              <p style="margin: 0 0 4px; font-weight: 600;">Regards,</p>
              <p class="email-brand" style="margin: 0 0 2px; font-weight: 700; color: #1e3a8a;">Affiliate Program Team</p>
              <p class="email-muted" style="margin: 0 0 16px; font-weight: 600; color: #334155;">IOTA Academy</p>
              <hr class="email-divider" style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <table class="email-muted" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #475569;">
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="https://www.iotaacademy.in" style="color: #2563eb; text-decoration: none;" target="_blank">https://www.iotaacademy.in</a></td>
                </tr>
              </table>`
    });

    return this.sendCustomEmail(cleanEmail, subject, textBody, htmlBody);
  }

  /**
   * Send KYC Revision notification email to an affiliate
   */
  public async sendAffiliateKycRevisedEmail(toEmail: string, affiliateName: string): Promise<boolean> {
    const cleanEmail = this.normalizeEmail(toEmail);
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const subject = 'Action Required: Update your IOTA Academy Affiliate KYC submission';

    const textBody = `Hi ${firstName},
Your KYC submission for the IOTA Academy Affiliate Program has been reviewed by our team.
Some updates are required before your KYC can be approved.
What should you do next?
Please log in to your affiliate profile to view the requested corrections and the details provided by our team.
Login to Your Affiliate Profile:
https://affiliate.iotaacademy.in/login
After completing the required updates, please resubmit your KYC for verification.
Need Assistance?
Email: wecare@iotaacademy.in
WhatsApp / Call: +91 89625 45150
Regards,
Affiliate Program Team
IOTA Academy
wecare@iotaacademy.in
https://www.iotaacademy.in`;

    const htmlBody = this.wrapEmailHtml({
      title: 'IOTA Academy Affiliate Program',
      bodyHtml: `
              <p class="email-heading" style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${firstName},</p>
              <p style="margin: 0 0 12px;">Your KYC submission for the IOTA Academy Affiliate Program has been reviewed by our team.</p>
              <p style="margin: 0 0 16px;">Some updates are required before your KYC can be approved.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">What should you do next?</p>
              <p style="margin: 0 0 16px;">Please log in to your affiliate profile to view the requested corrections and the details provided by our team.</p>
              <div class="callout-warning" style="background-color: #fffbeb; border-left: 4px solid #d97706; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
                <p style="margin: 0 0 8px; font-weight: 700; color: #d97706;">Login to Your Affiliate Profile:</p>
                <p style="margin: 0;"><a class="email-link" href="https://affiliate.iotaacademy.in/login" style="color: #2563eb; font-weight: 600; text-decoration: none;" target="_blank">https://affiliate.iotaacademy.in/login</a></p>
              </div>
              <p style="margin: 0 0 20px;">After completing the required updates, please resubmit your KYC for verification.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">Need Assistance?</p>
              <p style="margin: 0 0 4px;">Email: <a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></p>
              <p style="margin: 0 0 24px;">WhatsApp / Call: +91 89625 45150</p>
              <p style="margin: 0 0 4px; font-weight: 600;">Regards,</p>
              <p class="email-brand" style="margin: 0 0 2px; font-weight: 700; color: #1e3a8a;">Affiliate Program Team</p>
              <p class="email-muted" style="margin: 0 0 16px; font-weight: 600; color: #334155;">IOTA Academy</p>
              <hr class="email-divider" style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <table class="email-muted" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #475569;">
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="https://www.iotaacademy.in" style="color: #2563eb; text-decoration: none;" target="_blank">https://www.iotaacademy.in</a></td>
                </tr>
              </table>`
    });

    return this.sendCustomEmail(cleanEmail, subject, textBody, htmlBody);
  }

  /**
   * Send KYC Rejection notification email to an affiliate
   */
  public async sendAffiliateKycRejectedEmail(toEmail: string, affiliateName: string): Promise<boolean> {
    const cleanEmail = this.normalizeEmail(toEmail);
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const subject = 'Update on your IOTA Academy Affiliate KYC verification';

    const textBody = `Hi ${firstName},
We regret to inform you that your KYC verification for the IOTA Academy Affiliate Program has been rejected by our team.
View Your KYC Rejection Reason
To understand the reason for rejection, please log in to your affiliate profile using the link below:
Login to Your Affiliate Profile:
https://affiliate.iotaacademy.in/login
You can view the rejection reason and related details directly in your profile.
Need Assistance?
For any clarification or assistance, please contact us:
Email: wecare@iotaacademy.in
WhatsApp / Call: +91 89625 45150
Regards,
Affiliate Program Team
IOTA Academy
wecare@iotaacademy.in
https://www.iotaacademy.in`;

    const htmlBody = this.wrapEmailHtml({
      title: 'IOTA Academy Affiliate Program',
      bodyHtml: `
              <p class="email-heading" style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${firstName},</p>
              <p style="margin: 0 0 16px;">We regret to inform you that your KYC verification for the IOTA Academy Affiliate Program has been rejected by our team.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">View Your KYC Rejection Reason</p>
              <p style="margin: 0 0 12px;">To understand the reason for rejection, please log in to your affiliate profile using the link below:</p>
              <div class="callout-danger" style="background-color: #fef2f2; border-left: 4px solid #dc2626; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
                <p style="margin: 0 0 8px; font-weight: 700; color: #ef4444;">Login to Your Affiliate Profile:</p>
                <p style="margin: 0;"><a class="email-link" href="https://affiliate.iotaacademy.in/login" style="color: #2563eb; font-weight: 600; text-decoration: none;" target="_blank">https://affiliate.iotaacademy.in/login</a></p>
              </div>
              <p style="margin: 0 0 20px;">You can view the rejection reason and related details directly in your profile.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">Need Assistance?</p>
              <p style="margin: 0 0 8px;">For any clarification or assistance, please contact us:</p>
              <p style="margin: 0 0 4px;">Email: <a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></p>
              <p style="margin: 0 0 24px;">WhatsApp / Call: +91 89625 45150</p>
              <p style="margin: 0 0 4px; font-weight: 600;">Regards,</p>
              <p class="email-brand" style="margin: 0 0 2px; font-weight: 700; color: #1e3a8a;">Affiliate Program Team</p>
              <p class="email-muted" style="margin: 0 0 16px; font-weight: 600; color: #334155;">IOTA Academy</p>
              <hr class="email-divider" style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <table class="email-muted" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #475569;">
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="https://www.iotaacademy.in" style="color: #2563eb; text-decoration: none;" target="_blank">https://www.iotaacademy.in</a></td>
                </tr>
              </table>`
    });

    return this.sendCustomEmail(cleanEmail, subject, textBody, htmlBody);
  }

  /**
   * Send KYC Approval notification email to an affiliate
   */
  public async sendAffiliateKycApprovedEmail(toEmail: string, affiliateName: string): Promise<boolean> {
    const cleanEmail = this.normalizeEmail(toEmail);
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const subject = 'Congratulations! Your IOTA Academy Affiliate KYC is Approved';

    const textBody = `Hi ${firstName},
Congratulations!
Your KYC verification for the IOTA Academy Affiliate Program has been successfully approved by our team.
Your affiliate account is now Active, and you can start referring students to IOTA Academy.
Start Referring Students
Log in to your affiliate dashboard to access your unique referral link and QR code.
Access Your Affiliate Dashboard:
https://affiliate.iotaacademy.in/login
Your Next Step
Start sharing your referral link with students who are interested in learning Data, AI and Technology. Let them submit their enquiries through your referral link so our counselling team can guide them through the admission process.
Please follow the IOTA Academy Affiliate Program Terms and Conditions while referring students.
For assistance:
Email: wecare@iotaacademy.in
WhatsApp / Call: +91 89625 45150
Welcome aboard!
Regards,
Affiliate Program Team
IOTA Academy
wecare@iotaacademy.in
https://www.iotaacademy.in`;

    const htmlBody = this.wrapEmailHtml({
      title: 'IOTA Academy Affiliate Program',
      bodyHtml: `
              <p class="email-heading" style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${firstName},</p>
              <p style="margin: 0 0 12px; font-weight: 700; color: #10b981;">Congratulations!</p>
              <p style="margin: 0 0 12px;">Your KYC verification for the IOTA Academy Affiliate Program has been successfully approved by our team.</p>
              <p style="margin: 0 0 16px;">Your affiliate account is now <strong>Active</strong>, and you can start referring students to IOTA Academy.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">Start Referring Students</p>
              <p style="margin: 0 0 12px;">Log in to your affiliate dashboard to access your unique referral link and QR code.</p>
              <div class="callout-success" style="background-color: #ecfdf5; border-left: 4px solid #059669; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
                <p style="margin: 0;"><a href="https://affiliate.iotaacademy.in/login" style="color: #10b981; font-weight: 700; text-decoration: none;" target="_blank">Access Your Affiliate Dashboard</a></p>
              </div>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">Your Next Step</p>
              <p style="margin: 0 0 12px;">Start sharing your referral link with students who are interested in learning Data, AI and Technology. Let them submit their enquiries through your referral link so our counselling team can guide them through the admission process.</p>
              <p style="margin: 0 0 20px;">Please follow the IOTA Academy Affiliate Program Terms and Conditions while referring students.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">For assistance:</p>
              <p style="margin: 0 0 4px;">Email: <a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></p>
              <p style="margin: 0 0 16px;">WhatsApp / Call: +91 89625 45150</p>
              <p class="email-heading" style="margin: 0 0 20px; font-weight: 700; color: #0f172a;">Welcome aboard!</p>
              <p style="margin: 0 0 4px; font-weight: 600;">Regards,</p>
              <p class="email-brand" style="margin: 0 0 2px; font-weight: 700; color: #1e3a8a;">Affiliate Program Team</p>
              <p class="email-muted" style="margin: 0 0 16px; font-weight: 600; color: #334155;">IOTA Academy</p>
              <hr class="email-divider" style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <table class="email-muted" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #475569;">
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="https://www.iotaacademy.in" style="color: #2563eb; text-decoration: none;" target="_blank">https://www.iotaacademy.in</a></td>
                </tr>
              </table>`
    });

    return this.sendCustomEmail(cleanEmail, subject, textBody, htmlBody);
  }

  /**
   * Send Profile Approval (Proceed to KYC) notification email to an affiliate
   */
  public async sendAffiliateProfileApprovedEmail(toEmail: string, affiliateName: string): Promise<boolean> {
    const cleanEmail = this.normalizeEmail(toEmail);
    const rawFirst = (affiliateName || 'Partner').trim().split(/\s+/)[0] || 'Partner';
    const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();

    const subject = 'Your IOTA Academy Affiliate Profile is Approved — Complete KYC';

    const textBody = `Hi ${firstName},
Your profile for the IOTA Academy Affiliate Program has been successfully reviewed and approved by our team.
You can now proceed to the next step: KYC Verification.
Complete Your KYC Verification
Please log in to your affiliate profile and upload the required KYC documents to complete the verification process.
Login & Upload KYC Documents:
https://affiliate.iotaacademy.in/login
For any assistance, please contact us:
Email: wecare@iotaacademy.in
WhatsApp / Call: +91 89625 45150
Thank you for your interest in the IOTA Academy Affiliate Program. We look forward to completing your onboarding.
Regards,
Affiliate Program Team
IOTA Academy
wecare@iotaacademy.in
https://www.iotaacademy.in`;

    const htmlBody = this.wrapEmailHtml({
      title: 'IOTA Academy Affiliate Program',
      bodyHtml: `
              <p class="email-heading" style="margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #0f172a;">Hi ${firstName},</p>
              <p style="margin: 0 0 12px;">Your profile for the IOTA Academy Affiliate Program has been successfully reviewed and approved by our team.</p>
              <p style="margin: 0 0 16px;">You can now proceed to the next step: <strong>KYC Verification</strong>.</p>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">Complete Your KYC Verification</p>
              <p style="margin: 0 0 12px;">Please log in to your affiliate profile and upload the required KYC documents to complete the verification process.</p>
              <div class="callout-info" style="background-color: #eff6ff; border-left: 4px solid #2563eb; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
                <p style="margin: 0;"><a class="email-link" href="https://affiliate.iotaacademy.in/login" style="color: #2563eb; font-weight: 700; text-decoration: none;" target="_blank">Login &amp; Upload KYC Documents</a></p>
              </div>
              <p class="email-heading" style="margin: 0 0 6px; font-weight: 700; color: #0f172a;">For any assistance, please contact us:</p>
              <p style="margin: 0 0 4px;">Email: <a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></p>
              <p style="margin: 0 0 16px;">WhatsApp / Call: +91 89625 45150</p>
              <p style="margin: 0 0 20px;">Thank you for your interest in the IOTA Academy Affiliate Program. We look forward to completing your onboarding.</p>
              <p style="margin: 0 0 4px; font-weight: 600;">Regards,</p>
              <p class="email-brand" style="margin: 0 0 2px; font-weight: 700; color: #1e3a8a;">Affiliate Program Team</p>
              <p class="email-muted" style="margin: 0 0 16px; font-weight: 600; color: #334155;">IOTA Academy</p>
              <hr class="email-divider" style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <table class="email-muted" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #475569;">
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="mailto:wecare@iotaacademy.in" style="color: #2563eb; text-decoration: none;">wecare@iotaacademy.in</a></td>
                </tr>
                <tr>
                  <td style="padding: 3px 0;"><a class="email-link" href="https://www.iotaacademy.in" style="color: #2563eb; text-decoration: none;" target="_blank">https://www.iotaacademy.in</a></td>
                </tr>
              </table>`
    });

    return this.sendCustomEmail(cleanEmail, subject, textBody, htmlBody);
  }
}

export const emailOtpService = new EmailOtpService();
