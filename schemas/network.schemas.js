import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const idParams = z.object({ id: objectId });
export const contactRequestBody = z.object({ contactCode: z.string().trim().min(5).max(30), relation: z.string().trim().max(80).optional() });
export const contactResponseBody = z.object({ action: z.enum(['ACCEPT', 'REJECT']), relation: z.string().trim().max(80).optional() });
export const contactRelationBody = z.object({ relation: z.string().trim().max(80).nullable() });
export const groupBody = z.object({ name: z.string().trim().min(1).max(120) });
export const joinGroupBody = z.object({ code: z.string().trim().min(5).max(30) });
export const groupMemberBody = z.object({ userId: objectId, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') });
export const updateMemberBody = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });
export const groupInvitationBody = z.object({ userId: objectId, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') });
export const invitationResponseBody = z.object({ action: z.enum(['ACCEPT', 'REJECT']) });
export const transferOwnershipBody = z.object({ userId: objectId });
export const groupEventBody = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(5000).optional(),
  location: z.string().trim().max(300).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(100),
  reminderMinutes: z.array(z.number().int().min(0).max(525600)).max(10).default([]),
  overrideConflicts: z.boolean().default(false)
}).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] });
