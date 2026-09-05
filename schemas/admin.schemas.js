import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const userParams = z.object({ id: objectId });
export const userStatusBody = z.object({ action: z.enum(['SUSPEND', 'UNBLOCK']) });
export const deleteUserBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const adminProfileBody = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  displayName: z.string().trim().min(1).max(100).optional(),
  avatarMediaId: objectId.nullable().optional()
}).strict();
export const usersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  plan: z.enum(['FREE', 'PREMIUM']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
export const auditQuery = z.object({
  action: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
