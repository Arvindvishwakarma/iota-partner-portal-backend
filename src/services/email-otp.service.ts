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
  private async dispatchSmtp(toEmail: string, otp: string): Promise<boolean> {
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

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>IOTA Academy Partner Verification</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="540" style="max-width: 540px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 32px 30px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">IOTA ACADEMY</h1>
              <p style="color: #bfdbfe; font-size: 13px; margin: 6px 0 0; font-weight: 500;">Authorized Partner Registration</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="color: #0f172a; font-size: 18px; margin: 0 0 12px; font-weight: 700;">Verify Your Email Address</h2>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                Thank you for applying to the IOTA Academy Partner Program. Please use the verification code below to verify your email address:
              </p>
              
              <!-- OTP Box -->
              <div style="background-color: #f0fdf4; border: 2px dashed #86efac; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 24px;">
                <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #15803d;">${otp}</span>
              </div>

              <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 8px;">
                ⏳ This OTP is valid for <strong>10 minutes</strong>.
              </p>
              <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
                If you did not request this verification, please safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 11px; margin: 0;">
                © 2026 IOTA Academy. All rights reserved. | Sent from <strong>${from}</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

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
        subject: `${otp} is your IOTA Academy Partner verification code`,
        text: `Your IOTA Academy Partner verification code is: ${otp} (valid for 10 minutes).`,
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
  async sendOtp(rawEmail: string): Promise<{ success: boolean; message: string; cooldown: number; debugOtp?: string }> {
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
        `Please wait ${remainingSeconds} seconds before requesting a new email OTP.`,
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
      sent = await this.dispatchSmtp(cleanEmail, otp);
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
}

export const emailOtpService = new EmailOtpService();
