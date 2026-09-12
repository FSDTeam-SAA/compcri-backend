import { mkdir, writeFile } from 'node:fs/promises';
import { openapi } from '../docs/openapi.js';

const outputDirectory = new URL('../docs/postman/', import.meta.url);
const collectionFile = new URL('Compcri-v1.postman_collection.json', outputDirectory);
const environmentFile = new URL('Compcri-local.postman_environment.json', outputDirectory);

const publicPaths = new Set([
  '/auth/register', '/auth/login', '/auth/google', '/auth/refresh', '/auth/logout',
  '/auth/forgot-password', '/auth/verify-reset-otp', '/auth/reset-password', '/auth/cancel-deletion',
  '/webhooks/revenuecat', '/legal', '/legal/{type}', '/admin/auth/login'
]);

const sampleBodies = {
  'POST /auth/register': { email: 'user@example.com', password: 'SecurePassword123!', displayName: 'Example User', timeZone: 'Asia/Dhaka', termsVersion: 'v1', privacyVersion: 'v1', termsAccepted: true },
  'POST /auth/login': { email: 'user@example.com', password: 'SecurePassword123!' },
  'POST /auth/google': { idToken: 'GOOGLE_ID_TOKEN', termsVersion: 'v1', privacyVersion: 'v1', termsAccepted: true, timeZone: 'Asia/Dhaka' },
  'POST /auth/refresh': { refreshToken: '{{refreshToken}}' },
  'POST /auth/logout': { refreshToken: '{{refreshToken}}' },
  'POST /auth/forgot-password': { email: 'user@example.com' },
  'POST /auth/verify-reset-otp': { email: 'user@example.com', code: '123456' },
  'POST /auth/reset-password': { resetToken: '{{resetToken}}', password: 'NewSecurePassword123!' },
  'POST /auth/cancel-deletion': { email: 'user@example.com', password: 'SecurePassword123!' },
  'PATCH /users/me': { displayName: 'Updated User', locale: 'en', interests: ['productivity'], aiPersonalizationConsent: true },
  'PUT /users/me/password': { currentPassword: 'SecurePassword123!', newPassword: 'NewSecurePassword123!' },
  'PATCH /users/me/notification-preferences': { pushEnabled: true, reminders: true, invitations: true, groupUpdates: true, contactRequests: true, subscriptionUpdates: true },
  'POST /users/me/deletion': { password: 'SecurePassword123!', reason: 'No longer needed', storeBillingAcknowledged: true },
  'PATCH /calendars/{calendarId}/settings': { name: 'My Calendar', timeZone: 'Asia/Dhaka', availability: { workingDays: [1, 2, 3, 4, 5], workdayStart: '09:00', workdayEnd: '17:00' } },
  'POST /calendars/{calendarId}/events': { title: 'Project meeting', description: 'Weekly planning', startsAt: '2026-08-24T09:00:00.000Z', endsAt: '2026-08-24T10:00:00.000Z', timeZone: 'Asia/Dhaka', reminderMinutes: [15], overrideConflicts: false },
  'PATCH /events/{eventId}': { title: 'Updated project meeting', version: 0, overrideConflicts: false },
  'PATCH /events/{eventId}/completion': { completed: true, version: 0 },
  'POST /notes': { calendarId: '{{calendarId}}', title: 'Review prep', body: 'Ask Ana to move the review to Monday morning.', pinned: false },
  'PATCH /notes/{id}': { title: 'Review prep', body: 'Ask Ana to move the review to Monday morning.', pinned: true },
  'POST /events/{eventId}/shares': { targetType: 'USER', targetIds: ['{{contactId}}'], permission: 'RESPOND' },
  'PUT /events/{eventId}/recurrence-exception': { originalStartAt: '2026-08-31T09:00:00.000Z', cancelled: true, version: 0, overrideConflicts: false },
  'PUT /events/{eventId}/rsvp': { status: 'ACCEPTED' },
  'POST /delegations/lookup': { email: 'assistant@example.com' },
  'POST /delegations': { accountType: 'NEW', email: 'assistant@example.com', displayName: 'Assistant', password: 'AssistantPassword123!', preset: 'ADD_EDIT' },
  'PATCH /delegations/{id}': { preset: 'FULL_ACCESS' },
  'PATCH /contacts/{id}': { relation: 'Friend' },
  'POST /contact-requests': { contactCode: '{{contactCode}}', relation: 'Friend' },
  'PUT /contact-requests/{id}': { action: 'ACCEPT', relation: 'Friend' },
  'POST /groups': { name: 'Friends' },
  'POST /groups/join': { code: '{{groupCode}}' },
  'POST /groups/{id}/members': { userId: '{{userId}}', role: 'MEMBER' },
  'POST /groups/{id}/invitations': { userId: '{{userId}}', role: 'MEMBER' },
  'POST /groups/{id}/events': { title: 'Group meetup', startsAt: '2026-08-25T09:00:00.000Z', endsAt: '2026-08-25T10:00:00.000Z', timeZone: 'Asia/Dhaka', reminderMinutes: [30], overrideConflicts: false },
  'POST /groups/{id}/transfer': { userId: '{{memberId}}' },
  'PATCH /groups/{id}/members/{memberId}': { role: 'ADMIN' },
  'PUT /group-invitations/{id}': { action: 'ACCEPT' },
  'POST /ai/conversations': { calendarId: '{{calendarId}}', title: 'Schedule planning' },
  'POST /ai/conversations/{id}/messages': { content: 'Find a free 30-minute slot tomorrow afternoon.' },
  'PATCH /ai/conversations/{id}/messages/{messageId}': { content: 'Find a free 45-minute slot tomorrow afternoon.' },
  'POST /ai/actions/{id}/confirm': { overrideConflicts: false },
  'POST /devices': { token: 'FCM_DEVICE_TOKEN_AT_LEAST_20_CHARACTERS', platform: 'ANDROID' },
  'DELETE /devices': { token: 'FCM_DEVICE_TOKEN_AT_LEAST_20_CHARACTERS' },
  'POST /webhooks/revenuecat': { event: { id: 'event-id', app_user_id: '{{revenueCatAppUserId}}', type: 'INITIAL_PURCHASE', product_id: 'compcri_premium_monthly_android', store: 'PLAY_STORE', event_timestamp_ms: 1787452800000 } },
  'POST /support-requests': { name: 'Example User', email: 'user@example.com', note: 'I need help with my calendar.' },
  'POST /admin/auth/login': { email: 'admin@example.com', password: '{{adminPassword}}' },
  'PATCH /admin/users/{id}/status': { action: 'SUSPEND' },
  'DELETE /admin/users/{id}': { reason: 'Administrative deletion request' },
  'PATCH /admin/profile': { displayName: 'Compcri Administrator' },
  'PUT /admin/password': { currentPassword: '{{adminPassword}}', newPassword: 'NewAdminPassword123!' },
  'POST /media/{id}/claim': { targetType: 'USER', targetId: '{{userId}}' }
};

