import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { env } from '../config/env.js';
import logger from '../config/logger.js';
import { formatDateTime } from '../utils/i18n.js';
import { uses24Hour } from '../utils/timeFormat.js';
import Event from '../models/Event.js';
import MediaAsset from '../models/MediaAsset.js';
import { RevenueCatEvent } from '../models/Subscription.js';
import { Subscription } from '../models/Subscription.js';
import { Conversation, PendingAiAction } from '../models/Ai.js';
import User from '../models/User.js';
import { effectivePlan } from '../utils/premium.js';
import { AccountDeletion } from '../models/Operations.js';
import { createNotification, deliverPush } from '../services/notification.service.js';
import Notification from '../models/Notification.js';
import { EventResponse } from '../models/EventShare.js';
import { getEventAccess } from '../services/calendarAccess.service.js';
import { expandEvent } from '../utils/eventOccurrences.js';
import { withEventTimeReminder } from '../utils/reminders.js';
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
    await enqueueJob(job.attrs.name, { ...job.attrs.data, ...(error.retryTokens && { retryTokens: error.retryTokens }), retryCount: retryCount + 1 }, new Date(Date.now() + delay));
    logger.warn({ err: error, job: job.attrs.name, retryCount: retryCount + 1 }, 'Agenda job scheduled for retry');
    return undefined;
  }
};

agenda.define('deliver-notification', async (job) => {
  await withRetry(job, async () => {
    const notification = await Notification.findById(job.attrs.data.notificationId);
    if (notification && !notification.deletedAt) await deliverPush(notification, job.attrs.data.retryTokens);
  });
});

agenda.define('send-event-reminder', async (job) => {
  await withRetry(job, async () => {
    const { eventId, occurrenceStartAt, minutes = 0 } = job.attrs.data;
    const event = await Event.findById(eventId).populate({ path: 'calendarId', select: 'ownerId' });
    if (!event || event.status !== 'ACTIVE' || !event.calendarId) return;
    const at = new Date(occurrenceStartAt);
    const row = expandEvent(event, at, new Date(at.getTime() + 1)).find((item) => +item.occurrenceStartAt === +at);
    // A job already claimed when an edit happened may survive cancellation.
    if (!row || !withEventTimeReminder(row.reminderMinutes || []).includes(minutes)) return;
    const responses = await EventResponse.find({ eventId, status: { $in: ['ACCEPTED', 'MAYBE'] } }).select('userId');
    const recipients = new Set([event.calendarId.ownerId.toString(), ...responses.map((response) => response.userId.toString())]);
    for (const recipientId of recipients) {
      try {
        await getEventAccess(recipientId, event);
      } catch (error) {
        if ([403, 404].includes(error.statusCode)) continue;
        throw error;
      }
      await createNotification(recipientId, 'REMINDER', row.title, 'Starts {time}', { eventId }, {
        time: (locale, recipient) => formatDateTime(locale, new Date(occurrenceStartAt), event.timeZone, !uses24Hour(recipient))
      });
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
  const events = Event.find({
    status: 'ACTIVE',
    $and: [
      { $or: [
        { reminderMinutes: { $exists: true, $ne: [] } },
        { recurrenceExceptions: { $elemMatch: { cancelled: { $ne: true }, 'overrides.reminderMinutes': { $exists: true, $ne: [] } } } }
      ] },
      { $or: [
        { startsAt: { $gt: new Date() } },
        { recurrenceRrule: { $exists: true, $nin: [null, ''] } }
      ] }
    ]
  }).cursor();
  const { scheduleEventReminders } = await import('./reminders.js');
  for await (const event of events) await scheduleEventReminders(event);
});

agenda.define('cleanup-orphaned-media', async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const assets = await MediaAsset.find({ claimedAt: null, createdAt: { $lt: cutoff } }).limit(100);
  for (const asset of assets) await deleteMediaAsset(asset.ownerId, asset._id).catch(() => undefined);
});

agenda.define('expire-ai-actions', async () => {
  await PendingAiAction.updateMany({ status: 'PENDING', expiresAt: { $lte: new Date() } }, { $set: { status: 'EXPIRED' } });
});

/// Ages out chat history so the server does not carry every conversation for
/// ever. Paid accounts get the longer window and may mark a conversation to
/// keep; a saved one is never swept.
agenda.define('expire-conversations', async () => {
  const now = Date.now();
  const cutoffs = {
    FREE: new Date(now - env.CHAT_RETENTION_DAYS_FREE * 24 * 60 * 60 * 1000),
    PREMIUM: new Date(now - env.CHAT_RETENTION_DAYS_PREMIUM * 24 * 60 * 60 * 1000)
  };
  // The free window is the shorter one, so its cutoff is the later date and
  // the wider net: anything a paid account should lose is already inside it.
  const stale = await Conversation
    .find({ deletedAt: null, savedAt: null, updatedAt: { $lte: cutoffs.FREE } })
    .select('userId updatedAt')
    .limit(500);
  if (!stale.length) return;
  const owners = await User.find({ _id: { $in: stale.map((item) => item.userId) } }).select('plan premiumUntil role');
  const planById = new Map(owners.map((user) => [user._id.toString(), effectivePlan(user)]));
  const due = stale
    .filter((item) => item.updatedAt <= cutoffs[planById.get(item.userId.toString()) === 'PREMIUM' ? 'PREMIUM' : 'FREE'])
    .map((item) => item._id);
  if (due.length) await Conversation.updateMany({ _id: { $in: due } }, { $set: { deletedAt: new Date() } });
});

export const enqueueJob = (name, data, when = 'now') => env.DISABLE_JOBS ? Promise.resolve(null) : agenda.schedule(when, name, data);

export const startAgenda = async () => {
  if (env.DISABLE_JOBS) return;
  await agenda.start();
  await agenda.every('1 hour', 'cleanup-orphaned-media', {}, { skipImmediate: true });
  await agenda.every('10 minutes', 'expire-ai-actions');
  await agenda.every('6 hours', 'expire-conversations', {}, { skipImmediate: true });
  await agenda.every('6 hours', 'reconcile-all-revenuecat', {}, { skipImmediate: true });
  await agenda.every('1 hour', 'purge-due-accounts', {}, { skipImmediate: true });
  await agenda.every('1 day', 'refresh-event-reminders', {}, { skipImmediate: true });
  // Refresh existing future events after a worker restart as well, so changes
  // to reminder behavior reach events created before this release.
  await enqueueJob('refresh-event-reminders', {});
  logger.info('Agenda worker started');
};

export const stopAgenda = () => agenda.stop();
