import { z } from 'zod';

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(40).optional(),
  profession: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  locale: z.enum(['en', 'pt', 'es']).optional(),
  interests: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  aiPersonalizationConsent: z.boolean().optional(),
  avatarMediaId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional()
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128)
});

export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean().optional(),
  reminders: z.boolean().optional(),
  invitations: z.boolean().optional(),
  groupUpdates: z.boolean().optional(),
  contactRequests: z.boolean().optional(),
  subscriptionUpdates: z.boolean().optional()
}).strict();

export const deletionSchema = z.object({
  password: z.string().min(1).max(128),
  reason: z.string().trim().min(3).max(300),
  storeBillingAcknowledged: z.literal(true)
});

export const mongoIdParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
export const mediaUploadSchema = z.object({ purpose: z.enum(['AVATAR', 'EVENT_POSTER', 'SUPPORT_ATTACHMENT']) });
export const mediaClaimSchema = z.object({
  targetType: z.enum(['USER', 'EVENT', 'SUPPORT_REQUEST']),
  targetId: z.string().regex(/^[a-f\d]{24}$/i)
});
