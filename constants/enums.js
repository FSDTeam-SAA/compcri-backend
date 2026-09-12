export const USER_ROLES = ['USER', 'ADMIN'];
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED'];
export const PLANS = ['FREE', 'PREMIUM'];
export const LOCALES = ['en', 'pt', 'es'];

export const DELEGATION_PRESETS = [
  'ADD_ONLY',
  'EDIT_ONLY',
  'ADD_EDIT',
  'DELETE_ONLY',
  'VIEW_EDIT_ALL',
  'VIEW_OWN',
  'FULL_ACCESS'
];

export const DELEGATION_CAPABILITIES = Object.freeze({
  ADD_ONLY: { view: 'OWN', create: true, edit: 'NONE', delete: 'NONE' },
  EDIT_ONLY: { view: 'OWN', create: false, edit: 'OWN', delete: 'NONE' },
  ADD_EDIT: { view: 'OWN', create: true, edit: 'OWN', delete: 'NONE' },
  DELETE_ONLY: { view: 'OWN', create: false, edit: 'NONE', delete: 'OWN' },
  VIEW_EDIT_ALL: { view: 'ALL', create: false, edit: 'ALL', delete: 'NONE' },
  VIEW_OWN: { view: 'OWN', create: false, edit: 'NONE', delete: 'NONE' },
  FULL_ACCESS: { view: 'ALL', create: true, edit: 'ALL', delete: 'ALL' }
});

export const EVENT_SHARE_PERMISSIONS = ['VIEW_ONLY', 'RESPOND', 'EDIT'];
export const RSVP_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'MAYBE'];
export const NOTIFICATION_CATEGORIES = [
  'REMINDER',
  'INVITATION',
  'GROUP_UPDATE',
  'CONTACT_REQUEST',
  'SECURITY',
  'SUBSCRIPTION'
];
export const NOTE_SOURCES = ['TEXT', 'VOICE'];
export const AI_ACTION_TYPES = ['CREATE_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT', 'CREATE_NOTE'];
export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar'
];
