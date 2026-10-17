import { z } from 'zod';
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const couponParams = z.object({ id: objectId });
export const couponsQuery = z.object({
 search: z.string().trim().max(100).optional(),
 status: z.enum(['ACTIVE', 'EXPIRED', 'SCHEDULED']).optional(),
 page: z.coerce.number().int().positive().default(1),
 limit: z.coerce.number().int().positive().max(100).default(9)
});
export const couponBody = z.object({
 name: z.string().trim().min(1).max(100),
 email: z.string().trim().toLowerCase().email(),
 avatarMediaId: objectId.optional(),
 code: z.string().trim().min(3).max(50).regex(/^[a-z\d_-]+$/i).transform(value => value.toUpperCase()),
 discountType: z.enum(['PERCENTAGE', 'FIXED']),
 discountValue: z.number().positive().max(1000000),
 commissionRate: z.number().min(0).max(100),
 startDate: z.iso.datetime(), endDate: z.iso.datetime(),
 totalUsageLimit: z.number().int().positive().max(10000000),
 perUserLimit: z.number().int().positive().max(10000000)
}).strict().superRefine((input, ctx) => {
 if (new Date(input.endDate) < new Date(input.startDate)) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date' });
 if (input.discountType === 'PERCENTAGE' && input.discountValue > 100) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percentage discount cannot exceed 100' });
 if (input.perUserLimit > input.totalUsageLimit) ctx.addIssue({ code: 'custom', path: ['perUserLimit'], message: 'Per user limit cannot exceed total usage limit' });
});