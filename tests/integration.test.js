import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replset;
let app;
let mongoose;
let models;

const register = (email, displayName = 'Test User') => request(app)
  .post('/api/v1/auth/register')
  .send({ email, password: 'SecurePassword123!', displayName, timeZone: 'UTC', termsVersion: 'v1', termsAccepted: true });

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_JOBS = 'true';
  process.env.PAYWALL_ENABLED = 'true';
  process.env.MONGODB_URI = replset.getUri('compcri');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-123';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-456';
  process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer test-webhook-secret';
  process.env.AI_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_REASONING_EFFORT = 'none';
  process.env.OPENAI_TRANSCRIBE_MODEL = 'gpt-transcribe';
  process.env.OPENAI_TTS_MODEL = 'tts-1';
  process.env.OPENAI_TTS_VOICE = 'alloy';
  process.env.GOOGLE_CLIENT_IDS = 'test-google-client';
  ({ default: mongoose } = await import('mongoose'));
  ({ default: app } = await import('../app.js'));
  const database = await import('../config/database.js');
  await database.connectDatabase();
  models = await import('../models/index.js');
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});

afterAll(async () => {
  const database = await import('../config/database.js');
  await database.disconnectDatabase();
  await replset.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  const aiModule = await import('../services/ai.service.js');
  aiModule.resetAiProviderClientsForTests();
  await models.LegalDocument.create([
    { type: 'TERMS', version: 'v1', locale: 'en', title: 'Terms', content: 'Test terms', active: true },
    { type: 'PRIVACY', version: 'v1', locale: 'en', title: 'Privacy', content: 'Test privacy', active: true }
  ]);
});

describe('foundation and authentication', () => {
  it('publishes health and OpenAPI documents', async () => {
    const health = await request(app).get('/health/live').expect(200);
    expect(health.body.data.status).toBe('alive');
    const docs = await request(app).get('/openapi.json').expect(200);
    expect(docs.body.openapi).toBe('3.1.0');
    expect(docs.body.paths['/auth/register']).toBeTruthy();
    const documentedPaths = [
      '/auth/register', '/auth/login', '/auth/google', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/verify-reset-otp', '/auth/reset-password', '/auth/cancel-deletion',
      '/users/me', '/users/me/password', '/users/me/notification-preferences', '/users/me/calendars', '/users/me/subscription-management', '/users/me/deletion',
      '/media', '/media/{id}', '/media/{id}/claim', '/media/{id}/replace', '/calendars/{calendarId}/events', '/calendars/{calendarId}/availability', '/calendars/{calendarId}/settings', '/events/shared', '/events/{eventId}', '/events/{eventId}/completion', '/events/{eventId}/shares', '/events/{eventId}/shares/{shareId}', '/events/{eventId}/recurrence-exception', '/events/{eventId}/rsvp',
      '/delegations', '/delegations/lookup', '/delegations/{id}', '/contacts', '/contacts/{id}', '/contacts/{id}/events', '/contact-requests', '/contact-requests/{id}', '/groups', '/groups/join', '/groups/{id}', '/groups/{id}/members', '/groups/{id}/members/{memberId}', '/groups/{id}/invitations', '/groups/{id}/events', '/groups/{id}/transfer', '/groups/{id}/leave', '/group-invitations', '/group-invitations/{id}',
      '/ai/quota', '/ai/conversations', '/ai/conversations/{id}', '/ai/conversations/{id}/messages', '/ai/conversations/{id}/messages/stream', '/ai/conversations/{id}/voice-messages', '/ai/conversations/{id}/voice-messages/stream', '/ai/conversations/{id}/messages/{messageId}', '/ai/actions/{id}/confirm', '/ai/actions/{id}/reject', '/notifications', '/notifications/read-all', '/notifications/{id}/read', '/notifications/{id}', '/devices', '/notes', '/notes/voice', '/notes/{id}', '/subscriptions/me', '/subscriptions/reconcile', '/webhooks/revenuecat', '/legal', '/legal/{type}', '/support-requests',
      '/admin/auth/login', '/admin/dashboard', '/admin/users', '/admin/users/{id}', '/admin/users/{id}/status', '/admin/subscriptions', '/admin/audit-logs', '/admin/profile', '/admin/password'
    ];
    expect(Object.keys(docs.body.paths).sort()).toEqual(documentedPaths.sort());
    for (const path of Object.values(docs.body.paths)) {
      for (const operation of Object.values(path)) {
        expect(operation.responses['422'].content['application/json'].schema.$ref).toBe('#/components/schemas/Error');
      }
    }
  });

  it('registers, rotates a session, rejects reuse, and gets the profile', async () => {
    const created = await register('person@example.com');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.user.contactCode).toBeTruthy();
    expect(created.body.data.user.revenueCatAppUserId).not.toBe('person@example.com');
    const accessToken = created.body.data.accessToken;
    const me = await request(app).get('/api/v1/users/me').set(auth(accessToken)).expect(200);
    expect(me.body.data.user.email).toBe('person@example.com');
    expect(me.body.data.primaryCalendar).toBeTruthy();

    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: created.body.data.refreshToken }).expect(200);
    expect(rotated.body.data.refreshToken).not.toBe(created.body.data.refreshToken);
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: created.body.data.refreshToken }).expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSE');
  });

  it('supports deletion restoration and purges after the grace period without claiming billing cancellation', async () => {
    const created = await register('delete@example.com').expect(201);
    await models.Subscription.updateOne({ userId: created.body.data.user._id }, { $set: { managementUrl: 'https://store.example/manage' } });
    const scheduled = await request(app).post('/api/v1/users/me/deletion').set(auth(created.body.data.accessToken)).send({
      password: 'SecurePassword123!', reason: 'Testing deletion', storeBillingAcknowledged: true
    }).expect(200);
    expect(scheduled.body.data.managementUrl).toBe('https://store.example/manage');
    expect(scheduled.body.data.message).toContain('does not cancel');
    await request(app).get('/api/v1/users/me').set(auth(created.body.data.accessToken)).expect(403);

    const restored = await request(app).post('/api/v1/auth/cancel-deletion').send({ email: 'delete@example.com', password: 'SecurePassword123!' }).expect(200);
    await request(app).post('/api/v1/users/me/deletion').set(auth(restored.body.data.accessToken)).send({
      password: 'SecurePassword123!', reason: 'Testing final purge', storeBillingAcknowledged: true
    }).expect(200);
    await models.AccountDeletion.updateOne({ userId: created.body.data.user._id, cancelledAt: null }, { $set: { purgeAt: new Date(Date.now() - 1000) } });
    const deletionService = await import('../services/accountDeletion.service.js');
    expect(await deletionService.purgeAccount(created.body.data.user._id)).toBe(true);
    expect(await models.User.exists({ _id: created.body.data.user._id })).toBeNull();
  });

  it('enforces password-reset OTP attempts and permits a verified reset', async () => {
    await register('reset@example.com').expect(201);
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'reset@example.com' }).expect(200);
    const crypto = await import('../utils/crypto.js');
    let otp = await models.Otp.findOne({ email: 'reset@example.com' }).sort({ createdAt: -1 });
    otp.codeHash = crypto.sha256('123456');
    await otp.save();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/api/v1/auth/verify-reset-otp').send({ email: 'reset@example.com', code: '000000' }).expect(400);
    }
    const blocked = await request(app).post('/api/v1/auth/verify-reset-otp').send({ email: 'reset@example.com', code: '123456' }).expect(429);
    expect(blocked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');

    await models.Otp.deleteMany({ email: 'reset@example.com' });
    otp = await models.Otp.create({ email: 'reset@example.com', purpose: 'PASSWORD_RESET', codeHash: crypto.sha256('654321'), expiresAt: new Date(Date.now() + 60000) });
    const verified = await request(app).post('/api/v1/auth/verify-reset-otp').send({ email: 'reset@example.com', code: '654321' }).expect(200);
    await request(app).post('/api/v1/auth/reset-password').send({ resetToken: verified.body.data.resetToken, password: 'ACompletelyNewPassword123!' }).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: 'reset@example.com', password: 'ACompletelyNewPassword123!' }).expect(200);
  });

  it('validates Google identity and records legal versions for a new Google account', async () => {
    const authService = await import('../services/auth.service.js');
    authService.setGoogleClientForTests({
      verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ sub: 'google-subject-1', email: 'google@example.com', email_verified: true, name: 'Google User', given_name: 'Google' }) }))
    });
    await request(app).post('/api/v1/auth/google').send({ idToken: 'a-valid-looking-token-123' }).expect(422);
    const loggedIn = await request(app).post('/api/v1/auth/google').send({
      idToken: 'a-valid-looking-token-123', termsVersion: 'v1', privacyVersion: 'v1', termsAccepted: true, timeZone: 'UTC'
    }).expect(200);
    expect(loggedIn.body.data.user.email).toBe('google@example.com');
    expect(await models.LegalAcceptance.countDocuments({ userId: loggedIn.body.data.user._id })).toBe(2);
  });
});

