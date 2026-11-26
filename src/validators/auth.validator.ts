import { z } from 'zod';

const strongPasswordRule = z
  .string({ required_error: 'New password is required' })
  .min(8, 'New password must be at least 8 characters long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email or Mobile number is required' })
    .min(3, 'Please provide a valid email address or 10-digit mobile number')
    .trim(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(6, 'Password must be at least 6 characters long')
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password is required'),
  newPassword: strongPasswordRule
});

export const forgotPasswordEmailSendSchema = z.object({
  email: z
    .string({ required_error: 'Registered email address is required' })
    .email('Please provide a valid email address')
    .toLowerCase()
    .trim()
});

export const forgotPasswordEmailVerifySchema = z.object({
  email: z
    .string({ required_error: 'Registered email address is required' })
    .email('Please provide a valid email address')
    .toLowerCase()
    .trim(),
  code: z
    .string({ required_error: 'Verification code is required' })
    .trim()
    .regex(/^\d{6}$/, 'Verification code must be a 6-digit number')
});

export const forgotPasswordEmailResetSchema = z.object({
  email: z
    .string({ required_error: 'Registered email address is required' })
    .email('Please provide a valid email address')
    .toLowerCase()
    .trim(),
  resetToken: z.string({ required_error: 'Reset verification token is required' }).min(10),
  newPassword: strongPasswordRule
});

export const forgotPasswordWaSendSchema = z.object({
  mobile: z
    .string({ required_error: 'Registered WhatsApp / mobile number is required' })
    .trim()
    .transform((v) => v.replace(/\D/g, '').slice(-10))
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Please enter a valid 10-digit Indian mobile number starting with 6–9')
});

export const forgotPasswordWaVerifySchema = z.object({
  mobile: z
    .string({ required_error: 'Registered WhatsApp / mobile number is required' })
    .trim()
    .transform((v) => v.replace(/\D/g, '').slice(-10))
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Please enter a valid 10-digit Indian mobile number starting with 6–9'),
  otp: z
    .string({ required_error: 'Verification OTP is required' })
    .trim()
    .regex(/^\d{6}$/, 'OTP must be a 6-digit number'),
  otpSessionId: z.string().trim().max(120).optional()
});

export const forgotPasswordWaResetSchema = z.object({
  mobile: z
    .string({ required_error: 'Registered WhatsApp / mobile number is required' })
    .trim()
    .transform((v) => v.replace(/\D/g, '').slice(-10))
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Please enter a valid 10-digit Indian mobile number starting with 6–9'),
  resetToken: z.string({ required_error: 'Reset verification token is required' }).min(10),
  newPassword: strongPasswordRule
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

