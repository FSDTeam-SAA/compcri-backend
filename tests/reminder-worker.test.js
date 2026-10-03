import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Exercise real MongoDB persistence and Agenda processing. Only the external
// Firebase transport is replaced, so this test sends no real device messages.
const transport = vi.hoisted(() => vi.fn());
vi.mock('../services/firebase.service.js', () => ({ sendMulticast: transport }));
let replset, mongoose, models, agenda, enqueueJob, createEvent;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_JOBS = 'false';
  process.env.PAYWALL_ENABLED = 'false';
  process.env.MONGODB_URI = replset.getUri('reminder-worker-test');
  ({ default: mongoose } = await import('mongoose'));
  await (await import('../config/database.js')).connectDatabase();
  models = await import('../models/index.js');
  ({ agenda, enqueueJob } = await import('../jobs/agenda.js'));
  ({ createEvent } = await import('../services/event.service.js'));
  await agenda.ready;
  agenda.processEvery(100);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  // Agenda owns a separate connection but uses the same database.
  await mongoose.connection.db.collection('agendaJobs').deleteMany({});
  transport.mockReset().mockResolvedValue({ responses: [{ success: true }] });
});
afterEach(async () => { await agenda.stop(false); });
afterAll(async () => {
  await agenda?.backend.disconnect();
  await mongoose?.disconnect();
  await replset?.stop();
});

const owner = async () => {
  const user = await models.User.create({ email: 'worker@example.com', contactCode: 'WORKER', revenueCatAppUserId: 'worker', notificationPreferences: { alarmReminders: true } });
  const calendar = await models.Calendar.create({ ownerId: user._id, timeZone: 'UTC' });
  await models.Device.create({ userId: user._id, token: 'isolated-test-device-token', platform: 'ANDROID' });
  return { user, calendar };
};

describe('persisted reminders and the worker', () => {
  it('delivers a default reminder for a two-minute event through the actual Agenda worker', async () => {
    const { user, calendar } = await owner();
    const startsAt = new Date(Date.now() + 120000);
    const { event } = await createEvent(user._id, calendar._id, {
      title: 'Two-minute event', startsAt, endsAt: new Date(startsAt.getTime() + 1800000), timeZone: 'UTC'
    });
    expect(event.reminderMinutes).toEqual([0]);
    const jobs = await agenda.queryJobs({ name: 'send-event-reminder' });
    expect(jobs.total).toBe(1);
    expect(jobs.jobs[0].nextRunAt).toEqual(startsAt);
    expect(jobs.jobs[0].data.minutes).toBe(0);
    // Make that persisted job due to exercise processing without a two-minute
    // wall-clock wait. Its event data and original schedule remain verified.
    await mongoose.connection.db.collection('agendaJobs').updateOne({ _id: new mongoose.Types.ObjectId(jobs.jobs[0]._id.toString()) }, { $set: { nextRunAt: new Date() } });
    await agenda.start();
    try {
      await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce(), { timeout: 5000 });
    } catch (error) {
      throw new Error(JSON.stringify(await agenda.queryJobs({})), { cause: error });
    }
    expect(await models.Notification.countDocuments({ category: 'REMINDER', 'data.eventId': event._id.toString() })).toBe(1);
    expect(transport.mock.calls[0][0]).toMatchObject({
      tokens: ['isolated-test-device-token'],
      notification: { title: 'Two-minute event' },
      data: { category: 'REMINDER', alarm: 'true' },
      android: { priority: 'high', notification: { channelId: 'aurox_alarms' } }
    });
  });

  it('refreshes existing non-recurring future events with an event-time job after deployment', async () => {
    const { user, calendar } = await owner();
    const startsAt = new Date(Date.now() + 1800000);
    const { event } = await createEvent(user._id, calendar._id, {
      title: 'Existing event', startsAt, endsAt: new Date(startsAt.getTime() + 1800000), timeZone: 'UTC', reminderMinutes: [10]
    });
    // Simulate a pre-release record and its advance-only queue.
    await mongoose.connection.db.collection('events').updateOne({ _id: event._id }, { $set: { reminderMinutes: [10] } });
    await agenda.cancel({ name: 'send-event-reminder' });
    await enqueueJob('refresh-event-reminders', {});
    await agenda.start();
    await vi.waitFor(async () => {
      const jobs = await agenda.queryJobs({ name: 'send-event-reminder' });
      expect(jobs.total).toBe(2);
      expect(jobs.jobs.map((job) => job.data.minutes).sort((a, b) => a - b)).toEqual([0, 10]);
    }, { timeout: 5000 });
    expect(transport).not.toHaveBeenCalled();
  });
});
