import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const title = z.string().trim().max(160);
const body = z.string().trim().min(1).max(20000);
const tags = z.array(z.string().trim().min(1).max(40)).max(10);
const boolish = z.enum(['true', 'false']).transform((value) => value === 'true');

export const noteParams = z.object({ id: objectId });

export const listNotesQuery = z.object({
  search: z.string().trim().max(100).optional(),
  eventId: objectId.optional(),
  pinned: boolish.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const createNoteBody = z.object({
  calendarId: objectId,
  title: title.optional(),
  body,
  eventId: objectId.optional(),
  pinned: z.boolean().optional(),
  tags: tags.optional()
});

export const updateNoteBody = z.object({
  title: title.optional(),
  body: body.optional(),
  eventId: objectId.nullable().optional(),
  pinned: z.boolean().optional(),
  tags: tags.optional()
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required');

/// Multipart fields arrive as strings, so booleans and lists are coerced here.
export const voiceNoteBody = z.object({
  calendarId: objectId,
  title: title.optional(),
  eventId: objectId.optional(),
  pinned: boolish.optional(),
  tags: z.string().trim().max(400).optional().transform((value) => value
    ? value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 10)
    : undefined)
});