describe('calendar, quota, conflicts, and delegation', () => {
  it('creates events, expands recurrence, detects premium conflicts, and enforces versions', async () => {
    const created = await register('calendar@example.com').expect(201);
    const token = created.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'calendar@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const event = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Weekly planning', startsAt: '2026-08-24T09:00:00.000Z', endsAt: '2026-08-24T10:00:00.000Z', timeZone: 'UTC',
      reminderMinutes: [], recurrenceRrule: 'FREQ=WEEKLY;COUNT=3'
    }).expect(201);
    const list = await request(app).get(`/api/v1/calendars/${calendarId}/events?from=2026-08-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z`).set(auth(token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data).toHaveLength(3);

    const conflict = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Overlap', startsAt: '2026-08-24T09:30:00.000Z', endsAt: '2026-08-24T10:30:00.000Z', timeZone: 'UTC', reminderMinutes: []
    }).expect(409);
    expect(conflict.body.error.code).toBe('EVENT_CONFLICT');

    const stale = await request(app).patch(`/api/v1/events/${event.body.data.event._id}`).set(auth(token)).send({ title: 'Changed', version: 99 }).expect(409);
    expect(stale.body.error.code).toBe('EVENT_VERSION_CONFLICT');
  });

  it('blocks the 51st owned monthly occurrence on the free plan', async () => {
    const created = await register('free@example.com').expect(201);
    const token = created.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    const ownerId = created.body.data.user._id;
    await models.Event.insertMany(Array.from({ length: 50 }, (_, index) => ({
      calendarId, createdById: ownerId, title: `Event ${index + 1}`,
      startsAt: new Date(Date.UTC(2026, 7, 1, 0, index)), endsAt: new Date(Date.UTC(2026, 7, 1, 1, index)), timeZone: 'UTC'
    })));
    const limited = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Too many', startsAt: '2026-08-15T09:00:00.000Z', endsAt: '2026-08-15T10:00:00.000Z', timeZone: 'UTC', reminderMinutes: []
    }).expect(403);
    expect(limited.body.error.code).toBe('FREE_EVENT_LIMIT');
  });

  it('enforces delegate own-event scope and revocation', async () => {
    const owner = await register('owner@example.com', 'Owner').expect(201);
    const ownerToken = owner.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(ownerToken))).body.data.primaryCalendar._id;
    const delegation = await request(app).post('/api/v1/delegations').set(auth(ownerToken)).send({
      accountType: 'NEW', email: 'assistant@example.com', displayName: 'Assistant', password: 'AssistantPassword123!', preset: 'ADD_EDIT'
    }).expect(201);
    const assistant = await request(app).post('/api/v1/auth/login').send({ email: 'assistant@example.com', password: 'AssistantPassword123!' }).expect(200);
    const assistantToken = assistant.body.data.accessToken;
    const own = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(assistantToken)).send({
      title: 'Delegate event', startsAt: '2026-08-25T09:00:00.000Z', endsAt: '2026-08-25T10:00:00.000Z', timeZone: 'UTC', reminderMinutes: []
    }).expect(201);
    await request(app).patch(`/api/v1/events/${own.body.data.event._id}`).set(auth(assistantToken)).send({ title: 'Delegate edited', version: 0 }).expect(200);

    const ownerEvent = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(ownerToken)).send({
      title: 'Owner event', startsAt: '2026-08-26T09:00:00.000Z', endsAt: '2026-08-26T10:00:00.000Z', timeZone: 'UTC', reminderMinutes: []
    }).expect(201);
    await request(app).get(`/api/v1/events/${ownerEvent.body.data.event._id}`).set(auth(assistantToken)).expect(403);
    await request(app).delete(`/api/v1/delegations/${delegation.body.data._id}`).set(auth(ownerToken)).expect(200);
    const revoked = await request(app).get(`/api/v1/calendars/${calendarId}/events?from=2026-08-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z`).set(auth(assistantToken));
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(403);
  });

  it('stores local availability across DST and manages recurrence exceptions and shares', async () => {
    const owner = await register('settings@example.com').expect(201);
    const guest = await register('guest@example.com').expect(201);
    const token = owner.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'settings@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });

    await request(app).patch(`/api/v1/calendars/${calendarId}/settings`).set(auth(token)).send({
      timeZone: 'America/New_York', availability: { workingDays: [0], workdayStart: '09:00', workdayEnd: '10:00' }
    }).expect(200);
    const slots = await request(app).get(`/api/v1/calendars/${calendarId}/availability?from=2026-03-08T00:00:00.000Z&to=2026-03-09T00:00:00.000Z&durationMinutes=30`).set(auth(token)).expect(200);
    expect(slots.body.data[0].startsAt).toBe('2026-03-08T13:00:00.000Z');

    await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Local weekly time', startsAt: '2026-03-01T14:00:00.000Z', endsAt: '2026-03-01T15:00:00.000Z', timeZone: 'America/New_York',
      reminderMinutes: [], recurrenceRrule: 'FREQ=WEEKLY;COUNT=3'
    }).expect(201);
    const dstOccurrences = await request(app).get(`/api/v1/calendars/${calendarId}/events?from=2026-03-01T00:00:00.000Z&to=2026-03-20T00:00:00.000Z`).set(auth(token)).expect(200);
    expect(dstOccurrences.body.data.map((item) => item.occurrenceStartAt)).toEqual([
      '2026-03-01T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-15T13:00:00.000Z'
    ]);

    const event = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Recurring', startsAt: '2026-08-24T09:00:00.000Z', endsAt: '2026-08-24T10:00:00.000Z', timeZone: 'UTC',
      reminderMinutes: [], recurrenceRrule: 'FREQ=WEEKLY;COUNT=2'
    }).expect(201);
    await request(app).put(`/api/v1/events/${event.body.data.event._id}/recurrence-exception`).set(auth(token)).send({
      originalStartAt: '2026-08-31T09:00:00.000Z', cancelled: true, version: 0
    }).expect(200);
    const occurrences = await request(app).get(`/api/v1/calendars/${calendarId}/events?from=2026-08-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z`).set(auth(token)).expect(200);
    expect(occurrences.body.data).toHaveLength(1);

    const shares = await request(app).post(`/api/v1/events/${event.body.data.event._id}/shares`).set(auth(token)).send({
      targetType: 'USER', targetIds: [guest.body.data.user._id], permission: 'RESPOND'
    }).expect(200);
    const listed = await request(app).get(`/api/v1/events/${event.body.data.event._id}/shares`).set(auth(token)).expect(200);
    expect(listed.body.data).toHaveLength(1);
    const shared = await request(app).get('/api/v1/events/shared?from=2026-08-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z').set(auth(guest.body.data.accessToken)).expect(200);
    expect(shared.body.data).toHaveLength(1);
    expect(shared.body.data[0].sharePermission).toBe('RESPOND');
    await request(app).delete(`/api/v1/events/${event.body.data.event._id}/shares/${shares.body.data[0]._id}`).set(auth(token)).expect(200);
    const noLongerShared = await request(app).get('/api/v1/events/shared?from=2026-08-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z').set(auth(guest.body.data.accessToken)).expect(200);
    expect(noLongerShared.body.data).toHaveLength(0);
    await request(app).get(`/api/v1/events/${event.body.data.event._id}`).set(auth(guest.body.data.accessToken)).expect(403);
  });
});

