import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { DateTime } from 'luxon';

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
  // Fixed clock keeps scheduling fixtures valid as the calendar moves on.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  const aiModule = await import('../services/ai.service.js');
  aiModule.resetAiProviderClientsForTests();
  await models.LegalDocument.create([
    { type: 'TERMS', version: 'v1', locale: 'en', title: 'Terms', content: 'Test terms', active: true },
    { type: 'PRIVACY', version: 'v1', locale: 'en', title: 'Privacy', content: 'Test privacy', active: true }
  ]);
});

afterEach(() => vi.useRealTimers());

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
      '/media', '/media/{id}', '/media/{id}/claim', '/media/{id}/replace', '/calendars/{calendarId}/events', '/calendars/{calendarId}/availability', '/calendars/{calendarId}/conflicts','/calendars/{calendarId}/settings', '/events/shared', '/events/{eventId}', '/events/{eventId}/completion', '/events/{eventId}/shares', '/events/{eventId}/shares/{shareId}', '/events/{eventId}/recurrence-exception', '/events/{eventId}/rsvp',
      '/delegations', '/delegations/lookup', '/delegations/{id}', '/contacts', '/contacts/{id}', '/contacts/{id}/events', '/contact-requests', '/contact-requests/{id}', '/groups', '/groups/join', '/groups/{id}', '/groups/{id}/members', '/groups/{id}/members/{memberId}', '/groups/{id}/invitations', '/groups/{id}/events', '/groups/{id}/transfer', '/groups/{id}/leave', '/group-invitations', '/group-invitations/{id}',
      '/ai/quota', '/ai/voices/{voice}/preview', '/ai/conversations', '/ai/conversations/{id}', '/ai/conversations/{id}/messages', '/ai/conversations/{id}/messages/stream', '/ai/conversations/{id}/voice-messages', '/ai/conversations/{id}/voice-messages/stream', '/ai/conversations/{id}/messages/{messageId}', '/ai/conversations/{id}/messages/{messageId}/speech', '/ai/actions/{id}/confirm', '/ai/actions/{id}/reject', '/notifications', '/notifications/read-all', '/notifications/{id}/read', '/notifications/{id}', '/devices', '/notes', '/notes/voice', '/notes/{id}', '/subscriptions/me', '/subscriptions/reconcile', '/webhooks/revenuecat', '/legal', '/legal/{type}', '/support-requests',
      '/admin/auth/login', '/admin/dashboard', '/admin/users', '/admin/users/{id}', '/admin/users/{id}/status', '/admin/subscriptions', '/admin/audit-logs', '/admin/profile', '/admin/password', '/admin/coupons', '/admin/coupons/stats', '/admin/coupons/{id}'
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

  it('checks a proposed time live and suggests the nearest free alternatives', async () => {
    const created = await register('conflict-check@example.com').expect(201);
    const token = created.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'conflict-check@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const at = (time) => `${tomorrow}T${time}:00.000Z`;
    const existing = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Standup', startsAt: at('09:00'), endsAt: at('10:00'), timeZone: 'UTC', reminderMinutes: []
    }).expect(201);
    const check = (query) => request(app).get(`/api/v1/calendars/${calendarId}/conflicts`).query(query).set(auth(token)).expect(200);

    const clash = (await check({ startsAt: at('09:30'), endsAt: at('10:30') })).body.data;
    expect(clash.enforced).toBe(true);
    expect(clash.conflicts).toEqual([expect.objectContaining({ title: 'Standup', startsAt: at('09:00'), endsAt: at('10:00') })]);
    // Nearest first: straight after the clash, same length as the request.
    expect(clash.alternatives[0]).toEqual({ startsAt: at('10:00'), endsAt: at('11:00'), reason: 'AFTER_CONFLICT' });
    expect(clash.alternatives.length).toBeLessThanOrEqual(5);

    const free = (await check({ startsAt: at('13:00'), endsAt: at('14:00') })).body.data;
    expect(free).toMatchObject({ conflicts: [], alternatives: [] });
    // Moving the event itself never clashes with its own old time.
    const moving = (await check({ startsAt: at('09:30'), endsAt: at('10:30'), excludeEventId: existing.body.data.event._id })).body.data;
    expect(moving.conflicts).toEqual([]);

    // A save that clashes gets the same suggestions back with the refusal.
    const refused = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Overlap', startsAt: at('09:30'), endsAt: at('10:30'), timeZone: 'UTC', reminderMinutes: []
    }).expect(409);
    expect(refused.body.error.details.alternatives[0]).toMatchObject({ startsAt: at('10:00'), reason: 'AFTER_CONFLICT' });
  });

  it('lets an assistant proposal be booked at one of its suggested free times', async () => {
    const created = await register('ai-retime@example.com').expect(201);
    const token = created.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email: 'ai-retime@example.com' }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const at = (time) => `${tomorrow}T${time}:00.000Z`;
    await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Standup', startsAt: at('09:00'), endsAt: at('10:00'), timeZone: 'UTC', reminderMinutes: []
    }).expect(201);
    const aiModule = await import('../services/ai.service.js');
    const responses = [
      { functionCalls: [{ id: 'retime', name: 'propose_create_event', args: { title: 'Dentist', startsAt: at('09:30'), endsAt: at('10:30'), timeZone: 'UTC' } }], usageMetadata: {} },
      { text: 'That overlaps Standup, so pick a time.', usageMetadata: {} }
    ];
    aiModule.setAiClientForTests({ chats: { create: () => ({ sendMessage: vi.fn(async () => responses.shift()) }) } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`).set(auth(token)).send({ content: 'Dentist tomorrow 9:30' }).expect(200);
    const [action] = reply.body.data.pendingActions;
    expect(action.conflictWarnings).toHaveLength(1);
    const [suggestion] = action.suggestedTimes;
    expect(suggestion).toMatchObject({ startsAt: at('10:00'), endsAt: at('11:00'), reason: 'AFTER_CONFLICT' });

    await request(app).post(`/api/v1/ai/actions/${action._id}/confirm`).set(auth(token))
      .send({ overrideConflicts: false, startsAt: suggestion.startsAt, endsAt: suggestion.endsAt }).expect(200);
    const booked = await models.Event.findOne({ title: 'Dentist' });
    expect(booked.startsAt.toISOString()).toBe(at('10:00'));
    expect(booked.endsAt.toISOString()).toBe(at('11:00'));
  });

  it('answers in the requester\'s language: errors, profiles, and notifications', async () => {
    // Before sign-in, the language the app is showing decides.
    const anonymous = await request(app).get('/api/v1/users/me').set('Accept-Language', 'pt-BR').expect(401);
    expect(anonymous.body.error).toMatchObject({ code: 'AUTH_REQUIRED', message: 'Entre na sua conta para continuar' });

    // A new account keeps the language it signed up in and is answered in it.
    const created = await request(app).post('/api/v1/auth/register').send({
      email: 'hola@example.com', password: 'SecurePassword123!', displayName: 'Hola', timeZone: 'UTC', termsVersion: 'v1', termsAccepted: true, locale: 'es'
    }).expect(201);
    expect(created.body.data.user.locale).toBe('es');
    const missing = await request(app).get('/api/v1/ai/conversations/000000000000000000000000').set(auth(created.body.data.accessToken)).expect(404);
    expect(missing.body.error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversación no encontrada' });

    const { createNotification } = await import('../services/notification.service.js');
    const notification = await createNotification(created.body.data.user._id, 'GROUP_UPDATE', 'Added to a group', 'You were added to {group}', {}, { group: 'Club de lectura' });
    expect(notification).toMatchObject({ title: 'Añadido a un grupo', body: 'Te añadieron a Club de lectura' });

    const { formatDateTime } = await import('../utils/i18n.js');
    expect(formatDateTime('pt', new Date('2026-09-14T12:30:00.000Z'), 'America/Sao_Paulo')).toContain('09:30');
    // An explicit clock format wins over the language, and noon and midnight
    // never read as "12 AM" for noon or "0 PM".
    expect(formatDateTime('pt', new Date('2026-09-14T18:00:00.000Z'), 'UTC', true)).toContain('6:00 PM');
    expect(formatDateTime('en', new Date('2026-09-14T15:00:00.000Z'), 'UTC', false)).toContain('15:00');
    expect(formatDateTime('en', new Date('2026-09-14T12:00:00.000Z'), 'UTC', true)).toContain('12:00 PM');
    expect(formatDateTime('en', new Date('2026-09-14T00:00:00.000Z'), 'UTC', true)).toContain('12:00 AM');
    expect(formatDateTime('en', new Date('2026-09-14T00:00:00.000Z'), 'UTC', false)).toContain('00:00');
    const { uses24Hour } = await import('../utils/timeFormat.js');
    expect(uses24Hour({ locale: 'en' })).toBe(false);
    expect(uses24Hour({ locale: 'pt' })).toBe(true);
    expect(uses24Hour({ locale: 'en', deviceUses24Hour: true })).toBe(true);
    expect(uses24Hour({ locale: 'pt', timeFormat: 'H12', deviceUses24Hour: true })).toBe(false);
  });

  it('sends support the subject and screenshots, and keeps nothing when delivery fails', async () => {
    const created = await register('support@example.com').expect(201);
    const token = created.body.data.accessToken;
    const ownerId = created.body.data.user._id;
    const shot = (n) => models.MediaAsset.create({
      ownerId, purpose: 'SUPPORT_ATTACHMENT', publicId: `support/${n}`, secureUrl: `https://cdn.example.com/support/${n}.png`
    });
    const [first, second] = await Promise.all([shot(1), shot(2)]);
    const body = {
      name: 'Ana', email: 'ana@example.com', subject: 'Reminder not working',
      note: 'I set a reminder for 5 minutes before my event, but nothing rang.',
      mediaIds: [first._id.toString(), second._id.toString()]
    };
    const { setMailTransportForTests } = await import('../services/mailer.service.js');

    // Delivery fails: nothing is left behind, so sending again just works.
    setMailTransportForTests({ sendMail: vi.fn().mockRejectedValue(new Error('SMTP down')) });
    await request(app).post('/api/v1/support-requests').set(auth(token)).send(body).expect(500);
    expect(await models.SupportRequest.countDocuments()).toBe(0);
    expect(await models.MediaAsset.countDocuments({ claimedById: { $exists: true } })).toBe(0);

    const sendMail = vi.fn().mockResolvedValue({});
    setMailTransportForTests({ sendMail });
    try {
      const sent = await request(app).post('/api/v1/support-requests').set(auth(token)).send(body).expect(201);
      expect(sent.body.data).toMatchObject({ subject: 'Reminder not working', mediaIds: body.mediaIds });
    } finally {
      setMailTransportForTests(null);
    }
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('[Support] Reminder not working — Ana');
    expect(mail.text).toContain('Subject: Reminder not working');
    expect(mail.text).toContain('https://cdn.example.com/support/1.png');
    expect(mail.text).toContain('https://cdn.example.com/support/2.png');
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
      { functionCalls: [{ id: 'call1', name: 'propose_create_event', args: { title: 'AI meeting', startsAt: '2030-08-27T09:00:00.000Z', endsAt: '2030-08-27T10:00:00.000Z', timeZone: 'UTC' } }], usageMetadata: {} },
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
    const args = { title: 'Streamed meeting', startsAt: '2030-09-04T09:00:00.000Z', endsAt: '2030-09-04T10:00:00.000Z', timeZone: 'UTC' };
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

    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId });
    expect(conversation.status, JSON.stringify(conversation.body)).toBe(201);
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
      available: true, encoding: 'base64', base64: 'SUQz', contentType: 'audio/mpeg', model: 'tts-1', voice: 'nova'
    });
    expect(transcribe.mock.calls[0][0]).toMatchObject({ model: 'gpt-transcribe', response_format: 'json' });
    expect(createSpeech.mock.calls[0][0]).toMatchObject({ model: 'tts-1', voice: 'nova', response_format: 'mp3' });
    expect(createResponse.mock.calls[0][0].instructions).toContain('spoken interaction');
    expect((await models.AiUsage.findOne({ calendarId })).requestCount).toBe(1);
  });

  it('recreates missing answer speech without another AI turn, and protects other users history', async () => {
    const user = await register('replay@example.com').expect(201);
    const token = user.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ _id: user.body.data.user._id }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const conversation = await models.Conversation.create({
      userId: user.body.data.user._id, calendarId,
      messages: [{ role: 'USER', content: 'Olá' }, { role: 'ASSISTANT', content: 'Olá! Como posso ajudar?' }]
    });
    const ai = await import('../services/ai.service.js');
    const create = vi.fn(async () => ({ arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer }));
    ai.setAiProviderClientForTests('openai', { audio: { speech: { create } } });
    const path = `/api/v1/ai/conversations/${conversation._id}/messages/${conversation.messages[1]._id}/speech`;
    const response = await request(app).post(path).set(auth(token)).send({ voice: 'nova' }).expect(200);
    expect(response.body.data.clips.length).toBeGreaterThan(0);
    expect(response.body.data.clips[0]).toMatchObject({ base64: 'SUQz', contentType: 'audio/mpeg' });
    expect(await models.AiUsage.countDocuments()).toBe(0);
    expect(await models.PendingAiAction.countDocuments()).toBe(0);
    const unchanged = await models.Conversation.findById(conversation._id);
    expect(unchanged.messages).toHaveLength(2);
    expect(unchanged.updatedAt).toEqual(conversation.updatedAt);
    await request(app).post(`/api/v1/ai/conversations/${conversation._id}/messages/${conversation.messages[0]._id}/speech`).set(auth(token)).send({}).expect(404);
    const other = await register('other-replay@example.com').expect(201);
    const count = create.mock.calls.length;
    await request(app).post(path).set(auth(other.body.data.accessToken)).send({}).expect(404);
    await models.Conversation.deleteOne({ _id: conversation._id });
    await request(app).post(path).set(auth(token)).send({}).expect(404);
    expect(create).toHaveBeenCalledTimes(count);
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
    // Typing inside the same hands-free call also returns speech, with no
    // transcription request and no second conversation.
    aiModule.setAiProviderForTests('openai');
    const sendText = (fields) => request(app)
      .post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages/stream`)
      .set(auth(token)).send(fields).buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => callback(null, body));
      }).expect(200);
    const typed = eventsOf(await sendText({ content: 'Tell me again', speak: true, voice: 'nova' }));
    expect(typed.map((event) => event.type)).toEqual(['delta', 'delta', 'done', 'audio', 'audio']);
    expect(typed[2].message.content).toBe(answer.join(''));
    expect(createSpeech).toHaveBeenCalledTimes(4);
    expect(transcribe).toHaveBeenCalledTimes(2);
    const quietText = eventsOf(await sendText({ content: 'Thanks', speak: false }));
    expect(quietText.map((event) => event.type)).toEqual(['delta', 'delta', 'done']);
    expect(createSpeech).toHaveBeenCalledTimes(4);
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
    const args = { title: 'Fallback meeting', startsAt: '2030-09-02T09:00:00.000Z', endsAt: '2030-09-02T10:00:00.000Z', timeZone: 'UTC' };
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
    const args = { title: 'Never persisted', startsAt: '2030-09-03T09:00:00.000Z', endsAt: '2030-09-03T10:00:00.000Z', timeZone: 'UTC' };
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

describe('single-occurrence edits (QA F07/F08)', () => {
  const dailyEvent = async () => {
    const owner = await register('daily-edit@example.com').expect(201);
    const token = owner.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ _id: owner.body.data.user._id }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const created = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Daily appointment', description: 'Keep these notes', location: 'Office',
      startsAt: '2026-10-03T12:00:00.000Z', endsAt: '2026-10-03T13:00:00.000Z',
      timeZone: 'America/Sao_Paulo', reminderMinutes: [], recurrenceRrule: 'FREQ=DAILY;COUNT=3'
    }).expect(201);
    const eventId = created.body.data.event._id;
    const edit = (body, status = 200) => request(app).put(`/api/v1/events/${eventId}/recurrence-exception`).set(auth(token)).send(body).expect(status);
    const list = async (day) => (await request(app).get(`/api/v1/calendars/${calendarId}/events`).query({
      from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z`
    }).set(auth(token)).expect(200)).body.data;
    return { token, calendarId, eventId, edit, list };
  };

  it('saves a daily appointment at 10:30 and edits it again without losing its original slot or notes', async () => {
    const { edit, list } = await dailyEvent();
    const originalStartAt = '2026-10-03T12:00:00.000Z'; // 09:00 local
    await edit({ originalStartAt, version: 0, overrides: {
      startsAt: '2026-10-03T13:30:00.000Z', endsAt: '2026-10-03T14:30:00.000Z', description: 'Edited notes'
    } });
    const moved = (await list('2026-10-03'))[0];
    expect(moved.occurrenceOriginalStartAt).toBe(originalStartAt);
    expect(moved.startsAt).toBe(originalStartAt);
    expect(moved.occurrenceStartAt).toBe('2026-10-03T13:30:00.000Z');
    await edit({ originalStartAt: moved.occurrenceOriginalStartAt, version: 1, overrides: { title: 'Renamed' } });
    const renamed = (await list('2026-10-03'))[0];
    expect(renamed.occurrenceStartAt).toBe('2026-10-03T13:30:00.000Z');
    expect(renamed.occurrenceEndAt).toBe('2026-10-03T14:30:00.000Z');
    expect(renamed.description).toBe('Edited notes');
    expect(renamed.location).toBe('Office');
    await edit({ originalStartAt, version: 2, overrides: { startsAt: '2026-10-03T14:30:00.000Z' } });
    expect((await list('2026-10-03'))[0].occurrenceEndAt).toBe('2026-10-03T15:30:00.000Z');
    await edit({ originalStartAt, version: 3, overrides: { endsAt: '2026-10-03T14:00:00.000Z' } }, 422);
    expect((await list('2026-10-03'))[0].occurrenceEndAt).toBe('2026-10-03T15:30:00.000Z');
    await edit({ originalStartAt, version: 3, cancelled: true });
    expect(await list('2026-10-03')).toEqual([]);
    expect(await list('2026-10-04')).toHaveLength(1);
  });

  it('saves and preserves a reminder for just one daily occurrence', async () => {
    const { edit, list } = await dailyEvent();
    const originalStartAt = '2026-10-04T12:00:00.000Z';
    const updated = await edit({ originalStartAt, version: 0, overrides: { reminderMinutes: [15] } });
    expect(updated.body.data.event.reminderMinutes).toEqual([]);
    expect((await list('2026-10-04'))[0].reminderMinutes).toEqual([0, 15]);
    expect((await list('2026-10-03'))[0].reminderMinutes).toEqual([]);
    await edit({ originalStartAt, version: 1, overrides: { title: 'Keep the reminder' } });
    expect((await list('2026-10-04'))[0].reminderMinutes).toEqual([0, 15]);
    await edit({ originalStartAt, version: 2, overrides: { reminderMinutes: [] } });
    expect((await list('2026-10-04'))[0].reminderMinutes).toEqual([]);
    await edit({ originalStartAt, version: 3, overrides: { reminderMinutes: [525601] } }, 422);
  });

  it('keeps an occurrence moved outside its original day visible, shared, and busy at the new time', async () => {
    const { token, calendarId, eventId, edit, list } = await dailyEvent();
    const guest = await register('moved-guest@example.com').expect(201);
    await edit({ originalStartAt: '2026-10-04T12:00:00.000Z', version: 0, overrides: {
      startsAt: '2026-09-30T13:30:00.000Z', endsAt: '2026-09-30T14:30:00.000Z'
    } });
    expect(await list('2026-10-04')).toEqual([]);
    const moved = await list('2026-09-30');
    expect(moved).toHaveLength(1);
    expect(moved[0].occurrenceOriginalStartAt).toBe('2026-10-04T12:00:00.000Z');
    const busy = await request(app).get(`/api/v1/calendars/${calendarId}/conflicts`).query({
      startsAt: '2026-09-30T13:45:00.000Z', endsAt: '2026-09-30T14:00:00.000Z'
    }).set(auth(token)).expect(200);
    expect(busy.body.data.conflicts).toHaveLength(1);
    await request(app).post(`/api/v1/events/${eventId}/shares`).set(auth(token)).send({
      targetType: 'USER', targetIds: [guest.body.data.user._id], permission: 'RESPOND'
    }).expect(200);
    const shared = await request(app).get('/api/v1/events/shared').query({
      from: '2026-09-30T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z'
    }).set(auth(guest.body.data.accessToken)).expect(200);
    expect(shared.body.data).toHaveLength(1);
    expect(shared.body.data[0].occurrenceOriginalStartAt).toBe(moved[0].occurrenceOriginalStartAt);
    const contactRequest = await request(app).post('/api/v1/contact-requests').set(auth(token)).send({
      contactCode: guest.body.data.user.contactCode, relation: 'Friend'
    }).expect(201);
    await request(app).put(`/api/v1/contact-requests/${contactRequest.body.data._id}`).set(auth(guest.body.data.accessToken)).send({
      action: 'ACCEPT', relation: 'Friend'
    }).expect(200);
    const contactEvents = await request(app).get(`/api/v1/contacts/${guest.body.data.user._id}/events`).query({
      from: '2026-09-30T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z'
    }).set(auth(token)).expect(200);
    expect(contactEvents.body.data).toHaveLength(1);
    expect(contactEvents.body.data[0].occurrenceOriginalStartAt).toBe(moved[0].occurrenceOriginalStartAt);
  });

  it('addresses a moved occurrence by its original slot, leaving the series origin alone', async () => {
    const owner = await register('occurrence@example.com').expect(201);
    const token = owner.body.data.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;

    const created = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({
      title: 'Daily standup', startsAt: '2026-09-13T23:10:00.000Z', endsAt: '2026-09-13T23:30:00.000Z',
      timeZone: 'UTC', reminderMinutes: [], recurrenceRrule: 'FREQ=DAILY;COUNT=3'
    }).expect(201);
    const eventId = created.body.data.event._id;

    const range = `from=2026-09-13T00:00:00.000Z&to=2026-09-17T00:00:00.000Z`;
    const list = async () => (await request(app).get(`/api/v1/calendars/${calendarId}/events?${range}`).set(auth(token)).expect(200)).body.data;

    // Every row exposes the untouched slot it came from.
    const before = await list();
    expect(before.map((item) => item.occurrenceOriginalStartAt)).toEqual([
      '2026-09-13T23:10:00.000Z', '2026-09-14T23:10:00.000Z', '2026-09-15T23:10:00.000Z'
    ]);

    // Move the second occurrence twenty minutes later.
    await request(app).put(`/api/v1/events/${eventId}/recurrence-exception`).set(auth(token)).send({
      originalStartAt: '2026-09-14T23:10:00.000Z', version: 0,
      overrides: { startsAt: '2026-09-14T23:30:00.000Z', endsAt: '2026-09-14T23:50:00.000Z' }
    }).expect(200);

    const moved = (await list())[1];
    expect(moved.occurrenceStartAt).toBe('2026-09-14T23:30:00.000Z');
    // The moved time is no longer a recurrence slot, so only this still works.
    expect(moved.occurrenceOriginalStartAt).toBe('2026-09-14T23:10:00.000Z');

    // Sending the moved time back is exactly what the client used to do.
    await request(app).put(`/api/v1/events/${eventId}/recurrence-exception`).set(auth(token)).send({
      originalStartAt: moved.occurrenceStartAt, version: 1, cancelled: true
    }).expect(422);

    // Cancelling by the original slot removes that date and nothing else.
    await request(app).put(`/api/v1/events/${eventId}/recurrence-exception`).set(auth(token)).send({
      originalStartAt: moved.occurrenceOriginalStartAt, version: 1, cancelled: true
    }).expect(200);

    const after = await list();
    expect(after.map((item) => item.occurrenceOriginalStartAt)).toEqual([
      '2026-09-13T23:10:00.000Z', '2026-09-15T23:10:00.000Z'
    ]);
  });
});

