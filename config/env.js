import 'dotenv/config';
import { z } from 'zod';
import { OPENAI_TTS_VOICES } from '../constants/enums.js';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const enabledByDefaultBooleanString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/compcri'),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-now'),
  JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-now'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  TRUST_PROXY: booleanString,
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  AI_PROVIDER: z.enum(['gemini', 'openai']).default('openai'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.7-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6-luna'),
  OPENAI_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-transcribe'),
  OPENAI_TTS_MODEL: z.string().default('tts-1'),
  OPENAI_TTS_VOICE: z.enum(OPENAI_TTS_VOICES).default('alloy'),
  OPENAI_VOICE_MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(10),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  AI_DAILY_QUOTA: z.coerce.number().int().positive().default(50),
  PAYWALL_ENABLED: enabledByDefaultBooleanString,
  REVENUECAT_SECRET_API_KEY: z.string().optional(),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  REVENUECAT_PREMIUM_ENTITLEMENT: z.string().default('premium'),
  REVENUECAT_MONTHLY_PRODUCT_IDS: z.string().default(''),
  REVENUECAT_YEARLY_PRODUCT_IDS: z.string().default(''),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Compcri <no-reply@compcri.local>'),
  SUPPORT_EMAIL: z.string().email().default('support@compcri.local'),
  ADMIN_EMAIL: z.string().email().default('admin@compcri.local'),
  ADMIN_PASSWORD: z.string().min(10).default('ChangeThisAdminPassword!'),
  APP_NAME: z.string().default('Compcri'),
  APP_URL: z.string().url().default('http://localhost:5000'),
  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  DISABLE_JOBS: booleanString
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;
  const required = [
    'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'GOOGLE_CLIENT_IDS',
    'GEMINI_API_KEY', 'OPENAI_API_KEY', 'REVENUECAT_SECRET_API_KEY', 'REVENUECAT_WEBHOOK_AUTH',
    'REVENUECAT_MONTHLY_PRODUCT_IDS', 'REVENUECAT_YEARLY_PRODUCT_IDS',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'SMTP_HOST'
  ];
  for (const key of required) {
    if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
  }
  if (value.JWT_ACCESS_SECRET.startsWith('development-')) ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'Development secret is forbidden in production' });
  if (value.JWT_REFRESH_SECRET.startsWith('development-')) ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Development secret is forbidden in production' });
  if (value.ADMIN_PASSWORD === 'ChangeThisAdminPassword!') ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: 'Default administrator password is forbidden in production' });
  if (value.ADMIN_EMAIL.endsWith('@compcri.local')) ctx.addIssue({ code: 'custom', path: ['ADMIN_EMAIL'], message: 'Development administrator email is forbidden in production' });
  if (value.SUPPORT_EMAIL.endsWith('@compcri.local')) ctx.addIssue({ code: 'custom', path: ['SUPPORT_EMAIL'], message: 'Development support email is forbidden in production' });
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${message}`);
}

const csv = (value) => value.split(',').map((part) => part.trim()).filter(Boolean);

export const env = Object.freeze({
  ...parsed.data,
  CORS_ORIGINS: csv(parsed.data.CORS_ORIGINS),
  GOOGLE_CLIENT_IDS: csv(parsed.data.GOOGLE_CLIENT_IDS),
  REVENUECAT_MONTHLY_PRODUCT_IDS: csv(parsed.data.REVENUECAT_MONTHLY_PRODUCT_IDS),
  REVENUECAT_YEARLY_PRODUCT_IDS: csv(parsed.data.REVENUECAT_YEARLY_PRODUCT_IDS),
  FIREBASE_PRIVATE_KEY: parsed.data.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
});