describe('network, subscriptions, notifications, and AI', () => {
  it('creates contact relationships and groups', async () => {
    const alice = await register('alice@example.com', 'Alice').expect(201);
    const bob = await register('bob@example.com', 'Bob').expect(201);
    const bobCode = bob.body.data.user.contactCode;
    const contactRequest = await request(app).post('/api/v1/contact-requests').set(auth(alice.body.data.accessToken)).send({ contactCode: bobCode, relation: 'Friend' }).expect(201);
    const inbox = await request(app).get('/api/v1/notifications?unread=true').set(auth(bob.body.data.accessToken)).expect(200);
    expect(inbox.body.data[0].category).toBe('CONTACT_REQUEST');
    await request(app).put(`/api/v1/contact-requests/${contactRequest.body.data._id}`).set(auth(bob.body.data.accessToken)).send({ action: 'ACCEPT', relation: 'Friend' }).expect(200);
    const contacts = await request(app).get('/api/v1/contacts').set(auth(alice.body.data.accessToken)).expect(200);
    expect(contacts.body.data[0].user.email).toBe('bob@example.com');

    const group = await request(app).post('/api/v1/groups').set(auth(alice.body.data.accessToken)).send({ name: 'Friends' }).expect(201);
    await request(app).post('/api/v1/groups/join').set(auth(bob.body.data.accessToken)).send({ code: group.body.data.code }).expect(200);
    const detail = await request(app).get(`/api/v1/groups/${group.body.data._id}`).set(auth(alice.body.data.accessToken)).expect(200);
    expect(detail.body.data.members).toHaveLength(2);

    const charlie = await register('charlie@example.com', 'Charlie').expect(201);
    const invitation = await request(app).post(`/api/v1/groups/${group.body.data._id}/invitations`).set(auth(alice.body.data.accessToken)).send({
      userId: charlie.body.data.user._id, role: 'MEMBER'
    }).expect(201);
    const pending = await request(app).get('/api/v1/group-invitations').set(auth(charlie.body.data.accessToken)).expect(200);
    expect(pending.body.data).toHaveLength(1);
    await request(app).put(`/api/v1/group-invitations/${invitation.body.data._id}`).set(auth(charlie.body.data.accessToken)).send({ action: 'ACCEPT' }).expect(200);
  });

  it('deduplicates RevenueCat webhooks and exposes notifications', async () => {
    const user = await register('billing@example.com').expect(201);
    const payload = { event: { id: 'evt_1', app_user_id: user.body.data.user.revenueCatAppUserId, type: 'INITIAL_PURCHASE', product_id: 'monthly', store: 'PLAY_STORE', price: 8.99, currency: 'USD', event_timestamp_ms: Date.now() } };
    const first = await request(app).post('/api/v1/webhooks/revenuecat').set('Authorization', 'Bearer test-webhook-secret').send(payload);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.duplicate).toBe(false);
    const second = await request(app).post('/api/v1/webhooks/revenuecat').set('Authorization', 'Bearer test-webhook-secret').send(payload).expect(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(await models.RevenueCatEvent.countDocuments()).toBe(1);
  });

  it('uses mocked AI responses and keeps mutations pending until confirmation', async () => {
    const user = await register('ai@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'ai@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    const responses = [
      { functionCalls: [{ id: 'call1', name: 'propose_create_event', args: { title: 'AI meeting', startsAt: '2026-08-27T09:00:00.000Z', endsAt: '2026-08-27T10:00:00.000Z', timeZone: 'UTC' } }], usageMetadata: {} },
      { text: 'I prepared the event for your confirmation.', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 } }
    ];
    aiModule.setAiClientForTests({ chats: { create: () => ({ sendMessage: vi.fn(async () => responses.shift()) }) } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`).set(auth(token)).send({ content: 'Create a meeting tomorrow' }).expect(200);
    expect(reply.body.data.pendingActions).toHaveLength(1);
    expect(await models.Event.countDocuments()).toBe(0);
    const actionUrl = `/api/v1/ai/actions/${reply.body.data.pendingActions[0]._id}/confirm`;
    await request(app).post(actionUrl).set(auth(token)).send({ overrideConflicts: false }).expect(200);
    await request(app).post(actionUrl).set(auth(token)).send({ overrideConflicts: false }).expect(200);
    expect(await models.Event.countDocuments()).toBe(1);
  });

  it('streams a turn as it happens and ends with the saved message', async () => {
    const user = await register('stream@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'stream@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    const args = { title: 'Streamed meeting', startsAt: '2026-09-04T09:00:00.000Z', endsAt: '2026-09-04T10:00:00.000Z', timeZone: 'UTC' };
    const turns = [
      // The model thinks out loud, calls a tool, then writes the real answer.
      [{ text: 'Let me check' }, { functionCalls: [{ id: 'call-stream', name: 'propose_create_event', args }], usageMetadata: {} }],
      [{ text: 'I prepared ' }, { text: 'the event.' }, { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 } }]
    ];
    const sendMessageStream = vi.fn(async () => (async function* generate() {
      for (const chunk of turns.shift()) yield chunk;
    })());
    aiModule.setAiClientForTests({ chats: { create: () => ({ sendMessageStream }) } });

    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const response = await request(app)
      .post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages/stream`)
      .set(auth(token))
      .send({ content: 'Create a meeting' })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => callback(null, body));
      })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['x-accel-buffering']).toBe('no');
    const events = response.body
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)));

    expect(events.map((event) => event.type)).toEqual([
      'delta', 'reset', 'tools', 'delta', 'delta', 'done'
    ]);
    expect(events.find((event) => event.type === 'tools').names).toEqual(['propose_create_event']);
    // Everything after the last reset is exactly what was saved: the thinking
    // aloud before the tool call is retracted, not stitched onto the answer.
    const streamed = events.slice(events.findLastIndex((event) => event.type === 'reset'))
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    const done = events.at(-1);
    expect(streamed).toBe('I prepared the event.');
    expect(done.message.content).toBe('I prepared the event.');
    expect(done.pendingActions).toHaveLength(1);
    expect(await models.Event.countDocuments()).toBe(0);
  });

  it('reports a pre-flight failure as a normal HTTP error, not a stream', async () => {
    const user = await register('stream-free@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'stream-free@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    // The plan lapses before the turn is sent, so it dies before the model says
    // anything — the client needs the status code, not an SSE frame to unwrap.
    await models.User.updateOne({ email: 'stream-free@example.com' }, { $set: { plan: 'FREE', premiumUntil: null } });
    const response = await request(app)
      .post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages/stream`)
      .set(auth(token))
      .send({ content: 'Create a meeting' })
      .expect(403);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
  });

  it('uses OpenAI as the primary provider when selected', async () => {
    const user = await register('openai@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'openai@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    aiModule.setAiProviderForTests('openai');
    aiModule.setAiProviderClientForTests('openai', {
      responses: {
        create: vi.fn(async () => ({
          output: [],
          output_text: 'Your calendar is ready.',
          usage: { input_tokens: 12, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } }
        }))
      }
    });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content: 'What can you do?' }).expect(200);
    expect(reply.body.data.message.providerMetadata).toMatchObject({
      provider: 'openai', model: 'gpt-5.6-luna', fallbackUsed: false, primaryProvider: 'openai'
    });
    expect(await models.AiProviderUsage.exists({ calendarId, provider: 'openai', successes: 1 })).toBeTruthy();
  });

  it('processes a voice message through transcription, Luna, and MP3 speech generation', async () => {
    const user = await register('voice@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'voice@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    const transcribe = vi.fn(async () => ({
      text: 'What is on my calendar tomorrow?',
      languages: [{ code: 'en' }],
      usage: { type: 'duration', seconds: 2.5 }
    }));
    const createResponse = vi.fn(async () => ({
      output: [],
      output_text: 'You have no events tomorrow.',
      usage: { input_tokens: 18, output_tokens: 7 }
    }));
    const createSpeech = vi.fn(async () => ({
      arrayBuffer: vi.fn(async () => Uint8Array.from([0x49, 0x44, 0x33]).buffer)
    }));
    aiModule.setAiProviderClientForTests('openai', {
      responses: { create: createResponse },
      audio: { transcriptions: { create: transcribe }, speech: { create: createSpeech } }
    });

    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app)
      .post(`/api/v1/ai/conversations/${conversation.body.data._id}/voice-messages`)
      .set(auth(token))
      .field('voice', 'alloy')
      .attach('audio', Buffer.from('test webm audio'), { filename: 'message.webm', contentType: 'audio/webm' })
      .expect(200);

    expect(reply.body.data.transcription).toMatchObject({
      text: 'What is on my calendar tomorrow?', model: 'gpt-transcribe', durationSeconds: 2.5
    });
    expect(reply.body.data.message.content).toBe('You have no events tomorrow.');
    expect(reply.body.data.message.providerMetadata).toMatchObject({ provider: 'openai', model: 'gpt-5.6-luna' });
    expect(reply.body.data.audio).toMatchObject({
      available: true, encoding: 'base64', base64: 'SUQz', contentType: 'audio/mpeg', model: 'tts-1', voice: 'alloy'
    });
    expect(transcribe.mock.calls[0][0]).toMatchObject({ model: 'gpt-transcribe', response_format: 'json' });
    expect(createSpeech.mock.calls[0][0]).toMatchObject({ model: 'tts-1', voice: 'alloy', response_format: 'mp3' });
    expect(createResponse.mock.calls[0][0].instructions).toContain('spoken interaction');
    expect((await models.AiUsage.findOne({ calendarId })).requestCount).toBe(1);
  });

  it('streams a voice turn: transcript first, then the answer, then its speech piece by piece', async () => {
    const user = await register('voice-stream@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'voice-stream@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    const transcribe = vi.fn(async () => ({ text: 'What is on my calendar tomorrow?', usage: { type: 'duration', seconds: 2 } }));
    const answer = ['You have no events tomorrow. ', 'Enjoy the **free** day!'];
    const createResponse = vi.fn(async () => (async function* generate() {
      for (const delta of answer) yield { type: 'response.output_text.delta', delta };
      yield {
        type: 'response.completed',
        response: { output: [], output_text: answer.join(''), usage: { input_tokens: 18, output_tokens: 9 } }
      };
    })());
    // Each piece of "audio" is just its own text, so the order can be checked.
    const createSpeech = vi.fn(async ({ input }) => ({ arrayBuffer: async () => new TextEncoder().encode(input).buffer }));
    aiModule.setAiProviderClientForTests('openai', {
      responses: { create: createResponse },
      audio: { transcriptions: { create: transcribe }, speech: { create: createSpeech } }
    });

    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const sendVoice = (fields) => {
      const call = request(app)
        .post(`/api/v1/ai/conversations/${conversation.body.data._id}/voice-messages/stream`)
        .set(auth(token));
      for (const [key, value] of Object.entries(fields)) call.field(key, value);
      return call
        .attach('audio', Buffer.from('test webm audio'), { filename: 'message.webm', contentType: 'audio/webm' })
        .buffer(true)
        .parse((res, callback) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => callback(null, body));
        })
        .expect(200);
    };
    const eventsOf = (response) => response.body
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)));

    const spoken = eventsOf(await sendVoice({ voice: 'nova' }));
    expect(spoken.map((event) => event.type)).toEqual(['transcript', 'delta', 'delta', 'done', 'audio', 'audio']);
    expect(spoken[0].transcription.text).toBe('What is on my calendar tomorrow?');
    expect(spoken[3].message.content).toBe(answer.join(''));
    expect(spoken[3].transcription.text).toBe('What is on my calendar tomorrow?');
    const audio = spoken.filter((event) => event.type === 'audio');
    expect(audio.map((event) => Buffer.from(event.base64, 'base64').toString())).toEqual([
      'You have no events tomorrow.', 'Enjoy the free day!'
    ]);
    expect(audio.map((event) => event.last)).toEqual([false, true]);
    // The first sentence was sent for synthesis while the answer was still
    // streaming, and reused rather than synthesized twice.
    expect(createSpeech).toHaveBeenCalledTimes(2);
    expect(createSpeech.mock.calls[0][0]).toMatchObject({ voice: 'nova', response_format: 'mp3' });
    expect(createResponse.mock.calls[0][0].instructions).toContain('spoken interaction');
    expect(createResponse.mock.calls[0][0].instructions).toContain("language of the user's latest message");
    expect(createResponse.mock.calls[0][0].reasoning).toEqual({ effort: 'none' });

    // A muted client asks for no speech at all.
    const muted = eventsOf(await sendVoice({ speak: 'false' }));
    expect(muted.map((event) => event.type)).toEqual(['transcript', 'delta', 'delta', 'done']);
    expect(createSpeech).toHaveBeenCalledTimes(2);
    expect((await models.AiUsage.findOne({ calendarId })).requestCount).toBe(2);
  });

  it('splits a streaming reply into exactly the speech pieces the finished reply produces', async () => {
    const { splitSpeechChunks } = await import('../services/ai/audio.js');
    const reply = 'Sure! I moved the 3.5 hour workshop to Friday at 9am. Your afternoon stays free for the dentist, '
      + 'and I kept the reminder at thirty minutes. Anything else you want me to change before the week starts?\n- Call Ana';
    const pieces = splitSpeechChunks(reply);
    expect(pieces[0]).toBe('Sure!');
    expect(pieces.at(-1)).toBe('Call Ana');
    for (let length = 0; length <= reply.length; length += 1) {
      const partial = splitSpeechChunks(reply.slice(0, length), { final: false });
      expect(pieces.slice(0, partial.length)).toEqual(partial);
    }
    // Replies in other languages start speaking at their first sentence too.
    expect(splitSpeechChunks('ঠিক আছে। শুক্রবার সকাল নয়টায় মিটিং রাখা হয়েছে।')[0]).toBe('ঠিক আছে।');
    expect(splitSpeechChunks('好的。会议已安排在周五上午九点。')[0]).toBe('好的。');
  });

  it('falls back from Gemini to OpenAI without persisting the failed attempt action', async () => {
    const user = await register('fallback-openai@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'fallback-openai@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    const args = { title: 'Fallback meeting', startsAt: '2026-09-02T09:00:00.000Z', endsAt: '2026-09-02T10:00:00.000Z', timeZone: 'UTC' };
    const geminiSend = vi.fn()
      .mockResolvedValueOnce({ functionCalls: [{ id: 'gemini-call', name: 'propose_create_event', args }], usageMetadata: { promptTokenCount: 10 } })
      .mockRejectedValueOnce(Object.assign(new Error('Gemini unavailable'), { status: 503 }));
    aiModule.setAiProviderClientForTests('gemini', { chats: { create: () => ({ sendMessage: geminiSend }) } });
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce({
        output: [{ type: 'function_call', call_id: 'openai-call', name: 'propose_create_event', arguments: JSON.stringify(args) }],
        usage: { input_tokens: 8, output_tokens: 3 }
      })
      .mockResolvedValueOnce({ output: [], output_text: 'I prepared the event for your confirmation.', usage: { input_tokens: 6, output_tokens: 5 } });
    aiModule.setAiProviderClientForTests('openai', { responses: { create: openAiCreate } });

    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content: 'Create a fallback meeting' }).expect(200);
    expect(reply.body.data.pendingActions).toHaveLength(1);
    expect(reply.body.data.message.providerMetadata).toMatchObject({ provider: 'openai', fallbackUsed: true, primaryProvider: 'gemini' });
    expect(await models.PendingAiAction.countDocuments()).toBe(1);
    expect(await models.AiProviderUsage.countDocuments({ calendarId })).toBe(2);
    expect((await models.AiUsage.findOne({ calendarId })).requestCount).toBe(1);
  });

  it('falls back from OpenAI to Gemini', async () => {
    const user = await register('fallback-gemini@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'fallback-gemini@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    aiModule.setAiProviderForTests('openai');
    aiModule.setAiProviderClientForTests('openai', {
      responses: { create: vi.fn(async () => { throw Object.assign(new Error('OpenAI unavailable'), { status: 503 }); }) }
    });
    aiModule.setAiProviderClientForTests('gemini', {
      chats: { create: () => ({ sendMessage: vi.fn(async () => ({ text: 'Gemini fallback response.', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4 } })) }) }
    });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content: 'Help with my calendar' }).expect(200);
    expect(reply.body.data.message.providerMetadata).toMatchObject({ provider: 'gemini', fallbackUsed: true, primaryProvider: 'openai' });
  });

  it('persists no pending actions when both provider attempts fail', async () => {
    const user = await register('both-fail@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'both-fail@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    const args = { title: 'Never persisted', startsAt: '2026-09-03T09:00:00.000Z', endsAt: '2026-09-03T10:00:00.000Z', timeZone: 'UTC' };
    aiModule.setAiProviderClientForTests('gemini', {
      chats: { create: () => ({ sendMessage: vi.fn()
        .mockResolvedValueOnce({ functionCalls: [{ id: 'g-fail', name: 'propose_create_event', args }], usageMetadata: {} })
        .mockRejectedValueOnce(Object.assign(new Error('Gemini unavailable'), { status: 503 })) }) }
    });
    aiModule.setAiProviderClientForTests('openai', {
      responses: { create: vi.fn()
        .mockResolvedValueOnce({ output: [{ type: 'function_call', call_id: 'o-fail', name: 'propose_create_event', arguments: JSON.stringify(args) }], usage: {} })
        .mockRejectedValueOnce(Object.assign(new Error('OpenAI unavailable'), { status: 503 })) }
    });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const response = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content: 'Create an event' }).expect(503);
    expect(response.body.error.code).toBe('AI_UNAVAILABLE');
    expect(await models.PendingAiAction.countDocuments()).toBe(0);
    expect((await models.AiUsage.findOne({ calendarId })).requestCount).toBe(1);
  });

  it('does not bypass a provider safety refusal with fallback', async () => {
    const user = await register('refusal@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'refusal@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    aiModule.setAiProviderClientForTests('gemini', {
      chats: { create: () => ({ sendMessage: vi.fn(async () => ({ promptFeedback: { blockReason: 'SAFETY' } })) }) }
    });
    const fallback = vi.fn();
    aiModule.setAiProviderClientForTests('openai', { responses: { create: fallback } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const response = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content: 'Unsafe request' }).expect(422);
    expect(response.body.error.code).toBe('AI_REQUEST_REFUSED');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not fallback for calendar business errors returned during tool execution', async () => {
    const user = await register('business-error@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'business-error@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const aiModule = await import('../services/ai.service.js');
    aiModule.setAiProviderClientForTests('gemini', {
      chats: { create: () => ({ sendMessage: vi.fn(async () => ({
        functionCalls: [{ id: 'missing-event', name: 'propose_update_event', args: { eventId: '64b000000000000000000099', version: 0, title: 'Changed' } }],
        usageMetadata: {}
      })) }) }
    });
    const fallback = vi.fn();
    aiModule.setAiProviderClientForTests('openai', { responses: { create: fallback } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const response = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content: 'Update an event that does not exist' }).expect(404);
    expect(response.body.error.code).toBe('EVENT_NOT_FOUND');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('applies the AI quota to the calendar owner before contacting a provider', async () => {
    const user = await register('quota@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'quota@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    await models.AiUsage.create({ calendarId, day: new Date().toISOString().slice(0, 10), requestCount: 50 });
    const response = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`).set(auth(token)).send({ content: 'What is on my schedule?' }).expect(429);
    expect(response.body.error.code).toBe('AI_QUOTA_EXHAUSTED');
    expect(response.body.error.details.resetAt).toMatch(/T00:00:00\.000Z$/);
  });
});

