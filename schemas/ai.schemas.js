import { z } from 'zod';
import { OPENAI_TTS_VOICES } from '../constants/enums.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const conversationBody = z.object({ calendarId: objectId, title: z.string().trim().min(1).max(160).optional() });
export const conversationParams = z.object({ id: objectId });
export const messageParams = z.object({ id: objectId, messageId: objectId });
export const actionParams = z.object({ id: objectId });
export const messageBody = z.object({ content: z.string().trim().min(1).max(10000) });
export const voiceMessageBody = z.object({ voice: z.enum(OPENAI_TTS_VOICES).optional() });
// Multipart fields arrive as strings; a muted client sends `speak=false`.
export const voiceStreamBody = voiceMessageBody.extend({
  speak: z.enum(['true', 'false']).default('true').transform((value) => value === 'true')
});
const isoDate = z.string().datetime({ offset: true });
// `startsAt`/`endsAt` book the proposal at one of its suggested free times.
export const confirmActionBody = z.object({
  overrideConflicts: z.boolean().default(false),
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional()
}).refine(
  (body) => Boolean(body.startsAt) === Boolean(body.endsAt) && (!body.startsAt || new Date(body.endsAt) > new Date(body.startsAt)),
  { message: 'startsAt and endsAt go together, and endsAt must be after startsAt', path: ['endsAt'] }
);
