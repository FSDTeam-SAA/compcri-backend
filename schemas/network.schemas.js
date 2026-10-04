import { z } from 'zod';
import { eventBody } from './event.schemas.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const idParams = z.object({ id: objectId });
export const contactRequestBody = z.object({ contactCode: z.string().trim().toUpperCase().min(5).max(30), relation: z.string().trim().max(80).optional() });
export const contactResponseBody = z.object({ action: z.enum(['ACCEPT', 'REJECT']), relation: z.string().trim().max(80).optional() });
export const contactRelationBody = z.object({ relation: z.string().trim().max(80).nullable() });
export const groupBody = z.object({ name: z.string().trim().min(1).max(120) });
export const joinGroupBody = z.object({ code: z.string().trim().toUpperCase().min(5).max(30) });
export const groupMemberBody = z.object({ userId: objectId, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') });
export const updateMemberBody = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });
export const groupInvitationBody = z.object({ userId: objectId, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') });
export const invitationResponseBody = z.object({ action: z.enum(['ACCEPT', 'REJECT']) });
export const transferOwnershipBody = z.object({ userId: objectId });
export const groupEventBody = eventBody;
