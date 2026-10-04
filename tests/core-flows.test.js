import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replset, app, mongoose, models;
const auth = (user) => ({ Authorization: `Bearer ${user.accessToken}` });
const from = '2026-11-02T00:00:00.000Z';
const to = '2026-11-03T00:00:00.000Z';
const eventInput = (title = 'Appointment') => ({ title, startsAt: '2026-11-02T09:00:00.000Z', endsAt: '2026-11-02T10:00:00.000Z', timeZone: 'UTC', reminderMinutes: [] });
const register = async (name) => {
  const response = await request(app).post('/api/v1/auth/register').send({ email: `${name.toLowerCase()}@qa.example`, displayName: name, password: 'SecurePassword123!', timeZone: 'UTC', termsVersion: 'v1', termsAccepted: true }).expect(201);
  const user = response.body.data;
  user.calendarId = (await request(app).get('/api/v1/users/me').set(auth(user)).expect(200)).body.data.primaryCalendar._id;
  return user;
};
const create = async (user, calendarId = user.calendarId, input = eventInput()) => (await request(app).post(`/api/v1/calendars/${calendarId}/events`).set(auth(user)).send(input).expect(201)).body.data.event;
const share = async (owner, eventId, targetType, targetId, permission) => (await request(app).post(`/api/v1/events/${eventId}/shares`).set(auth(owner)).send({ targetType, targetIds: [targetId], permission }).expect(200)).body.data[0];
const groupWith = async (owner, guest, name = 'Family') => {
  const group = (await request(app).post('/api/v1/groups').set(auth(owner)).send({ name }).expect(201)).body.data;
  await request(app).post('/api/v1/groups/join').set(auth(guest)).send({ code: ` ${group.code.toLowerCase()} ` }).expect(200);
  return group;
};

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  Object.assign(process.env, {
    NODE_ENV: 'test', DISABLE_JOBS: 'true', PAYWALL_ENABLED: 'true', MONGODB_URI: replset.getUri('core-qa'),
    JWT_ACCESS_SECRET: 'qa-access-secret-that-is-long-enough-123', JWT_REFRESH_SECRET: 'qa-refresh-secret-that-is-long-enough-456',
    REVENUECAT_WEBHOOK_AUTH: 'Bearer qa-webhook-secret', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', OPENAI_API_KEY: 'test-key'
  });
  ({ default: mongoose } = await import('mongoose'));
  ({ default: app } = await import('../app.js'));
  await (await import('../config/database.js')).connectDatabase();
  models = await import('../models/index.js');
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  await models.LegalDocument.create([
    { type: 'TERMS', version: 'v1', locale: 'en', title: 'Terms', content: 'Test', active: true },
    { type: 'PRIVACY', version: 'v1', locale: 'en', title: 'Privacy', content: 'Test', active: true }
  ]);
});
afterAll(async () => {
  await (await import('../config/database.js')).disconnectDatabase();
  await replset.stop();
});

