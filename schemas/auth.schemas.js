import { z } from 'zod';
import { LOCALES } from '../constants/enums.js';

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(10).max(128);

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(100).optional(),
  timeZone: z.string().min(1).max(100).default('UTC'),
  termsVersion: z.string().min(1).max(30),
  privacyVersion: z.string().min(1).max(30).optional(),
  termsAccepted: z.literal(true),
  // The language the app was showing, so the account starts in it.
  locale: z.enum(LOCALES).optional()
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const googleSchema = z.object({
  idToken: z.string().min(20),
  termsVersion: z.string().min(1).max(30).optional(),
  privacyVersion: z.string().min(1).max(30).optional(),
  termsAccepted: z.literal(true).optional(),
  timeZone: z.string().min(1).max(100).default('UTC'),
  locale: z.enum(LOCALES).optional()
});
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const forgotSchema = z.object({ email });
export const verifyOtpSchema = z.object({ email, code: z.string().regex(/^\d{6}$/) });
export const resetPasswordSchema = z.object({ resetToken: z.string().min(20), password });
export const cancelDeletionSchema = z.object({ email, password: z.string().min(1).max(128) });
