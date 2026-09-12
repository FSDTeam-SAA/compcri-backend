import { env } from '../config/env.js';
import { OPENAI_TTS_VOICES } from '../constants/enums.js';

const bearer = [{ bearerAuth: [] }];
const json = (schema) => ({ 'application/json': { schema } });
const success = (schema = { type: 'object' }) => ({ description: 'Success', content: json({ type: 'object', properties: { success: { const: true }, data: schema }, required: ['success', 'data'] }) });
const error = (description) => ({ description, content: json({ $ref: '#/components/schemas/Error' }) });
const errors = { 400: error('Invalid request'), 401: error('Authentication required'), 403: error('Forbidden'), 404: error('Not found'), 409: error('Conflict'), 422: error('Validation failed'), 429: error('Rate limited'), 502: error('Upstream response failed'), 503: error('Service unavailable'), 504: error('Upstream timeout') };
const operation = (summary, { security = bearer, requestBody, requestContent, parameters = [], status = 200 } = {}) => ({
  summary, security, parameters,
  ...((requestBody || requestContent) && { requestBody: { required: true, content: requestContent || json(requestBody) } }),
  responses: { [status]: success(), ...errors }
});
const id = (name) => ({ name, in: 'path', required: true, schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } });

export const openapi = {
  openapi: '3.1.0',
  info: { title: `${env.APP_NAME} Calendar API`, version: '1.0.0', description: 'Internal AI-powered calendar API with cost-efficient turn-based voice messaging. External calendar sync, coupons, and direct card collection are outside v1.' },
  servers: [{ url: `${env.APP_URL}/api/v1` }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { success: { const: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, details: {} }, required: ['code', 'message', 'requestId'] } } },
      UserRole: { type: 'string', enum: ['USER', 'ADMIN'] },
      UserStatus: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED'] },
      Plan: { type: 'string', enum: ['FREE', 'PREMIUM'] },
      DelegationPreset: { type: 'string', enum: ['ADD_ONLY', 'EDIT_ONLY', 'ADD_EDIT', 'DELETE_ONLY', 'VIEW_EDIT_ALL', 'VIEW_OWN', 'FULL_ACCESS'] },
      EventSharePermission: { type: 'string', enum: ['VIEW_ONLY', 'RESPOND', 'EDIT'] },
      RsvpStatus: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'MAYBE'] },
      NotificationCategory: { type: 'string', enum: ['REMINDER', 'INVITATION', 'GROUP_UPDATE', 'CONTACT_REQUEST', 'SECURITY', 'SUBSCRIPTION'] },
      AiActionType: { type: 'string', enum: ['CREATE_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT', 'CREATE_NOTE'] },
      NoteInput: { type: 'object', required: ['calendarId', 'body'], properties: { calendarId: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, eventId: { type: 'string' }, pinned: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } } },
      RegisterInput: { type: 'object', required: ['email', 'password', 'termsVersion', 'termsAccepted'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 10 }, displayName: { type: 'string' }, timeZone: { type: 'string' }, termsVersion: { type: 'string' }, privacyVersion: { type: 'string' }, termsAccepted: { const: true } } },
      LoginInput: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
      EventInput: { type: 'object', required: ['title', 'startsAt', 'endsAt', 'timeZone'], properties: { title: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, timeZone: { type: 'string' }, reminderMinutes: { type: 'array', items: { type: 'integer' } }, recurrenceRrule: { type: 'string' }, overrideConflicts: { type: 'boolean' } } }
    }
  },
  paths: {
    '/auth/register': { post: operation('Register', { security: [], requestBody: { $ref: '#/components/schemas/RegisterInput' }, status: 201 }) },
    '/auth/login': { post: operation('Login', { security: [], requestBody: { $ref: '#/components/schemas/LoginInput' } }) },
    '/auth/google': { post: operation('Google login', { security: [] }) },
    '/auth/refresh': { post: operation('Rotate refresh token', { security: [] }) },
    '/auth/logout': { post: operation('Revoke refresh token', { security: [] }) },
    '/auth/forgot-password': { post: operation('Request password-reset OTP', { security: [] }) },
    '/auth/verify-reset-otp': { post: operation('Verify password-reset OTP', { security: [] }) },
    '/auth/reset-password': { post: operation('Reset password', { security: [] }) },
    '/auth/cancel-deletion': { post: operation('Restore an account during its deletion grace period', { security: [] }) },
    '/users/me': { get: operation('Get current profile'), patch: operation('Update current profile') },
    '/users/me/password': { put: operation('Change current password') },
    '/users/me/calendars': { get: operation('List owned and delegated calendars') },
    '/users/me/notification-preferences': { patch: operation('Update push preferences') },
    '/users/me/subscription-management': { get: operation('Get store subscription-management URL') },
    '/users/me/deletion': { post: operation('Schedule recoverable account deletion') },
    '/media': { post: operation('Upload an owned image asset') },
    '/media/{id}': { delete: operation('Delete an unclaimed media asset', { parameters: [id('id')] }) },
    '/media/{id}/claim': { post: operation('Claim an owned image for an authorized target', { parameters: [id('id')] }) },
    '/media/{id}/replace': { put: operation('Replace an owned image while preserving its target', { parameters: [id('id')] }) },
    '/calendars/{calendarId}/events': { get: operation('List expanded event occurrences', { parameters: [id('calendarId')] }), post: operation('Create event', { parameters: [id('calendarId')], requestBody: { $ref: '#/components/schemas/EventInput' }, status: 201 }) },
    '/calendars/{calendarId}/availability': { get: operation('Find premium free-time slots', { parameters: [id('calendarId')] }) },
    '/calendars/{calendarId}/settings': { get: operation('Get calendar settings', { parameters: [id('calendarId')] }), patch: operation('Update owned calendar settings', { parameters: [id('calendarId')] }) },
    '/events/shared': { get: operation('List direct and dynamically resolved group-shared event occurrences') },
    '/events/{eventId}': { get: operation('Get accessible event', { parameters: [id('eventId')] }), patch: operation('Update event with optimistic version', { parameters: [id('eventId')] }), delete: operation('Cancel event with optimistic version', { parameters: [id('eventId')] }) },
    '/events/{eventId}/completion': { patch: operation('Set completion state', { parameters: [id('eventId')] }) },
    '/events/{eventId}/shares': { get: operation('List event shares', { parameters: [id('eventId')] }), post: operation('Share event with users or groups', { parameters: [id('eventId')] }) },
    '/events/{eventId}/shares/{shareId}': { delete: operation('Revoke event share', { parameters: [id('eventId'), id('shareId')] }) },
    '/events/{eventId}/recurrence-exception': { put: operation('Create or replace an occurrence exception', { parameters: [id('eventId')] }) },
    '/events/{eventId}/rsvp': { put: operation('Respond to event', { parameters: [id('eventId')] }) },
    '/delegations': { get: operation('List assistants'), post: operation('Create assistant access') },
    '/delegations/lookup': { post: operation('Lookup assistant email') },
    '/delegations/{id}': { get: operation('Get assistant access', { parameters: [id('id')] }), patch: operation('Update assistant preset', { parameters: [id('id')] }), delete: operation('Revoke assistant access', { parameters: [id('id')] }) },
    '/contacts': { get: operation('List contacts') },
    '/contacts/{id}': { patch: operation('Update your relationship label', { parameters: [id('id')] }), delete: operation('Remove contact', { parameters: [id('id')] }) },
    '/contacts/{id}/events': { get: operation('List directly shared contact events', { parameters: [id('id')] }) },
    '/contact-requests': { get: operation('List contact requests'), post: operation('Send contact request') },
    '/contact-requests/{id}': { put: operation('Accept or reject contact request', { parameters: [id('id')] }) },
    '/groups': { get: operation('List groups'), post: operation('Create group') },
    '/groups/join': { post: operation('Join group by code') },
    '/groups/{id}': { get: operation('Get group', { parameters: [id('id')] }), delete: operation('Delete owned group', { parameters: [id('id')] }) },
    '/groups/{id}/members': { post: operation('Add group member', { parameters: [id('id')] }) },
    '/groups/{id}/members/{memberId}': { patch: operation('Change group member role', { parameters: [id('id'), id('memberId')] }), delete: operation('Remove group member', { parameters: [id('id'), id('memberId')] }) },
    '/groups/{id}/invitations': { post: operation('Invite group member', { parameters: [id('id')] }) },
    '/groups/{id}/events': { post: operation('Create group event', { parameters: [id('id')], status: 201 }) },
    '/groups/{id}/transfer': { post: operation('Transfer group ownership', { parameters: [id('id')] }) },
    '/groups/{id}/leave': { post: operation('Leave group', { parameters: [id('id')] }) },
    '/group-invitations': { get: operation('List pending group invitations') },
    '/group-invitations/{id}': { put: operation('Accept or reject group invitation', { parameters: [id('id')] }) },
    '/ai/quota': { get: operation('Get owner-calendar AI quota') },
    '/ai/conversations': { get: operation('List AI conversations'), post: operation('Create AI conversation') },
    '/ai/conversations/{id}': { get: operation('Get AI conversation', { parameters: [id('id')] }), delete: operation('Delete AI conversation', { parameters: [id('id')] }) },
    '/ai/conversations/{id}/messages': { post: operation('Send text message to the AI assistant', { parameters: [id('id')] }) },
    '/ai/conversations/{id}/messages/stream': { post: operation('Send text message and stream the reply as server-sent events', { parameters: [id('id')] }) },
    '/ai/conversations/{id}/voice-messages': {
      post: operation('Send audio and receive a transcribed AI reply with MP3 speech', {
        parameters: [id('id')],
        requestContent: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['audio'],
              properties: {
                audio: { type: 'string', format: 'binary' },
                voice: { type: 'string', enum: OPENAI_TTS_VOICES }
              }
            }
          }
        }
      })
    },
    '/ai/conversations/{id}/messages/{messageId}': { patch: operation('Edit latest user message and regenerate', { parameters: [id('id'), id('messageId')] }), delete: operation('Delete conversation message', { parameters: [id('id'), id('messageId')] }) },
    '/ai/actions/{id}/confirm': { post: operation('Confirm a pending AI calendar mutation', { parameters: [id('id')] }) },
    '/ai/actions/{id}/reject': { post: operation('Reject a pending AI calendar mutation', { parameters: [id('id')] }) },
    '/notifications': { get: operation('List notification inbox') },
    '/notifications/read-all': { put: operation('Mark all notifications read') },
    '/notifications/{id}/read': { put: operation('Mark notification read', { parameters: [id('id')] }) },
    '/notifications/{id}': { delete: operation('Delete inbox notification', { parameters: [id('id')] }) },
    '/devices': { post: operation('Register FCM device'), delete: operation('Unregister FCM device') },
    '/notes': { get: operation('List personal notes'), post: operation('Create a note', { requestBody: { $ref: '#/components/schemas/NoteInput' }, status: 201 }) },
    '/notes/voice': { post: operation('Transcribe audio into a note', { requestContent: { 'multipart/form-data': { schema: { type: 'object', required: ['audio', 'calendarId'], properties: { audio: { type: 'string', format: 'binary' }, calendarId: { type: 'string' }, title: { type: 'string' }, eventId: { type: 'string' }, pinned: { type: 'string', enum: ['true', 'false'] }, tags: { type: 'string' } } } } }, status: 201 }) },
    '/notes/{id}': { get: operation('Get note', { parameters: [id('id')] }), patch: operation('Update note', { parameters: [id('id')] }), delete: operation('Delete note', { parameters: [id('id')] }) },
    '/subscriptions/me': { get: operation('Get RevenueCat entitlement snapshot') },
    '/subscriptions/reconcile': { post: operation('Reconcile RevenueCat subscriber') },
    '/webhooks/revenuecat': { post: operation('RevenueCat webhook', { security: [] }) },
    '/legal': { get: operation('List legal documents', { security: [] }) },
    '/legal/{type}': { get: operation('Get current legal document', { security: [], parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['terms', 'privacy'] } }] }) },
    '/support-requests': { post: operation('Submit Contact Us request') },
    '/admin/auth/login': { post: operation('Admin login', { security: [] }) },
    '/admin/dashboard': { get: operation('Admin dashboard') },
    '/admin/users': { get: operation('Admin user search') },
    '/admin/users/{id}': { get: operation('Admin user detail', { parameters: [id('id')] }), delete: operation('Schedule user deletion', { parameters: [id('id')] }) },
    '/admin/users/{id}/status': { patch: operation('Suspend or unblock user', { parameters: [id('id')] }) },
    '/admin/subscriptions': { get: operation('Admin subscription analytics') },
    '/admin/audit-logs': { get: operation('Admin audit log') },
    '/admin/profile': { get: operation('Get admin profile'), patch: operation('Update admin profile') },
    '/admin/password': { put: operation('Change admin password') }
  }
};