describe('secretary journeys through actual API and database', () => {
  it('reports private busy time to an own-events secretary without revealing its title or id', async () => {
    const owner = await register('Owner'), assistant = await register('Secretary');
    await models.User.updateOne({ _id: owner.user._id }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    await create(owner, owner.calendarId, eventInput('Private medical appointment'));
    await request(app).post('/api/v1/delegations').set(auth(owner)).send({ accountType: 'EXISTING', userId: assistant.user._id, preset: 'ADD_EDIT' }).expect(201);
    const report = (await request(app).get(`/api/v1/calendars/${owner.calendarId}/conflicts`).set(auth(assistant)).query({ startsAt: eventInput().startsAt, endsAt: eventInput().endsAt }).expect(200)).body.data;
    expect(report.conflicts[0]).toEqual({ startsAt: eventInput().startsAt, endsAt: eventInput().endsAt });
    const blocked = await request(app).post(`/api/v1/calendars/${owner.calendarId}/events`).set(auth(assistant)).send(eventInput()).expect(409);
    expect(blocked.body.error.details.conflicts[0]).toEqual(report.conflicts[0]);
  });
  const presets = [
    ['ADD_ONLY', true, false, false, false], ['EDIT_ONLY', false, true, false, false],
    ['ADD_EDIT', true, true, false, false], ['DELETE_ONLY', false, false, true, false],
    ['VIEW_EDIT_ALL', false, true, false, true], ['VIEW_OWN', false, false, false, false],
    ['FULL_ACCESS', true, true, true, true]
  ];
  it.each(presets)('%s lists the correct events and enforces create/edit/delete/revoke', async (preset, canCreate, canEdit, canDelete, all) => {
    const owner = await register('Owner');
    const assistant = await register('Secretary');
    const delegation = (await request(app).post('/api/v1/delegations').set(auth(owner)).send({ accountType: 'EXISTING', userId: assistant.user._id, preset }).expect(201)).body.data;
    const accessible = (await request(app).get('/api/v1/users/me/calendars').set(auth(assistant)).expect(200)).body.data;
    expect(accessible.delegated[0]).toMatchObject({ preset, calendar: { _id: owner.calendarId, ownerId: { displayName: 'Owner' } } });
    const own = await models.Event.create({ calendarId: owner.calendarId, createdById: assistant.user._id, ...eventInput('Secretary appointment') });
    const ownerEvent = await create(owner, owner.calendarId, { ...eventInput('Private appointment'), startsAt: '2026-11-02T12:00:00.000Z', endsAt: '2026-11-02T13:00:00.000Z' });
    const rows = (await request(app).get(`/api/v1/calendars/${owner.calendarId}/events`).set(auth(assistant)).query({ from, to }).expect(200)).body.data;
    expect(rows.map((row) => row.title)).toEqual(all ? ['Secretary appointment', 'Private appointment'] : ['Secretary appointment']);
    expect(rows[0].permissions).toEqual({ edit: canEdit, delete: canDelete, respond: false, share: preset === 'FULL_ACCESS' });
    await request(app).post(`/api/v1/calendars/${owner.calendarId}/events`).set(auth(assistant)).send({ ...eventInput('Added by secretary'), startsAt: '2026-11-02T15:00:00.000Z', endsAt: '2026-11-02T16:00:00.000Z' }).expect(canCreate ? 201 : 403);
    const edit = await request(app).patch(`/api/v1/events/${own._id}`).set(auth(assistant)).send({ title: 'Updated', version: 0 }).expect(canEdit ? 200 : 403);
    await request(app).get(`/api/v1/events/${ownerEvent._id}`).set(auth(assistant)).expect(all ? 200 : 403);
    await request(app).delete(`/api/v1/events/${own._id}`).set(auth(assistant)).query({ version: canEdit ? edit.body.data.event.__v : 0 }).expect(canDelete ? 200 : 403);
    await request(app).delete(`/api/v1/delegations/${delegation._id}`).set(auth(owner)).expect(200);
    await request(app).get(`/api/v1/calendars/${owner.calendarId}/events`).set(auth(assistant)).query({ from, to }).expect(403);
    const revoked = (await request(app).get('/api/v1/users/me/calendars').set(auth(assistant)).expect(200)).body.data;
    expect(revoked.delegated).toEqual([]);
  });

  it('creates a new secretary account, updates its permissions and grants access again after revocation', async () => {
    const owner = await register('Owner');
    const input = { accountType: 'NEW', email: 'secretary@qa.example', displayName: 'Secretary', password: 'SecretaryPassword123!', preset: 'ADD_ONLY' };
    const delegation = (await request(app).post('/api/v1/delegations').set(auth(owner)).send(input).expect(201)).body.data;
    const login = (await request(app).post('/api/v1/auth/login').send({ email: input.email, password: input.password }).expect(200)).body.data;
    expect((await request(app).get('/api/v1/users/me').set(auth(login)).expect(200)).body.data.primaryCalendar).toBeTruthy();
    await request(app).patch(`/api/v1/delegations/${delegation._id}`).set(auth(owner)).send({ preset: 'FULL_ACCESS' }).expect(200);
    await request(app).delete(`/api/v1/delegations/${delegation._id}`).set(auth(owner)).expect(200);
    const regranted = await request(app).post('/api/v1/delegations').set(auth(owner)).send({ accountType: 'EXISTING', userId: login.user._id, preset: 'ADD_EDIT' }).expect(201);
    expect(regranted.body.data._id).toBe(delegation._id);
    expect((await request(app).get('/api/v1/users/me/calendars').set(auth(login)).expect(200)).body.data.delegated[0].preset).toBe('ADD_EDIT');
  });
});

describe('family linking, group sharing and invitation lifecycle', () => {
  it('accepts a lowercase contact code, preserves both family relations and supports unlink/relink', async () => {
    const alice = await register('Alice'), bob = await register('Bob');
    const link = (await request(app).post('/api/v1/contact-requests').set(auth(alice)).send({ contactCode: ` ${bob.user.contactCode.toLowerCase()} `, relation: 'Family' }).expect(201)).body.data;
    await request(app).post('/api/v1/contact-requests').set(auth(bob)).send({ contactCode: alice.user.contactCode, relation: 'Family' }).expect(409);
    await request(app).put(`/api/v1/contact-requests/${link._id}`).set(auth(bob)).send({ action: 'ACCEPT', relation: 'Family' }).expect(200);
    for (const user of [alice, bob]) expect((await request(app).get('/api/v1/contacts').set(auth(user)).expect(200)).body.data[0].relation).toBe('Family');
    await request(app).patch(`/api/v1/contacts/${bob.user._id}`).set(auth(alice)).send({ relation: 'Friend' }).expect(200);
    expect((await request(app).get('/api/v1/contacts').set(auth(bob)).expect(200)).body.data[0].relation).toBe('Family');
    await request(app).delete(`/api/v1/contacts/${bob.user._id}`).set(auth(alice)).expect(200);
    expect((await request(app).get('/api/v1/contacts').set(auth(bob)).expect(200)).body.data).toEqual([]);
    await request(app).post('/api/v1/contact-requests').set(auth(alice)).send({ contactCode: bob.user.contactCode, relation: 'Family' }).expect(201);
  });

  it('uses the strongest group/direct permission in list, detail, editing and RSVP, and falls back when revoked', async () => {
    const owner = await register('Owner'), guest = await register('Guest');
    const group = await groupWith(owner, guest), event = await create(owner);
    await share(owner, event._id, 'USER', guest.user._id, 'VIEW_ONLY');
    const editShare = await share(owner, event._id, 'GROUP', group._id, 'EDIT');
    const rows = (await request(app).get('/api/v1/events/shared').set(auth(guest)).query({ from, to }).expect(200)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sharePermission: 'EDIT', permissions: { edit: true, delete: false, respond: true, share: false } });
    const detail = (await request(app).get(`/api/v1/events/${event._id}`).set(auth(guest)).expect(200)).body.data;
    expect(detail.event).toMatchObject({ sharePermission: 'EDIT', shareSource: 'GROUP', rsvpStatus: 'PENDING' });
    expect(detail.permissions).toEqual(rows[0].permissions);
    await request(app).patch(`/api/v1/events/${event._id}`).set(auth(guest)).send({ title: 'Family appointment changed', version: 0 }).expect(200);
    await request(app).put(`/api/v1/events/${event._id}/rsvp`).set(auth(guest)).send({ status: 'ACCEPTED' }).expect(200);
    expect((await request(app).get(`/api/v1/events/${event._id}`).set(auth(guest)).expect(200)).body.data.event.rsvpStatus).toBe('ACCEPTED');
    await request(app).delete(`/api/v1/events/${event._id}/shares/${editShare._id}`).set(auth(owner)).expect(200);
    const reduced = (await request(app).get(`/api/v1/events/${event._id}`).set(auth(guest)).expect(200)).body.data;
    expect(reduced.event.sharePermission).toBe('VIEW_ONLY');
    expect(reduced.permissions.edit).toBe(false);
    await request(app).patch(`/api/v1/events/${event._id}`).set(auth(guest)).send({ title: 'Forbidden', version: 1 }).expect(403);
  });

  it('permits an explicitly shared event even when a secretary can only view their own creations', async () => {
    const owner = await register('Owner'), assistant = await register('Secretary');
    await request(app).post('/api/v1/delegations').set(auth(owner)).send({ accountType: 'EXISTING', userId: assistant.user._id, preset: 'VIEW_OWN' }).expect(201);
    const event = await create(owner);
    await share(owner, event._id, 'USER', assistant.user._id, 'RESPOND');
    const detail = (await request(app).get(`/api/v1/events/${event._id}`).set(auth(assistant)).expect(200)).body.data;
    expect(detail.accessSource).toBe('DIRECT_SHARE');
    expect(detail.permissions).toMatchObject({ edit: false, respond: true });
  });

  it('clears a pending group invitation when its recipient joins by code, and clears invitations for a deleted group', async () => {
    const owner = await register('Owner'), guest = await register('Guest');
    const group = (await request(app).post('/api/v1/groups').set(auth(owner)).send({ name: 'Family' }).expect(201)).body.data;
    await request(app).post(`/api/v1/groups/${group._id}/invitations`).set(auth(owner)).send({ userId: guest.user._id }).expect(201);
    await request(app).post('/api/v1/groups/join').set(auth(guest)).send({ code: group.code }).expect(200);
    expect((await request(app).get('/api/v1/group-invitations').set(auth(guest)).expect(200)).body.data).toEqual([]);
    await request(app).post(`/api/v1/groups/${group._id}/leave`).set(auth(guest)).expect(200);
    await request(app).post(`/api/v1/groups/${group._id}/invitations`).set(auth(owner)).send({ userId: guest.user._id }).expect(201);
    await request(app).delete(`/api/v1/groups/${group._id}`).set(auth(owner)).expect(200);
    expect((await request(app).get('/api/v1/group-invitations').set(auth(guest)).expect(200)).body.data).toEqual([]);
  });

  it('shares group events automatically, includes the default start reminder and validates timezone and custom reminders', async () => {
    const owner = await register('Owner'), guest = await register('Guest');
    const group = await groupWith(owner, guest);
    const { reminderMinutes, ...input } = eventInput();
    const event = (await request(app).post(`/api/v1/groups/${group._id}/events`).set(auth(owner)).send(input).expect(201)).body.data.event;
    expect(event.reminderMinutes).toEqual([0]);
    expect((await request(app).get('/api/v1/events/shared').set(auth(guest)).query({ from, to }).expect(200)).body.data[0].sharePermission).toBe('RESPOND');
    await request(app).post(`/api/v1/groups/${group._id}/events`).set(auth(owner)).send({ ...input, timeZone: 'Invalid/Timezone' }).expect(422);
    await request(app).post(`/api/v1/groups/${group._id}/events`).set(auth(owner)).send({ ...input, reminderMinutes: [525601] }).expect(422);
  });
});