const queryStrings = {
  'GET /calendars/{calendarId}/events': 'from={{rangeFrom}}&to={{rangeTo}}',
  'GET /calendars/{calendarId}/availability': 'from={{rangeFrom}}&to={{rangeTo}}&durationMinutes=30',
  'GET /events/shared': 'from={{rangeFrom}}&to={{rangeTo}}',
  'DELETE /events/{eventId}': 'version={{eventVersion}}',
  'GET /contacts': 'search=',
  'GET /contacts/{id}/events': 'from={{rangeFrom}}&to={{rangeTo}}',
  'GET /contact-requests': 'direction=incoming',
  'GET /ai/quota': 'calendarId={{calendarId}}',
  'GET /ai/conversations': 'search=',
  'GET /notifications': 'unread=true&page=1&limit=20',
  'GET /legal': 'locale=en',
  'GET /legal/{type}': 'locale=en',
  'GET /admin/dashboard': 'period=month',
  'GET /admin/users': 'page=1&limit=20',
  'GET /admin/subscriptions': 'period=month',
  'GET /admin/audit-logs': 'page=1&limit=20'
};

const variableFor = (path, name) => {
  if (name === 'type') return 'legalType';
  if (name !== 'id') return name;
  if (path.startsWith('/media/')) return 'mediaId';
  if (path.startsWith('/delegations/')) return 'delegationId';
  if (path.startsWith('/contacts/')) return 'contactId';
  if (path.startsWith('/contact-requests/')) return 'contactRequestId';
  if (path.startsWith('/group-invitations/')) return 'groupInvitationId';
  if (path.startsWith('/groups/')) return 'groupId';
  if (path.startsWith('/ai/actions/')) return 'aiActionId';
  if (path.startsWith('/ai/conversations/')) return 'conversationId';
  if (path.startsWith('/notifications/')) return 'notificationId';
  if (path.startsWith('/admin/users/')) return 'userId';
  return name;
};