describe('assistant availability answers (free/busy decided by the server)', () => {
  const ZONE = 'America/Sao_Paulo';

  // A premium user whose calendar lives in a UTC-3 zone, so a model that
  // compared UTC timestamps with the user's wall clock would get it wrong.
  const premiumUser = async (email) => {
    const user = await register(email).expect(201);
    const token = user.body.data.accessToken;
    const userId = user.body.data.user._id;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    await models.User.updateOne({ email }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    await models.Calendar.updateOne({ _id: calendarId }, { $set: { timeZone: ZONE } });
    return { token, userId, calendarId };
  };

  const tomorrow = () => DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate();
  const at = (time) => DateTime.fromISO(`${tomorrow()}T${time}`, { zone: ZONE }).toJSDate();

  const addEvent = (calendarId, userId, title, start, end) => models.Event.create({
    calendarId, createdById: userId, title, startsAt: at(start), endsAt: at(end), timeZone: ZONE
  });

  // Plays the model: asks for `calls` first, then answers. What the server
  // sent back for those calls is what the test inspects.
  const scriptModel = async (calls) => {
    const aiModule = await import('../services/ai.service.js');
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ functionCalls: calls, usageMetadata: {} })
      .mockResolvedValueOnce({ text: 'Answered from the tool.', usageMetadata: {} });
    aiModule.setAiProviderClientForTests('gemini', { chats: { create: () => ({ sendMessage }) } });
    return () => sendMessage.mock.calls[1][0].message.map((part) => part.functionResponse.response.output);
  };

  const ask = async ({ token, calendarId }, content) => {
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    return request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`)
      .set(auth(token)).send({ content }).expect(200);
  };

  it('says busy at 9:05 when a 9-to-10 appointment exists, and free right after it', async () => {
    const owner = await premiumUser('busy-at-905@example.com');
    await addEvent(owner.calendarId, owner.userId, 'Recording', '09:00', '10:00');
    const toolOutputs = await scriptModel([
      // The time exactly as the user said it, with no offset and no length.
      { id: 'at-905', name: 'check_availability', args: { startsAt: `${tomorrow()}T09:05` } },
      { id: 'at-10', name: 'check_availability', args: { startsAt: `${tomorrow()}T10:00`, durationMinutes: 30 } }
    ]);

    await ask(owner, 'I have an appointment at 9:05. Can I accept it?');
    const [busy, afterwards] = toolOutputs();

    expect(busy.free).toBe(false);
    expect(busy.summary).toMatch(/^NOT FREE/);
    expect(busy.requested.start).toBe(`${tomorrow()}T09:05:00-03:00`);
    expect(busy.requested.durationAssumed).toBe(true);
    expect(busy.conflicts).toEqual([expect.objectContaining({
      title: 'Recording', start: `${tomorrow()}T09:00:00-03:00`, end: `${tomorrow()}T10:00:00-03:00`
    })]);
    // An English speaker on the default (AUTO, no phone setting reported)
    // reads 12-hour times.
    expect(busy.conflicts[0].when).toMatch(/9:00 AM–10:00 AM$/);
    // Right before and right after the clash, nearest to 09:05 first.
    expect(busy.alternatives.slice(0, 2).map((slot) => slot.start)).toEqual([
      `${tomorrow()}T08:30:00-03:00`, `${tomorrow()}T10:00:00-03:00`
    ]);

    // Touching the end of an event is not a clash.
    expect(afterwards.free).toBe(true);
    expect(afterwards.conflicts).toEqual([]);
  });

  it('counts shared events the user accepted, and not ones still pending', async () => {
    const owner = await premiumUser('shared-busy@example.com');
    const friend = await premiumUser('shared-host@example.com');
    const accepted = await addEvent(friend.calendarId, friend.userId, 'Team lunch', '12:00', '13:00');
    const pending = await addEvent(friend.calendarId, friend.userId, 'Maybe drinks', '18:00', '19:00');
    for (const event of [accepted, pending]) {
      await models.EventShare.create({ eventId: event._id, sharedById: friend.userId, targetType: 'USER', targetId: owner.userId, permission: 'RESPOND' });
    }
    await models.EventResponse.create({ eventId: accepted._id, userId: owner.userId, status: 'ACCEPTED' });
    await models.EventResponse.create({ eventId: pending._id, userId: owner.userId, status: 'PENDING' });
    const toolOutputs = await scriptModel([
      { id: 'lunch', name: 'check_availability', args: { startsAt: `${tomorrow()}T12:30`, durationMinutes: 30 } },
      { id: 'evening', name: 'check_availability', args: { startsAt: `${tomorrow()}T18:00`, durationMinutes: 60 } }
    ]);

    await ask(owner, 'Am I free at 12:30 and at 6pm tomorrow?');
    const [lunch, evening] = toolOutputs();

    expect(lunch.free).toBe(false);
    expect(lunch.conflicts[0]).toEqual(expect.objectContaining({ title: 'Team lunch', sharedWithUser: true }));
    expect(evening.free).toBe(true);
  });

  it('keeps an event its length when moved by start time, and tells the model what it would clash with', async () => {
    const owner = await premiumUser('move-clash@example.com');
    const standup = await addEvent(owner.calendarId, owner.userId, 'Standup', '09:00', '10:00');
    await addEvent(owner.calendarId, owner.userId, 'Client call', '11:00', '12:00');
    const toolOutputs = await scriptModel([
      { id: 'move', name: 'propose_update_event', args: { eventId: standup._id.toString(), version: 0, startsAt: `${tomorrow()}T10:30` } }
    ]);

    const reply = await ask(owner, 'Move my standup to 10:30 tomorrow.');
    const [proposal] = toolOutputs();

    const staged = reply.body.data.pendingActions[0];
    expect(new Date(staged.payload.startsAt)).toEqual(at('10:30'));
    expect(new Date(staged.payload.endsAt)).toEqual(at('11:30'));
    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.proposedTime.when).toMatch(/10:30 AM–11:30 AM$/);
    expect(proposal.free).toBe(false);
    expect(proposal.conflicts).toEqual([expect.objectContaining({ title: 'Client call' })]);
  });

  it('locks previous dates even when the assistant attempts to save a past event', async () => {
    const owner = await premiumUser('past-time@example.com');
    const yesterday = DateTime.now().setZone(ZONE).minus({ days: 1 }).toISODate();
    const event = { title: 'Dinner', startsAt: `${yesterday}T21:00`, endsAt: `${yesterday}T22:00`, timeZone: ZONE };
    for (const savePastEvent of [false, true]) {
      const toolOutputs = await scriptModel([{ id: 'past', name: 'propose_create_event', args: { ...event, savePastEvent } }]);
      const reply = await ask(owner, 'Save it as a past event');
      expect(toolOutputs()[0].error.code).toBe('PAST_DATE_LOCKED');
      expect(reply.body.data.pendingActions).toEqual([]);
    }
    expect(await models.Event.countDocuments({ calendarId: owner.calendarId })).toBe(0);
  });

  it('reschedules the existing overnight event by ID without a self-conflict or duplicate', async () => {
    const owner = await premiumUser('overnight-change@example.com');
    const original = await addEvent(owner.calendarId, owner.userId, 'test', '23:00', '23:30');
    const startsAt = `${tomorrow()}T22:00`;
    const endsAt = `${DateTime.fromISO(tomorrow()).plus({ days: 1 }).toISODate()}T00:30`;
    const outputs = await scriptModel([
      { id: 'check', name: 'check_availability', args: { startsAt, endsAt, excludeEventId: original._id.toString() } },
      { id: 'edit', name: 'propose_update_event', args: { eventId: original._id.toString(), version: 0, startsAt, endsAt } }
    ]);
    const reply = await ask(owner, 'Change the test event to 10, sorry, 10 PM until 12:30 AM the following day.');
    expect(outputs()[0]).toMatchObject({ free: true, conflicts: [] });
    const [action] = reply.body.data.pendingActions;
    expect(action.type).toBe('UPDATE_EVENT');
    expect(action.conflictWarnings).toEqual([]);
    await request(app).post(`/api/v1/ai/actions/${action._id}/confirm`).set(auth(owner.token)).send({}).expect(200);
    expect(await models.Event.countDocuments({ calendarId: owner.calendarId })).toBe(1);
    const updated = await models.Event.findById(original._id);
    expect(updated.startsAt).toEqual(at('22:00'));
    expect(DateTime.fromJSDate(updated.endsAt, { zone: ZONE }).toISODate()).not.toBe(tomorrow());
    const conversation = await models.Conversation.findById(action.conversationId);
    expect(conversation.eventContextId.toString()).toBe(original._id.toString());
  });

  it('rejects an accidental create tool for an imperfect request to move an existing event', async () => {
    const owner = await premiumUser('edit-not-create@example.com');
    await addEvent(owner.calendarId, owner.userId, 'test', '23:00', '23:30');
    const outputs = await scriptModel([{ id: 'wrong-create', name: 'propose_create_event', args: {
      title: 'test', startsAt: `${tomorrow()}T22:00`, endsAt: `${tomorrow()}T23:00`, timeZone: ZONE
    } }]);
    const reply = await ask(owner, 'Can you move this to Friday? From 10 to 11, no, 11 to 9.');
    expect(outputs()[0].error.code).toBe('EVENT_TARGET_REQUIRED');
    expect(reply.body.data.pendingActions).toEqual([]);
    expect(await models.Event.countDocuments({ calendarId: owner.calendarId })).toBe(1);
  });

  it('asks for the target when multiple events match an unnamed correction', async () => {
    const owner = await premiumUser('ambiguous-target@example.com');
    const first = await addEvent(owner.calendarId, owner.userId, 'First meeting', '09:00', '10:00');
    await addEvent(owner.calendarId, owner.userId, 'Other meeting', '10:00', '11:00');
    const outputs = await scriptModel([
      { id: 'list', name: 'list_events', args: { from: `${tomorrow()}T00:00`, to: `${tomorrow()}T23:59` } },
      { id: 'edit', name: 'propose_update_event', args: { eventId: first._id.toString(), version: 0, startsAt: `${tomorrow()}T12:00` } }
    ]);
    const reply = await ask(owner, 'Move that one to noon, actually to twelve.');
    expect(outputs()[1].error.code).toBe('EVENT_SELECTION_REQUIRED');
    expect(reply.body.data.pendingActions).toEqual([]);
  });

  it('still reports other events and excludes the target from alternative slots', async () => {
    const owner = await premiumUser('other-conflict@example.com');
    const target = await addEvent(owner.calendarId, owner.userId, 'test', '09:00', '10:00');
    await addEvent(owner.calendarId, owner.userId, 'Other event', '09:30', '10:30');
    const outputs = await scriptModel([{ id: 'check', name: 'check_availability', args: {
      startsAt: `${tomorrow()}T09:00`, endsAt: `${tomorrow()}T10:00`, excludeEventId: target._id.toString()
    } }]);
    await ask(owner, 'Move test to nine tomorrow.');
    expect(outputs()[0].conflicts.map((item) => item.title)).toEqual(['Other event']);
    expect(outputs()[0].alternatives.length).toBeGreaterThan(0);
  });

  it('writes times for the assistant in the format the user chose', async () => {
    const owner = await premiumUser('clock-24@example.com');
    await models.User.updateOne({ _id: owner.userId }, { $set: { timeFormat: 'H24' } });
    await addEvent(owner.calendarId, owner.userId, 'Dinner', '21:45', '22:45');
    const toolOutputs = await scriptModel([
      { id: 'list', name: 'list_events', args: { from: `${tomorrow()}T00:00`, to: `${tomorrow()}T23:59` } }
    ]);

    await ask(owner, 'What do I have tomorrow?');
    const [listed] = toolOutputs();
    expect(listed.events[0].when).toMatch(/21:45–22:45$/);
    expect(listed.events[0].when).not.toMatch(/AM|PM/);
  });

  it('hands a backwards time range back to the model instead of failing the turn', async () => {
    const owner = await premiumUser('backwards-range@example.com');
    const toolOutputs = await scriptModel([
      { id: 'backwards', name: 'list_events', args: { from: `${tomorrow()}T18:00`, to: `${tomorrow()}T08:00` } }
    ]);

    const reply = await ask(owner, 'What do I have tomorrow?');

    expect(reply.body.data.message.content).toBe('Answered from the tool.');
    expect(toolOutputs()[0].error.code).toBe('INVALID_TIME_RANGE');
  });
});


describe('reminders in manual and AI event flows', () => {
  const prepare = async (email, minutesAway) => {
    const registered = await register(email).expect(201);
    const token = registered.body.data.accessToken;
    const me = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data;
    await models.User.updateOne({ _id: me.user._id }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const start = new Date(Date.now() + minutesAway * 60000);
    return { token, calendarId: me.primaryCalendar._id, input: {
      title: 'Reminder test', startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60000).toISOString(), timeZone: 'UTC'
    } };
  };

  it.each([undefined, [10], []].flatMap((reminderMinutes) => [2, 30].map((minutesAway) => ({ reminderMinutes, minutesAway }))))('manual creation schedules the event-time default, optional advance reminder, or explicit opt-out: %j', async ({ reminderMinutes, minutesAway }) => {
    const { token, calendarId, input } = await prepare('manual-reminder@example.com', minutesAway);
    const jobs = await import('../jobs/agenda.js');
    const enqueue = vi.spyOn(jobs, 'enqueueJob').mockResolvedValue(null);
    try {
      const created = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token))
        .send({ ...input, ...(reminderMinutes !== undefined && { reminderMinutes }) }).expect(201);
      const expected = reminderMinutes === undefined ? [0] : reminderMinutes.length ? [0, ...reminderMinutes] : [];
      expect(created.body.data.event.reminderMinutes).toEqual(expected);
      if (expected.length) {
        expect(enqueue).toHaveBeenCalledWith('send-event-reminder', expect.objectContaining({
          eventId: created.body.data.event._id, minutes: expected[0]
        }), new Date(new Date(input.startsAt).getTime() - expected[0] * 60000));
      } else expect(enqueue).not.toHaveBeenCalled();
      const event = created.body.data.event;
      await request(app).patch(`/api/v1/events/${event._id}`).set(auth(token))
        .send({ title: 'Renamed reminder test', version: event.__v }).expect(200);
      expect((await models.Event.findById(event._id)).reminderMinutes).toEqual(expected);
      expect(enqueue).toHaveBeenCalledTimes(2 * expected.filter((minutes) => minutes < minutesAway).length);
    } finally { enqueue.mockRestore(); }
  });

  it.each([undefined, [10], []].flatMap((reminderMinutes) => [2, 30].map((minutesAway) => ({ reminderMinutes, minutesAway }))))('AI confirmation schedules the event-time default, optional advance reminder, or opt-out: %j', async ({ reminderMinutes, minutesAway }) => {
    const { token, calendarId, input } = await prepare('ai-reminder@example.com', minutesAway);
    const ai = await import('../services/ai.service.js');
    const replies = [
      { functionCalls: [{ id: 'reminder', name: 'propose_create_event', args: { ...input, ...(reminderMinutes !== undefined && { reminderMinutes }) } }], usageMetadata: {} },
      { text: 'Ready to confirm.', usageMetadata: {} }
    ];
    ai.setAiClientForTests({ chats: { create: () => ({ sendMessage: vi.fn(async () => replies.shift()) }) } });
    const conversation = await request(app).post('/api/v1/ai/conversations').set(auth(token)).send({ calendarId }).expect(201);
    const reply = await request(app).post(`/api/v1/ai/conversations/${conversation.body.data._id}/messages`).set(auth(token))
      .send({ content: 'Create an event with a reminder' }).expect(200);
    const pending = reply.body.data.pendingActions[0];
    const expected = reminderMinutes === undefined ? [0] : reminderMinutes.length ? [0, ...reminderMinutes] : [];
    expect(pending.payload.reminderMinutes).toEqual(expected);
    const jobs = await import('../jobs/agenda.js');
    const enqueue = vi.spyOn(jobs, 'enqueueJob').mockResolvedValue(null);
    try {
      await request(app).post(`/api/v1/ai/actions/${pending._id}/confirm`).set(auth(token)).send({}).expect(200);
      const saved = await models.Event.findOne({ title: input.title });
      expect(saved.reminderMinutes).toEqual(expected);
      expect(enqueue).toHaveBeenCalledTimes(expected.filter((minutes) => minutes < minutesAway).length);
      if (!expected.length) expect(enqueue).not.toHaveBeenCalled();
      for (const minutes of expected.filter((minutes) => minutes < minutesAway)) expect(enqueue).toHaveBeenCalledWith('send-event-reminder', expect.objectContaining({
        eventId: saved._id.toString(), minutes
      }), new Date(new Date(input.startsAt).getTime() - minutes * 60000));
    } finally { enqueue.mockRestore(); }
  });
});


it('stores and enqueues a silent reminder, honors opt-out, and accepts a full-length event title', async () => {
  const registered = await register('reminder-delivery@example.com').expect(201);
  const id = registered.body.data.user._id;
  const jobs = await import('../jobs/agenda.js');
  const enqueue = vi.spyOn(jobs, 'enqueueJob').mockResolvedValue(null);
  const { createNotification } = await import('../services/notification.service.js');
  try {
    const notification = await createNotification(id, 'REMINDER', 'A'.repeat(180), 'Starts {time}', { eventId: 'event' }, { time: '12:10' });
    expect(notification.title).toHaveLength(160);
    expect(enqueue).toHaveBeenCalledWith('deliver-notification', { notificationId: notification._id.toString() });
    await models.User.updateOne({ _id: id }, { $set: { 'notificationPreferences.reminders': false } });
    expect(await createNotification(id, 'REMINDER', 'Disabled', 'Starts now')).toBeNull();
    expect(await models.Notification.countDocuments({ userId: id })).toBe(1);
  } finally { enqueue.mockRestore(); }
});

describe('admin coupons', () => {
 const couponInput = (overrides = {}) => ({
  name: 'Sarah Martinez', email: 'sarah@example.com', code: 'SARAH20', discountType: 'PERCENTAGE',
  discountValue: 20, commissionRate: 10, startDate: new Date(Date.now() - 86400000).toISOString(),
  endDate: new Date(Date.now() + 86400000).toISOString(), totalUsageLimit: 500, perUserLimit: 1, ...overrides
 });
 const createAdmin = async () => {
  const { signAccessToken } = await import('../services/token.service.js');
  const admin = await models.User.create({email:'coupon-admin@example.com',role:'ADMIN',displayName:'Admin',contactCode:'ADMIN-COUPON',revenueCatAppUserId:'coupon-admin'});
  return {admin, headers: auth(signAccessToken(admin))};
 };
 it('persists coupons, paginates and searches them, aggregates totals, and deletes with an audit trail', async () => {
  const {headers} = await createAdmin();
  const created = await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput()).expect(201);
  expect(created.body.data.status).toBe('ACTIVE');
  expect(created.body.data.redemptions).toBe(0);
  await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput({code:'SARAH21',name:'Alex Smith'})).expect(201);
  const list = await request(app).get('/api/v1/admin/coupons?page=2&limit=1').set(headers).expect(200);
  expect(list.body.data).toHaveLength(1);expect(list.body.meta).toMatchObject({page:2,total:2,pages:2});
  const search = await request(app).get('/api/v1/admin/coupons?search=Alex&status=ACTIVE').set(headers).expect(200);
  expect(search.body.data).toHaveLength(1);
  await request(app).get('/api/v1/admin/coupons?search=%5B').set(headers).expect(200);
  const stats = await request(app).get('/api/v1/admin/coupons/stats').set(headers).expect(200);
  expect(stats.body.data).toEqual({totalCoupons:2,totalRedemptions:0,discountGiven:0,revenue:0});
  const id=created.body.data._id;
  await request(app).get('/api/v1/admin/coupons/'+id).set(headers).expect(200);
  await request(app).delete('/api/v1/admin/coupons/'+id).set(headers).expect(200);
  await request(app).get('/api/v1/admin/coupons/'+id).set(headers).expect(404);
  expect(await models.AuditLog.exists({action:'ADMIN_COUPON_CREATED',targetId:id})).toBeTruthy();
  expect(await models.AuditLog.exists({action:'ADMIN_COUPON_DELETED',targetId:id})).toBeTruthy();
  expect((await request(app).get('/api/v1/admin/coupons/stats').set(headers)).body.data.totalCoupons).toBe(1);
 });
 it('derives scheduled/expired/exhausted status and rejects duplicate or invalid configurations', async () => {
  const {headers} = await createAdmin();
  const expired=await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput({code:'EXPIRED',startDate:new Date(Date.now()-172800000).toISOString(),endDate:new Date(Date.now()-86400000).toISOString()})).expect(201);
  expect(expired.body.data.status).toBe('EXPIRED');
  const scheduled=await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput({code:'FUTURE',startDate:new Date(Date.now()+86400000).toISOString(),endDate:new Date(Date.now()+172800000).toISOString()})).expect(201);
  expect(scheduled.body.data.status).toBe('SCHEDULED');
  expect((await request(app).get('/api/v1/admin/coupons?status=SCHEDULED').set(headers)).body.data).toHaveLength(1);
  expect((await request(app).get('/api/v1/admin/coupons?status=EXPIRED').set(headers)).body.data).toHaveLength(1);
  await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput({code:'expired'})).expect(409);
  for(const invalid of [{discountValue:101},{perUserLimit:501},{commissionRate:-1},{totalUsageLimit:0},{endDate:'invalid-date'},{redemptions:999}])
   await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput(invalid)).expect(422);
  const exhausted=await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput({code:'USED',totalUsageLimit:1})).expect(201);
  const {default:Coupon}=await import('../models/Coupon.js');await Coupon.updateOne({_id:exhausted.body.data._id},{$set:{redemptions:1}});
  expect((await request(app).get('/api/v1/admin/coupons/'+exhausted.body.data._id).set(headers)).body.data.status).toBe('EXPIRED');
 });
 it('requires an admin and prevents using another account’s media', async () => {
  await request(app).get('/api/v1/admin/coupons').expect(401);
  const member=await register('coupon-member@example.com').expect(201);
  const memberHeaders=auth(member.body.data.accessToken);
  await request(app).get('/api/v1/admin/coupons').set(memberHeaders).expect(403);
  await request(app).post('/api/v1/admin/coupons').set(memberHeaders).send(couponInput()).expect(403);
  const {headers}=await createAdmin();
  const {default:MediaAsset}=await import('../models/MediaAsset.js');
  const asset=await MediaAsset.create({ownerId:member.body.data.user._id,purpose:'AVATAR',publicId:'coupon-member-photo',secureUrl:'https://example.com/photo.png'});
  await request(app).post('/api/v1/admin/coupons').set(headers).send(couponInput({avatarMediaId:asset._id.toString()})).expect(400);
  await request(app).get('/api/v1/admin/coupons/not-an-id').set(headers).expect(422);
 });
});

describe('history deletion and date locks', () => {
  it('permanently deletes only the signed-in user’s history and proposals, including saved chats', async () => {
    const alice = (await register('delete-history@example.com').expect(201)).body.data;
    const bob = (await register('keep-history@example.com').expect(201)).body.data;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(alice.accessToken))).body.data.primaryCalendar._id;
    const own = await models.Conversation.create({ userId: alice.user._id, calendarId, savedAt: new Date(), messages: [{ role: 'USER', content: 'Private transcript' }] });
    const other = await models.Conversation.create({ userId: bob.user._id, calendarId, title: 'Keep me' });
    const pending = await models.PendingAiAction.create({ conversationId: own._id, requestedById: alice.user._id, calendarId, type: 'CREATE_EVENT', payload: { title: 'Not saved' }, expiresAt: new Date(Date.now() + 600000) });
    const event = await models.Event.create({ calendarId, createdById: alice.user._id, title: 'Keep calendar event', startsAt: new Date(Date.now() + 600000), endsAt: new Date(Date.now() + 1200000), timeZone: 'UTC' });
    await request(app).delete('/api/v1/ai/conversations').expect(401);
    const deleted = await request(app).delete('/api/v1/ai/conversations').set(auth(alice.accessToken)).expect(200);
    expect(deleted.body.data.deleted).toBe(1);
    expect(await models.Conversation.findById(own._id)).toBeNull();
    expect(await models.PendingAiAction.findById(pending._id)).toBeNull();
    expect(await models.Conversation.findById(other._id)).not.toBeNull();
    expect(await models.Event.findById(event._id)).not.toBeNull();
    await request(app).post(`/api/v1/ai/actions/${pending._id}/confirm`).set(auth(alice.accessToken)).send({}).expect(404);
    await request(app).delete('/api/v1/ai/conversations').set(auth(alice.accessToken)).expect(200);
  });

  it('conversation history expires Free at 7 days and Pro at 30, permanently removing proposals but preserving saved chats', async () => {
    const free = (await register('history-free@example.com').expect(201)).body.data;
    const pro = (await register('history-pro@example.com').expect(201)).body.data;
    await models.User.updateOne({ _id: pro.user._id }, { $set: { plan: 'PREMIUM' } });
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(free.accessToken))).body.data.primaryCalendar._id;
    const atAge = async (userId, days, extra = {}) => {
      const item = await models.Conversation.create({ userId, calendarId, messages: [{ role: 'USER', content: 'Private history' }], ...extra });
      await models.Conversation.updateOne({ _id: item._id }, { $set: { updatedAt: new Date(Date.now() - days * 86400000) } }, { timestamps: false });
      return models.Conversation.findById(item._id);
    };
    const freeDue = await atAge(free.user._id, 7);
    const freeRecent = await atAge(free.user._id, 6);
    const proDue = await atAge(pro.user._id, 30);
    const proRecent = await atAge(pro.user._id, 29);
    const saved = await atAge(pro.user._id, 60, { savedAt: new Date() });
    const legacy = await atAge(free.user._id, 40, { deletedAt: new Date(), savedAt: new Date() });
    const action = await models.PendingAiAction.create({ conversationId: freeDue._id, requestedById: free.user._id, calendarId, type: 'CREATE_EVENT', payload: { title: 'Private proposal' }, expiresAt: new Date(Date.now() + 600000) });
    const { expireConversations } = await import('../services/conversationHistory.service.js');
    expect(await expireConversations({ batchSize: 2 })).toEqual({ deleted: 3 });
    for (const item of [freeDue, proDue, legacy]) expect(await models.Conversation.findById(item._id)).toBeNull();
    for (const item of [freeRecent, proRecent, saved]) expect(await models.Conversation.findById(item._id)).not.toBeNull();
    expect(await models.PendingAiAction.findById(action._id)).toBeNull();
  });

  it('conversation history scans beyond ineligible Pro batches and supplies expiry metadata', async () => {
    const free = (await register('batch-free@example.com').expect(201)).body.data;
    const pro = (await register('batch-pro@example.com').expect(201)).body.data;
    await models.User.updateOne({ _id: pro.user._id }, { $set: { plan: 'PREMIUM' } });
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(free.accessToken))).body.data.primaryCalendar._id;
    for (let i = 0; i < 3; i++) await models.Conversation.create({ userId: pro.user._id, calendarId });
    await models.Conversation.updateMany({ userId: pro.user._id }, { $set: { updatedAt: new Date(Date.now() - 10 * 86400000) } }, { timestamps: false });
    const due = await models.Conversation.create({ userId: free.user._id, calendarId });
    await models.Conversation.updateOne({ _id: due._id }, { $set: { updatedAt: new Date(Date.now() - 8 * 86400000) } }, { timestamps: false });
    const { expireConversations } = await import('../services/conversationHistory.service.js');
    expect(await expireConversations({ batchSize: 2 })).toEqual({ deleted: 1 });
    expect(await models.Conversation.findById(due._id)).toBeNull();
    const listed = await request(app).get('/api/v1/ai/conversations').set(auth(pro.accessToken)).expect(200);
    expect(listed.body.data).toHaveLength(3);
    expect(listed.body.data[0].historyRetentionDays).toBe(30);
    expect(listed.body.data[0].expiresAt).toBe(new Date(Date.now() + 20 * 86400000).toISOString());
    expect(listed.body.data[0].messages).toBeUndefined();
  });

  it('conversation history allows Pro bookmarks and account-owned individual deletion', async () => {
    const free = (await register('bookmark-free@example.com').expect(201)).body.data;
    const pro = (await register('bookmark-pro@example.com').expect(201)).body.data;
    await models.User.updateOne({ _id: pro.user._id }, { $set: { plan: 'PREMIUM' } });
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(pro.accessToken))).body.data.primaryCalendar._id;
    const own = await models.Conversation.create({ userId: pro.user._id, calendarId, title: 'Keep my ideas' });
    const freeChat = await models.Conversation.create({ userId: free.user._id, calendarId });
    await models.Conversation.updateOne({ _id: own._id }, { $set: { updatedAt: new Date(Date.now() - 29 * 86400000) } }, { timestamps: false });
    await request(app).patch(`/api/v1/ai/conversations/${freeChat._id}/saved`).set(auth(free.accessToken)).send({ saved: true }).expect(402);
    await request(app).patch(`/api/v1/ai/conversations/${own._id}/saved`).set(auth(pro.accessToken)).send({ saved: true }).expect(200);
    const list = await request(app).get('/api/v1/ai/conversations').set(auth(pro.accessToken)).expect(200);
    expect(list.body.data[0].savedAt).toBeTruthy();
    expect(list.body.data[0].expiresAt).toBeNull();
    await request(app).delete(`/api/v1/ai/conversations/${own._id}`).set(auth(free.accessToken)).expect(404);
    await request(app).patch(`/api/v1/ai/conversations/${own._id}/saved`).set(auth(pro.accessToken)).send({ saved: false }).expect(200);
    const unsaved = await request(app).get('/api/v1/ai/conversations').set(auth(pro.accessToken)).expect(200);
    expect(unsaved.body.data[0].expiresAt).toBe(new Date(Date.now() + 86400000).toISOString());
    const pending = await models.PendingAiAction.create({ conversationId: own._id, requestedById: pro.user._id, calendarId, type: 'CREATE_EVENT', payload: {}, expiresAt: new Date(Date.now() + 600000) });
    await request(app).delete(`/api/v1/ai/conversations/${own._id}`).set(auth(pro.accessToken)).expect(200);
    expect(await models.Conversation.findById(own._id)).toBeNull();
    expect(await models.PendingAiAction.findById(pending._id)).toBeNull();
    expect(await models.Conversation.findById(freeChat._id)).not.toBeNull();
    const freeList = await request(app).get('/api/v1/ai/conversations').set(auth(free.accessToken)).expect(200);
    expect(freeList.body.data[0].historyRetentionDays).toBe(7);
  });

  it('keeps yesterday visible while rejecting create, edit, move and delete', async () => {
    const me = (await register('date-lock@example.com').expect(201)).body.data;
    const token = me.accessToken;
    const calendarId = (await request(app).get('/api/v1/users/me').set(auth(token))).body.data.primaryCalendar._id;
    const start = DateTime.now().minus({ days: 1 }).startOf('day').plus({ hours: 9 }).toJSDate();
    const end = new Date(+start + 3600000);
    const old = await models.Event.create({ calendarId, createdById: me.user._id, title: 'Past event', startsAt: start, endsAt: end, timeZone: 'UTC' });
    const input = { title: 'Accidental past booking', startsAt: start.toISOString(), endsAt: end.toISOString(), timeZone: 'UTC' };
    const rejected = await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send(input).expect(422);
    expect(rejected.body.error.code).toBe('PAST_DATE_LOCKED');
    await request(app).patch(`/api/v1/events/${old._id}`).set(auth(token)).send({ version: 0, title: 'Changed' }).expect(422);
    await request(app).patch(`/api/v1/events/${old._id}`).set(auth(token)).send({ version: 0, startsAt: new Date(Date.now() + 3600000).toISOString() }).expect(422);
    await request(app).delete(`/api/v1/events/${old._id}`).set(auth(token)).query({ version: 0 }).expect(422);
    const listed = await request(app).get(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).query({ from: new Date(+start - 3600000).toISOString(), to: new Date(+end + 3600000).toISOString() }).expect(200);
    expect(listed.body.data[0].title).toBe('Past event');
    // Earlier today is a separate time warning; the entire current day is never locked.
    const today = DateTime.now().startOf('day').plus({ hours: 9 });
    await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(token)).send({ ...input, startsAt: today.toISO(), endsAt: today.plus({ hours: 1 }).toISO() }).expect(201);
  });
});