describe('availability, accepted invitations and account cleanup', () => {
  it('keeps every free slot inside the requested range and returns no slot when the duration cannot fit', async () => {
    const owner = await register('Owner');
    await models.User.updateOne({ _id: owner.user._id }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const query = { from: '2026-11-02T09:00:00.000Z', to: '2026-11-02T09:15:00.000Z' };
    const tooShort = (await request(app).get(`/api/v1/calendars/${owner.calendarId}/availability`).set(auth(owner)).query({ ...query, durationMinutes: 30 }).expect(200)).body.data;
    expect(tooShort).toEqual([]);
    const slots = (await request(app).get(`/api/v1/calendars/${owner.calendarId}/availability`).set(auth(owner)).query({ ...query, durationMinutes: 10 }).expect(200)).body.data;
    expect(slots).toEqual([{ startsAt: query.from, endsAt: '2026-11-02T09:10:00.000Z' }]);
  });

  it('blocks a manual premium event against an accepted invitation and frees the time after decline', async () => {
    const owner = await register('Owner'), guest = await register('Guest');
    await models.User.updateOne({ _id: guest.user._id }, { $set: { plan: 'PREMIUM', premiumUntil: new Date(Date.now() + 86400000) } });
    const event = await create(owner);
    await share(owner, event._id, 'USER', guest.user._id, 'RESPOND');
    await request(app).put(`/api/v1/events/${event._id}/rsvp`).set(auth(guest)).send({ status: 'ACCEPTED' }).expect(200);
    const conflicts = (await request(app).get(`/api/v1/calendars/${guest.calendarId}/conflicts`).set(auth(guest)).query({ startsAt: event.startsAt, endsAt: event.endsAt }).expect(200)).body.data;
    expect(conflicts.conflicts[0].eventId).toBe(event._id);
    await request(app).post(`/api/v1/calendars/${guest.calendarId}/events`).set(auth(guest)).send(eventInput()).expect(409);
    await request(app).put(`/api/v1/events/${event._id}/rsvp`).set(auth(guest)).send({ status: 'DECLINED' }).expect(200);
    await create(guest);
  });

  it('purges private notes when the account is permanently deleted while preserving another account', async () => {
    const owner = await register('Owner'), guest = await register('Guest');
    for (const user of [owner, guest]) await request(app).post('/api/v1/notes').set(auth(user)).send({ calendarId: user.calendarId, body: 'Private note' }).expect(201);
    await request(app).post('/api/v1/users/me/deletion').set(auth(owner)).send({ password: 'SecurePassword123!', reason: 'QA cleanup', storeBillingAcknowledged: true }).expect(200);
    await models.AccountDeletion.updateOne({ userId: owner.user._id }, { $set: { purgeAt: new Date(Date.now() - 1000) } });
    expect(await (await import('../services/accountDeletion.service.js')).purgeAccount(owner.user._id)).toBe(true);
    expect(await models.Note.countDocuments({ userId: owner.user._id })).toBe(0);
    expect(await models.Note.countDocuments({ userId: guest.user._id })).toBe(1);
  });
});