const postmanPath = (path) => path.replace(/\{([^}]+)\}/g, (_, name) => `{{${variableFor(path, name)}}}`);
const folderName = (path) => {
  const first = path.split('/').filter(Boolean)[0] || 'root';
  return first.charAt(0).toUpperCase() + first.slice(1);
};

const scripts = {
  'POST /auth/register': [
    "const data = pm.response.json().data;",
    "if (data?.accessToken) pm.environment.set('accessToken', data.accessToken);",
    "if (data?.refreshToken) pm.environment.set('refreshToken', data.refreshToken);",
    "if (data?.user?._id) pm.environment.set('userId', data.user._id);",
    "if (data?.user?.contactCode) pm.environment.set('ownContactCode', data.user.contactCode);",
    "if (data?.user?.revenueCatAppUserId) pm.environment.set('revenueCatAppUserId', data.user.revenueCatAppUserId);"
  ],
  'POST /auth/login': ["const data = pm.response.json().data; if (data?.accessToken) pm.environment.set('accessToken', data.accessToken); if (data?.refreshToken) pm.environment.set('refreshToken', data.refreshToken);"],
  'POST /auth/refresh': ["const data = pm.response.json().data; if (data?.accessToken) pm.environment.set('accessToken', data.accessToken); if (data?.refreshToken) pm.environment.set('refreshToken', data.refreshToken);"],
  'GET /users/me': ["const data = pm.response.json().data; if (data?.primaryCalendar?._id) pm.environment.set('calendarId', data.primaryCalendar._id);"],
  'POST /calendars/{calendarId}/events': ["const event = pm.response.json().data?.event; if (event?._id) pm.environment.set('eventId', event._id); if (event?.__v !== undefined) pm.environment.set('eventVersion', event.__v);"],
  'POST /delegations': ["const data = pm.response.json().data; if (data?._id) pm.environment.set('delegationId', data._id);"],
  'POST /contact-requests': ["const data = pm.response.json().data; if (data?._id) pm.environment.set('contactRequestId', data._id);"],
  'POST /groups': ["const data = pm.response.json().data; if (data?._id) pm.environment.set('groupId', data._id); if (data?.code) pm.environment.set('groupCode', data.code);"],
  'POST /groups/{id}/invitations': ["const data = pm.response.json().data; if (data?._id) pm.environment.set('groupInvitationId', data._id);"],
  'POST /ai/conversations': ["const data = pm.response.json().data; if (data?._id) pm.environment.set('conversationId', data._id);"],
  'POST /ai/conversations/{id}/messages': ["const data = pm.response.json().data; const action = data?.pendingActions?.[0]; if (action?._id) pm.environment.set('aiActionId', action._id); if (data?.message?._id) pm.environment.set('messageId', data.message._id);"],
  'POST /ai/conversations/{id}/voice-messages': ["const data = pm.response.json().data; const action = data?.pendingActions?.[0]; if (action?._id) pm.environment.set('aiActionId', action._id); if (data?.message?._id) pm.environment.set('messageId', data.message._id);"],
  'POST /admin/auth/login': ["const data = pm.response.json().data; if (data?.accessToken) pm.environment.set('adminAccessToken', data.accessToken);"]
};

