import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { env } from '../config/env.js';
import logger from '../config/logger.js';
import Event from '../models/Event.js';
import MediaAsset from '../models/MediaAsset.js';
import { RevenueCatEvent } from '../models/Subscription.js';
import { Subscription } from '../models/Subscription.js';
import { PendingAiAction } from '../models/Ai.js';
import { AccountDeletion } from '../models/Operations.js';
import { createNotification, deliverPush } from '../services/notification.service.js';
import Notification from '../models/Notification.js';
import { EventResponse } from '../models/EventShare.js';
import { purgeAccount } from '../services/accountDeletion.service.js';
import { markWebhookProcessed, reconcileSubscriber } from '../services/revenuecat.service.js';
import { deleteMediaAsset } from '../services/media.service.js';

const disabledAgenda = {
  define: () => undefined,
  schedule: async () => null,
  cancel: async () => 0,
  start: async () => undefined,
  stop: async () => undefined,
  every: async () => null
};

export const agenda = env.DISABLE_JOBS ? disabledAgenda : new Agenda({
  backend: new MongoBackend({ address: env.MONGODB_URI, collection: 'agendaJobs' }),
  processEvery: '15 seconds',
  defaultConcurrency: 10,
  maxConcurrency: 20
});

const withRetry = async (job, task, maxRetries = 5) => {
  try {
    return await task();
  } catch (error) {
    const retryCount = Number(job.attrs.data.retryCount || 0);
    if (retryCount >= maxRetries) throw error;
    const delay = Math.min(60 * 60_000, 15_000 * (2 ** retryCount));
    await enqueueJob(job.attrs.name, { ...job.attrs.data, retryCount: retryCount + 1 }, new Date(Date.now() + delay));
    logger.warn({ err: error, job: job.attrs.name, retryCount: retryCount + 1 }, 'Agenda job scheduled for retry');
    return undefined;
  }
};

agenda.define('deliver-notification', async (job) => {
  await withRetry(job, async () => {
    const notification = await Notification.findById(job.attrs.data.notificationId);
    if (notification && !notification.deletedAt) await deliverPush(notification);
  });
});

agenda.define('send-event-reminder', async (job) => {
  await withRetry(job, async () => {
    const { eventId, occurrenceStartAt } = job.attrs.data;
    const event = await Event.findById(eventId).populate({ path: 'calendarId', select: 'ownerId' });
    if (!event || event.status !== 'ACTIVE') return;
    const responses = await EventResponse.find({ eventId, status: { $in: ['ACCEPTED', 'MAYBE'] } }).select('userId');
    const recipients = new Set([event.calendarId.ownerId.toString(), ...responses.map((response) => response.userId.toString())]);
    for (const recipientId of recipients) {
      await createNotification(recipientId, 'REMINDER', event.title, `Event begins at ${new Date(occurrenceStartAt).toISOString()}`, { eventId });
    }
  });
});

agenda.define('purge-account', async (job) => purgeAccount(job.attrs.data.userId));

agenda.define('reconcile-revenuecat', async (job) => {
  await withRetry(job, async () => {
    const { eventId, appUserId } = job.attrs.data;
    try {
      await reconcileSubscriber(appUserId);
      if (eventId) await markWebhookProcessed(eventId);
    } catch (error) {
      if (eventId) await markWebhookProcessed(eventId, error);
      throw error;
    }
  });
});

agenda.define('reconcile-all-revenuecat', async () => {
  const subscriptions = await Subscription.find({ status: { $in: ['TRIAL', 'ACTIVE', 'GRACE', 'CANCELLED'] } }).select('appUserId').limit(1000);
  for (const subscription of subscriptions) await enqueueJob('reconcile-revenuecat', { appUserId: subscription.appUserId });
});

agenda.define('purge-due-accounts', async () => {
  const due = await AccountDeletion.find({ cancelledAt: null, purgedAt: null, purgeAt: { $lte: new Date() } }).select('userId').limit(100);
  for (const deletion of due) await enqueueJob('purge-account', { userId: deletion.userId.toString() });
});

agenda.define('refresh-event-reminders', async () => {
  const events = await Event.find({ status: 'ACTIVE', reminderMinutes: { $exists: true, $ne: [] }, recurrenceRrule: { $exists: true, $nin: [null, ''] } }).limit(1000);
  const { scheduleEventReminders } = await import('./reminders.js');
  for (const event of events) await scheduleEventReminders(event);
});

agenda.define('cleanup-orphaned-media', async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const assets = await MediaAsset.find({ claimedAt: null, createdAt: { $lt: cutoff } }).limit(100);
  for (const asset of assets) await deleteMediaAsset(asset.ownerId, asset._id).catch(() => undefined);
});

agenda.define('expire-ai-actions', async () => {
  await PendingAiAction.updateMany({ status: 'PENDING', expiresAt: { $lte: new Date() } }, { $set: { status: 'EXPIRED' } });
});

export const enqueueJob = (name, data, when = 'now') => env.DISABLE_JOBS ? Promise.resolve(null) : agenda.schedule(when, name, data);

export const startAgenda = async () => {
  if (env.DISABLE_JOBS) return;
  await agenda.start();
  await agenda.every('1 hour', 'cleanup-orphaned-media', {}, { skipImmediate: true });
  await agenda.every('10 minutes', 'expire-ai-actions');
  await agenda.every('6 hours', 'reconcile-all-revenuecat', {}, { skipImmediate: true });
  await agenda.every('1 hour', 'purge-due-accounts', {}, { skipImmediate: true });
  await agenda.every('1 day', 'refresh-event-reminders', {}, { skipImmediate: true });
  logger.info('Agenda worker started');
};

export const stopAgenda = () => agenda.stop();
