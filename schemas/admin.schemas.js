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
  sort: z.enum(['newest', 'lastActive', 'leastActive']).optional(),
  activeWithinDays: z.coerce.number().int().positive().max(3650).optional(),
  inactiveForDays: z.coerce.number().int().positive().max(3650).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const auditQuery = z.object({
  action: z.string().trim().max(100).optional(),
  actorId: objectId.optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
export const rangeQuery = z.object({ from: day.optional(), to: day.optional() });
export const financialQuery = rangeQuery.extend({ includeSandbox: flag.optional() });
export const transactionsQuery = financialQuery.extend({
  kind: z.enum(['NEW', 'RENEWAL', 'TRIAL_START', 'TRIAL_CONVERSION', 'REFUND', 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