describe('notes', () => {
  it('derives a title, searches, pins to the top, and soft-deletes', async () => {
    const user = await register('notes@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;

    const derived = await request(app).post('/api/v1/notes').set(auth(token)).send({
      calendarId, body: 'Ask Ana to move the review to Monday. She is out on Friday.'
    }).expect(201);
    expect(derived.body.data.title).toBe('Ask Ana to move the review to Monday.');
    expect(derived.body.data.source).toBe('TEXT');

    const titled = await request(app).post('/api/v1/notes').set(auth(token)).send({
      calendarId, title: 'Groceries', body: 'Oat milk, lemons, coffee beans.'
    }).expect(201);

    const all = await request(app).get('/api/v1/notes').set(auth(token)).expect(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta.total).toBe(2);

    const found = await request(app).get('/api/v1/notes?search=lemons').set(auth(token)).expect(200);
    expect(found.body.data.map((note) => note._id)).toEqual([titled.body.data._id]);

    // Pinning wins over recency, so the older note leads the list.
    await request(app).patch(`/api/v1/notes/${derived.body.data._id}`).set(auth(token)).send({ pinned: true }).expect(200);
    const pinnedFirst = await request(app).get('/api/v1/notes').set(auth(token)).expect(200);
    expect(pinnedFirst.body.data[0]._id).toBe(derived.body.data._id);

    await request(app).delete(`/api/v1/notes/${titled.body.data._id}`).set(auth(token)).expect(200);
    await request(app).get(`/api/v1/notes/${titled.body.data._id}`).set(auth(token)).expect(404);
    const remaining = await request(app).get('/api/v1/notes').set(auth(token)).expect(200);
    expect(remaining.body.data).toHaveLength(1);
  });

  it('keeps notes private from calendar delegates and filters them by event', async () => {
    const owner = await register('noteowner@example.com', 'Owner').expect(201);
    const ownerToken = owner.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(ownerToken))).body.data.primaryCalendar._id;
    await request(app).post('/api/v1/delegations').set(auth(ownerToken)).send({
      accountType: 'NEW', email: 'noteassistant@example.com', displayName: 'Assistant', password: 'AssistantPassword123!', preset: 'FULL_ACCESS'
    }).expect(201);
    const assistant = await request(app).post('/api/v1/auth/login').send({ email: 'noteassistant@example.com', password: 'AssistantPassword123!' }).expect(200);
    const assistantToken = assistant.body.data.accessToken;

    const event = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(ownerToken)).send({
      title: 'Interview', startsAt: '2026-09-11T09:00:00.000Z', endsAt: '2026-09-11T10:00:00.000Z', timeZone: 'UTC', reminderMinutes: []
    }).expect(201);
    const eventId = event.body.data.event._id;

    const filed = await request(app).post('/api/v1/notes').set(auth(ownerToken)).send({
      calendarId, body: 'Prepare portfolio walkthrough.', eventId
    }).expect(201);
    await request(app).post('/api/v1/notes').set(auth(ownerToken)).send({ calendarId, body: 'Unrelated note.' }).expect(201);

    const byEvent = await request(app).get(`/api/v1/notes?eventId=${eventId}`).set(auth(ownerToken)).expect(200);
    expect(byEvent.body.data.map((note) => note._id)).toEqual([filed.body.data._id]);

    // Full calendar access never exposes the owner's personal notes.
    const delegateView = await request(app).get('/api/v1/notes').set(auth(assistantToken)).expect(200);
    expect(delegateView.body.data).toHaveLength(0);
    await request(app).get(`/api/v1/notes/${filed.body.data._id}`).set(auth(assistantToken)).expect(404);
    await request(app).patch(`/api/v1/notes/${filed.body.data._id}`).set(auth(assistantToken)).send({ pinned: true }).expect(404);
  });

  it('rejects a note filed against an unreachable event', async () => {
    const user = await register('notelink@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    const stranger = await register('notestranger@example.com').expect(201);
    const strangerToken = stranger.body.data.accessToken;
    const strangerCalendar = (await request(app).get('/api/v1/users/me').set(auth(strangerToken))).body.data.primaryCalendar._id;
    const hidden = await request(app).post(`/api/v1/calendars/${strangerCalendar}/events`).set(auth(strangerToken)).send({
      title: 'Private', startsAt: '2026-09-12T09:00:00.000Z', endsAt: '2026-09-12T10:00:00.000Z', timeZone: 'UTC', reminderMinutes: []
    }).expect(201);

    const rejected = await request(app).post('/api/v1/notes').set(auth(token)).send({
      calendarId, body: 'Trying to attach to an event I cannot see.', eventId: hidden.body.data.event._id
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(403);
    expect(rejected.body.error.code).toBe('EVENT_ACCESS_DENIED');
  });

  it('transcribes dictated audio into a note and keeps the spoken duration', async () => {
    const user = await register('voicenote@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    const aiModule = await import('../services/ai.service.js');
    const transcribe = vi.fn(async () => ({
      text: 'Book the dentist before the end of the month. Mornings are better.',
      languages: [{ code: 'en' }],
      usage: { type: 'duration', seconds: 9 }
    }));
    aiModule.setAiProviderClientForTests('openai', {
      audio: { transcriptions: { create: transcribe } }
    });

    const spoken = await request(app)
      .post('/api/v1/notes/voice')
      .set(auth(token))
      .field('calendarId', calendarId)
      .attach('audio', Buffer.from('test webm audio'), { filename: 'note.webm', contentType: 'audio/webm' })
      .expect(201);

    expect(spoken.body.data.transcription).toMatchObject({ model: 'gpt-transcribe', durationSeconds: 9 });
    expect(spoken.body.data.note).toMatchObject({
      source: 'VOICE',
      title: 'Book the dentist before the end of the month.',
      body: 'Book the dentist before the end of the month. Mornings are better.'
    });
    expect(spoken.body.data.note.voice).toMatchObject({ durationSeconds: 9, languages: ['en'] });
  });
});

describe('admin APIs', () => {
  it('authorizes administrators, aggregates the dashboard, suspends users, and writes audit records', async () => {
    const authService = await import('../services/auth.service.js');
    const crypto = await import('../utils/crypto.js');
    await models.User.create({
      email: 'admin@example.com', passwordHash: await authService.hashPassword('AdminPassword123!'), role: 'ADMIN',
      displayName: 'Admin', contactCode: 'ADMIN-100-AA', revenueCatAppUserId: crypto.randomUuid()
    });
    const member = await register('member@example.com').expect(201);
    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@example.com', password: 'AdminPassword123!' }).expect(200);
    const adminToken = login.body.data.accessToken;
    const dashboard = await request(app).get('/api/v1/admin/dashboard?period=month').set(auth(adminToken)).expect(200);
    expect(dashboard.body.data.totals.totalUsers).toBe(1);
    await request(app).patch(`/api/v1/admin/users/${member.body.data.user._id}/status`).set(auth(adminToken)).send({ action: 'SUSPEND' }).expect(200);
    await request(app).get('/api/v1/users/me').set(auth(member.body.data.accessToken)).expect(403);
    expect(await models.AuditLog.exists({ action: 'ADMIN_USER_SUSPEND', targetId: member.body.data.user._id })).toBeTruthy();
  });
});
