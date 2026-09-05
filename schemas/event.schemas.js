import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const isoDate = z.string().datetime({ offset: true });
const timezone = z.string().min(1).max(100).refine((value) => {
  try { Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; }
}, 'Invalid IANA timezone');

export const calendarParams = z.object({ calendarId: objectId });
export const eventParams = z.object({ calendarId: objectId, eventId: objectId });
export const eventIdParams = z.object({ eventId: objectId });

export const listEventsQuery = z.object({
  from: isoDate,
  to: isoDate,
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
}).refine((data) => new Date(data.to) > new Date(data.from), { message: 'to must be after from', path: ['to'] });
export const sharedEventsQuery = z.object({ from: isoDate, to: isoDate })
  .refine((data) => new Date(data.to) > new Date(data.from), { message: 'to must be after from', path: ['to'] });

const eventShape = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(5000).optional(),
  posterMediaId: objectId.nullable().optional(),
  location: z.string().trim().max(300).optional(),
  startsAt: isoDate,
  endsAt: isoDate,
  timeZone: timezone,
  reminderMinutes: z.array(z.number().int().min(0).max(525600)).max(10).default([]),
  recurrenceRrule: z.string().trim().max(2000).nullable().optional(),
  groupId: objectId.nullable().optional(),
  overrideConflicts: z.boolean().default(false)
});

export const eventBody = eventShape.refine((data) => new Date(data.endsAt) > new Date(data.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const updateEventBody = eventShape.omit({ groupId: true }).partial().extend({ version: z.number().int().min(0), overrideConflicts: z.boolean().default(false) })
  .refine((data) => !data.startsAt || !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] });
export const completeBody = z.object({ completed: z.boolean(), version: z.number().int().min(0) });
export const shareBody = z.object({
  targetType: z.enum(['USER', 'GROUP']),
  targetIds: z.array(objectId).min(1).max(100),
  permission: z.enum(['VIEW_ONLY', 'RESPOND', 'EDIT'])
});
export const rsvpBody = z.object({ status: z.enum(['ACCEPTED', 'DECLINED', 'MAYBE']) });
export const availabilityQuery = z.object({ from: isoDate, to: isoDate, durationMinutes: z.coerce.number().int().min(5).max(1440).default(30) });

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const calendarSettingsBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timeZone: timezone.optional(),
  availability: z.object({
    workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((days) => [...new Set(days)]),
    workdayStart: clockTime,
    workdayEnd: clockTime
  }).refine((value) => value.workdayEnd > value.workdayStart, { message: 'workdayEnd must be after workdayStart', path: ['workdayEnd'] }).optional()
}).refine((value) => Object.keys(value).length > 0, 'At least one setting is required');

export const recurrenceExceptionBody = z.object({
  originalStartAt: isoDate,
  cancelled: z.boolean().default(false),
  overrides: z.object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(300).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional()
  }).optional(),
  version: z.number().int().min(0),
  overrideConflicts: z.boolean().default(false)
}).refine((value) => !value.overrides?.startsAt || !value.overrides?.endsAt || new Date(value.overrides.endsAt) > new Date(value.overrides.startsAt), {
  message: 'endsAt must be after startsAt', path: ['overrides', 'endsAt']
});

export const shareIdParams = z.object({ eventId: objectId, shareId: objectId });