const folders = new Map();
for (const [path, pathItem] of Object.entries(openapi.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    const upperMethod = method.toUpperCase();
    const key = `${upperMethod} ${path}`;
    const convertedPath = postmanPath(path);
    const query = queryStrings[key];
    const rawUrl = `{{baseUrl}}/api/v1${convertedPath}${query ? `?${query}` : ''}`;
    const request = {
      method: upperMethod,
      header: [{ key: 'Accept', value: 'application/json' }],
      url: rawUrl,
      description: operation.summary
    };
    if (publicPaths.has(path)) request.auth = { type: 'noauth' };
    if (path.startsWith('/admin/') && path !== '/admin/auth/login') request.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{adminAccessToken}}', type: 'string' }] };
    if (path === '/webhooks/revenuecat') request.header.push({ key: 'Authorization', value: '{{revenueCatWebhookAuth}}' });

    if (path === '/media' && upperMethod === 'POST') {
      request.body = { mode: 'formdata', formdata: [{ key: 'purpose', value: 'AVATAR', type: 'text' }, { key: 'image', type: 'file', src: '' }] };
    } else if (path === '/media/{id}/replace' && upperMethod === 'PUT') {
      request.body = { mode: 'formdata', formdata: [{ key: 'image', type: 'file', src: '' }] };
    } else if (path === '/ai/conversations/{id}/voice-messages' && upperMethod === 'POST') {
      request.body = { mode: 'formdata', formdata: [{ key: 'voice', value: 'alloy', type: 'text' }, { key: 'audio', type: 'file', src: '' }] };
    } else if (sampleBodies[key]) {
      request.header.push({ key: 'Content-Type', value: 'application/json' });
      request.body = { mode: 'raw', raw: JSON.stringify(sampleBodies[key], null, 2), options: { raw: { language: 'json' } } };
    }

    const item = { name: `${upperMethod} — ${operation.summary}`, request };
    const testLines = ["pm.test('Success response contract', function () { pm.expect(pm.response.code).to.be.within(200, 299); pm.expect(pm.response.json().success).to.eql(true); });", ...(scripts[key] || [])];
    item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: testLines } }];
    const name = folderName(path);
    if (!folders.has(name)) folders.set(name, []);
    folders.get(name).push(item);
  }
}

const collection = {
  info: {
    _postman_id: '64e4fc72-939f-4b43-8b16-2ab6fd0822c0',
    name: 'Compcri AI Calendar API — v1',
    description: 'Generated from the Compcri OpenAPI 3.1 contract. Voice messages use OpenAI transcription, the configured text assistant, and MP3 speech generation. External calendars, coupons, and direct card handling are outside v1.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ["pm.request.headers.upsert({ key: 'X-Request-Id', value: pm.variables.replaceIn('{{$guid}}') });"] } }],
  item: [...folders.entries()].map(([name, item]) => ({ name, item }))
};

const secretVariables = new Set(['accessToken', 'refreshToken', 'adminAccessToken', 'adminPassword', 'revenueCatWebhookAuth', 'resetToken']);
const environmentValues = [
  ['baseUrl', 'http://localhost:5000'], ['accessToken', ''], ['refreshToken', ''], ['adminAccessToken', ''],
  ['adminPassword', ''], ['revenueCatWebhookAuth', ''], ['revenueCatAppUserId', ''], ['resetToken', ''],
  ['userId', ''], ['calendarId', ''], ['eventId', ''], ['eventVersion', '0'], ['mediaId', ''], ['shareId', ''],
  ['delegationId', ''], ['contactId', ''], ['contactCode', ''], ['contactRequestId', ''],
  ['groupId', ''], ['groupCode', ''], ['groupInvitationId', ''], ['memberId', ''],
  ['conversationId', ''], ['messageId', ''], ['aiActionId', ''], ['notificationId', ''], ['legalType', 'terms'],
  ['rangeFrom', '2026-08-01T00:00:00.000Z'], ['rangeTo', '2026-09-01T00:00:00.000Z']
].map(([key, value]) => ({ key, value, enabled: true, type: secretVariables.has(key) ? 'secret' : 'default' }));

const environment = {
  id: '28b19394-f9a8-48b5-b7f9-683c34483516',
  name: 'Compcri Local',
  values: environmentValues,
  _postman_variable_scope: 'environment',
  _postman_exported_using: 'Compcri generator'
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(collectionFile, `${JSON.stringify(collection, null, 2)}\n`),
  writeFile(environmentFile, `${JSON.stringify(environment, null, 2)}\n`)
]);
console.log(`Generated ${collection.item.reduce((count, folder) => count + folder.item.length, 0)} Postman requests.`);
