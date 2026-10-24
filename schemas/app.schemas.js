import { z } from 'zod';

export const installBody = z.object({
  installId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
  platform: z.string().transform((value) => value.toUpperCase()).pipe(z.enum(['IOS', 'ANDROID'])),
  appVersion: z.string().trim().max(40).optional(),
  osVersion: z.string().trim().max(80).optional(),
  locale: z.string().trim().max(20).optional(),
  preexisting: z.boolean().optional()
}).strict();
