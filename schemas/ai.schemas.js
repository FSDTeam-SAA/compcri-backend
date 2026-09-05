import { z } from 'zod';
import { OPENAI_TTS_VOICES } from '../constants/enums.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const conversationBody = z.object({ calendarId: objectId, title: z.string().trim().min(1).max(160).optional() });
export const conversationParams = z.object({ id: objectId });
export const messageParams = z.object({ id: objectId, messageId: objectId });
export const actionParams = z.object({ id: objectId });
export const messageBody = z.object({ content: z.string().trim().min(1).max(10000) });
export const voiceMessageBody = z.object({ voice: z.enum(OPENAI_TTS_VOICES).optional() });
export const confirmActionBody = z.object({ overrideConflicts: z.boolean().default(false) });
