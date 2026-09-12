import { z } from 'zod';

export const aiToolDefinitions = [
  {
    name: 'list_events',
    description: 'List calendar events in an exact ISO date range.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        search: { type: 'string' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'find_availability',
    description: 'Find free calendar slots within an exact ISO date range.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        durationMinutes: { type: 'integer', minimum: 5, maximum: 1440 }
      },
      required: ['from', 'to', 'durationMinutes']
    }
  },
  {
    name: 'list_contacts',
    description: 'List the user contacts and relationship labels. Use only when required to answer the request.',
    parameters: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'list_groups',
    description: 'List groups the user currently belongs to. Use only when relevant to the request.',
    parameters: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'propose_create_event',
    description: 'Propose creating an event. This never writes immediately and requires user confirmation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        timeZone: { type: 'string' },
        reminderMinutes: { type: 'array', items: { type: 'integer' } },
        recurrenceRrule: { type: 'string' }
      },
      required: ['title', 'startsAt', 'endsAt', 'timeZone']
    }
  },
  {
    name: 'propose_update_event',
    description: 'Propose editing an event returned by list_events. Requires user confirmation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string' },
        version: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        timeZone: { type: 'string' },
        reminderMinutes: { type: 'array', items: { type: 'integer' } }
      },
      required: ['eventId', 'version']
    }
  },
  {
    name: 'propose_delete_event',
    description: 'Propose deleting an event returned by list_events. Requires user confirmation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { eventId: { type: 'string' }, version: { type: 'integer' } },
      required: ['eventId', 'version']
    }
  },
  {
    name: 'search_notes',
    description: "Search the user's saved notes by keyword. Use when the request refers to something they noted, jotted down, or recorded earlier.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        search: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      }
    }
  },
  {
    name: 'propose_create_note',
    description: 'Propose saving a note for the user. This never writes immediately and requires user confirmation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        eventId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['body']
    }
  }
];

const iso = z.string().datetime({ offset: true });
const timezone = z.string().min(1).max(100).refine((value) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Invalid IANA timezone');

export const aiToolSchemas = {
  list_events: z.object({ from: iso, to: iso, search: z.string().trim().max(100).optional() }),
  find_availability: z.object({ from: iso, to: iso, durationMinutes: z.number().int().min(5).max(1440) }),
  list_contacts: z.object({}),
  list_groups: z.object({}),
  propose_create_event: z.object({
    title: z.string().min(1).max(180),
    description: z.string().max(5000).optional(),
    location: z.string().max(300).optional(),
    startsAt: iso,
    endsAt: iso,
    timeZone: timezone,
    reminderMinutes: z.array(z.number().int().min(0).max(525600)).max(10).optional(),
    recurrenceRrule: z.string().max(2000).optional()
  }).refine((value) => new Date(value.endsAt) > new Date(value.startsAt)),
  propose_update_event: z.object({
    eventId: z.string().regex(/^[a-f\d]{24}$/i),
    version: z.number().int().min(0),
    title: z.string().min(1).max(180).optional(),
    description: z.string().max(5000).optional(),
    location: z.string().max(300).optional(),
    startsAt: iso.optional(),
    endsAt: iso.optional(),
    timeZone: timezone.optional(),
    reminderMinutes: z.array(z.number().int().min(0).max(525600)).max(10).optional()
  }),
  propose_delete_event: z.object({
    eventId: z.string().regex(/^[a-f\d]{24}$/i),
    version: z.number().int().min(0)
  }),
  search_notes: z.object({
    search: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(20).optional()
  }),
  propose_create_note: z.object({
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(20000),
    eventId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional()
  })
};

export const isMutationTool = (name) => name.startsWith('propose_');
