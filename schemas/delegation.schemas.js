import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const preset = z.enum(['ADD_ONLY', 'EDIT_ONLY', 'ADD_EDIT', 'DELETE_ONLY', 'VIEW_EDIT_ALL', 'VIEW_OWN', 'FULL_ACCESS']);

export const lookupSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const createDelegationSchema = z.discriminatedUnion('accountType', [
  z.object({
    accountType: z.literal('NEW'),
    email: z.string().trim().toLowerCase().email(),
    displayName: z.string().trim().min(1).max(100),
    password: z.string().min(10).max(128),
    preset
  }),
  z.object({
    accountType: z.literal('EXISTING'),
    userId: objectId,
    preset
  })
]);
export const updateDelegationSchema = z.object({ preset });
export const idParams = z.object({ id: objectId });

