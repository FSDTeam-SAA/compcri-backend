import logger from '../config/logger.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Note from '../models/Note.js';
import Group from '../models/Group.js';
import Delegation from '../models/Delegation.js';
import Contact from '../models/Contact.js';
import { AiUsage, Conversation } from '../models/Ai.js';
import { AppInstall, UserActivity } from '../models/Analytics.js';
import { DAY_MS, bucketOf, isoDay, resolveRange, utcDay } from '../utils/range.js';

const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const PLATFORMS = { ios: 'IOS', android: 'ANDROID' };

/// What the app says about itself in its request headers. Builds older than
/// this release send none of them, and are still counted as UNKNOWN.
export const clientInfo = (req) => {
  const installId = String(req.get?.('x-install-id') || '');
  return {
    platform: PLATFORMS[String(req.get?.('x-client-platform') || '').toLowerCase()] || 'UNKNOWN',
    appVersion: String(req.get?.('x-app-version') || '').slice(0, 40) || undefined,
    installId: /^[A-Za-z0-9-]{16,64}$/.test(installId) ? installId : undefined
  };
};

// When each user was last written, so a busy session costs one write per
// window rather than one per request. Per process, which only means a second
// process may write the same window once more.
const lastRecorded = new Map();

/// Records that [userId] used the app now. Never throws and never delays the
/// request it rides on.
export const trackActivity = (userId, req) => {
  const now = new Date();
  const key = userId.toString();
  const previous = lastRecorded.get(key);
  const day = utcDay(now);
  if (previous && previous.day === +day && now - previous.at < ACTIVITY_WINDOW_MS) return;
  if (lastRecorded.size > 50_000) lastRecorded.clear();
  lastRecorded.set(key, { at: +now, day: +day });
  const { platform, appVersion, installId } = clientInfo(req);
  Promise.all([
    UserActivity.updateOne(
      { userId, day },
      {
        $inc: { activeWindows: 1 },
        $set: { lastSeenAt: now, ...(platform !== 'UNKNOWN' && { platform }), ...(appVersion && { appVersion }) },
        $setOnInsert: { firstSeenAt: now }
      },
      { upsert: true }
    ).catch((error) => {
      // Two requests racing to create the day's row: the other one won.
      if (error.code !== 11000) throw error;
    }),
    User.updateOne({ _id: userId }, { $set: { lastActiveAt: now } }),
    installId ? AppInstall.updateOne({ installId, userId: { $ne: userId } }, { $set: { userId } }) : null
  ]).catch((error) => logger.warn({ err: error, userId: key }, 'Activity tracking failed'));
};

/// Counts a launch of the app. The first launch of a new install id is the
/// install itself; [preexisting] marks copies that were installed before the
/// app reported launches, so they are not mistaken for new downloads.
export const recordInstall = async ({ installId, platform, appVersion, osVersion, locale, preexisting }) => {
  const now = new Date();
  try {
    await AppInstall.updateOne(
      { installId },
      {
        $set: { platform, lastOpenedAt: now, ...(appVersion && { appVersion }), ...(osVersion && { osVersion }), ...(locale && { locale }) },
        $setOnInsert: { firstOpenedAt: now, ...(preexisting && { preexisting: true }) },
        $inc: { opens: 1 }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  return { recorded: true };
};

const fillCounts = (rows) => Object.fromEntries(rows.map((row) => [row._id ?? 'UNKNOWN', row.count]));

const featureUsage = async (start, end) => {
  const createdAt = { $gte: start, $lte: end };
  const [events, notes, voiceNotes, conversations, aiRequests, groups, delegations, contacts, eventCreators] = await Promise.all([
    Event.countDocuments({ createdAt }),
    Note.countDocuments({ createdAt }),
    Note.countDocuments({ createdAt, source: 'VOICE' }),
    Conversation.countDocuments({ createdAt }),
    AiUsage.aggregate([
      { $match: { day: { $gte: isoDay(start), $lte: isoDay(end) } } },
      { $group: { _id: null, requests: { $sum: '$requestCount' } } }
    ]),
    Group.countDocuments({ createdAt }),
    Delegation.countDocuments({ createdAt }),
    Contact.countDocuments({ createdAt }),
    Event.distinct('createdById', { createdAt })
  ]);
  return {
    eventsCreated: events,
    usersCreatingEvents: eventCreators.length,
    notesCreated: notes,
    voiceNotes,
    aiConversations: conversations,
    aiRequests: aiRequests[0]?.requests || 0,
    groupsCreated: groups,
    delegationsCreated: delegations,
    contactsConnected: contacts
  };
};

const topActiveUsers = async (start, end, limit = 10) => {
  const rows = await UserActivity.aggregate([
    { $match: { day: { $gte: utcDay(start), $lte: end } } },
    { $group: { _id: '$userId', activeDays: { $sum: 1 }, activeWindows: { $sum: '$activeWindows' }, lastSeenAt: { $max: '$lastSeenAt' }, platform: { $last: '$platform' } } },
    { $sort: { activeWindows: -1, activeDays: -1 } },
    { $limit: limit }
  ]);
  const users = await User.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('displayName email contactCode plan status avatarMediaId')
    .populate('avatarMediaId');
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  return rows
    .filter((row) => byId.has(row._id.toString()))
    .map((row) => ({ user: byId.get(row._id.toString()), activeDays: row.activeDays, activeMinutes: row.activeWindows * 5, lastSeenAt: row.lastSeenAt, platform: row.platform }));
};

const distinctUsers = async (filter) => (await UserActivity.distinct('userId', filter)).length;

/// Downloads (first launches), sign-ups, active users and feature use for the
/// requested window, plus today's DAU/WAU/MAU.
export const usageReport = async (query) => {
  const { start, end, unit } = resolveRange(query);
  const now = new Date();
  const today = utcDay(now);
  const dayRange = { $gte: utcDay(start), $lte: end };
  const newInstall = { preexisting: { $ne: true } };
  const [installTotals, installSeries, signupSeries, activeSeries, activeUsers, activeByPlatform, dau, wau, mau, versions, features, topUsers, totalUsers, premiumUsers] = await Promise.all([
    AppInstall.aggregate([
      { $group: {
        _id: '$platform',
        tracked: { $sum: 1 },
        total: { $sum: { $cond: [{ $ne: ['$preexisting', true] }, 1, 0] } },
        inRange: { $sum: { $cond: [{ $and: [{ $ne: ['$preexisting', true] }, { $gte: ['$firstOpenedAt', start] }, { $lte: ['$firstOpenedAt', end] }] }, 1, 0] } },
        active30: { $sum: { $cond: [{ $gte: ['$lastOpenedAt', new Date(+now - 30 * DAY_MS)] }, 1, 0] } }
      } }
    ]),
    AppInstall.aggregate([
      { $match: { ...newInstall, firstOpenedAt: { $gte: start, $lte: end } } },
      { $group: { _id: { bucket: bucketOf('$firstOpenedAt', unit), platform: '$platform' }, count: { $sum: 1 } } }
    ]),
    User.aggregate([
      { $match: { role: 'USER', createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: bucketOf('$createdAt', unit), count: { $sum: 1 } } }
    ]),
    UserActivity.aggregate([
      { $match: { day: dayRange } },
      { $group: { _id: { bucket: bucketOf('$day', unit), userId: '$userId' } } },
      { $group: { _id: '$_id.bucket', users: { $sum: 1 } } }
    ]),
    distinctUsers({ day: dayRange }),
    UserActivity.aggregate([
      { $match: { day: dayRange } },
      { $sort: { day: 1 } },
      { $group: { _id: '$userId', platform: { $last: '$platform' } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ]),
    distinctUsers({ day: today }),
    distinctUsers({ day: { $gt: new Date(+today - 7 * DAY_MS) } }),
    distinctUsers({ day: { $gt: new Date(+today - 30 * DAY_MS) } }),
    AppInstall.aggregate([
      { $match: { lastOpenedAt: { $gte: new Date(+now - 30 * DAY_MS) } } },
      { $group: { _id: { platform: '$platform', appVersion: '$appVersion' }, installs: { $sum: 1 } } },
      { $sort: { installs: -1 } },
      { $limit: 20 }
    ]),
    featureUsage(start, end),
    topActiveUsers(start, end),
    User.countDocuments({ role: 'USER', status: { $ne: 'DELETED' } }),
    User.countDocuments({ role: 'USER', plan: 'PREMIUM', status: { $ne: 'DELETED' } })
  ]);
  const sum = (key) => installTotals.reduce((total, row) => total + row[key], 0);
  const series = new Map();
  const point = (bucket) => {
    if (!series.has(bucket)) series.set(bucket, { bucket, installs: 0, iosInstalls: 0, androidInstalls: 0, signups: 0, activeUsers: 0 });
    return series.get(bucket);
  };
  for (const row of installSeries) {
    const entry = point(row._id.bucket);
    entry.installs += row.count;
    if (row._id.platform === 'IOS') entry.iosInstalls += row.count;
    if (row._id.platform === 'ANDROID') entry.androidInstalls += row.count;
  }
  for (const row of signupSeries) point(row._id).signups = row.count;
  for (const row of activeSeries) point(row._id).activeUsers = row.users;
  return {
    range: { from: start, to: end, unit },
    installs: {
      total: sum('total'),
      tracked: sum('tracked'),
      inRange: sum('inRange'),
      activeLast30Days: sum('active30'),
      byPlatform: installTotals.map((row) => ({ platform: row._id, total: row.total, inRange: row.inRange }))
    },
    users: { total: totalUsers, premium: premiumUsers, signupsInRange: signupSeries.reduce((total, row) => total + row.count, 0) },
    activity: {
      dau, wau, mau,
      stickiness: mau ? Math.round((dau / mau) * 1000) / 10 : 0,
      activeInRange: activeUsers,
      byPlatform: fillCounts(activeByPlatform)
    },
    series: [...series.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    appVersions: versions.map((row) => ({ platform: row._id.platform, appVersion: row._id.appVersion || 'Unknown', installs: row.installs })),
    features,
    topUsers
  };
};

/// What one user has been doing, for the admin user detail.
export const userActivitySummary = async (userId) => {
  const since = new Date(+utcDay() - 29 * DAY_MS);
  const [days, installs, events, notes, conversations] = await Promise.all([
    UserActivity.find({ userId, day: { $gte: since } }).sort({ day: -1 }).lean(),
    AppInstall.find({ userId }).sort({ lastOpenedAt: -1 }).limit(5).lean(),
    Event.countDocuments({ createdById: userId }),
    Note.countDocuments({ userId, deletedAt: null }),
    Conversation.countDocuments({ userId })
  ]);
  return {
    activeDaysLast30: days.length,
    activeMinutesLast30: days.reduce((total, day) => total + day.activeWindows * 5, 0),
    lastPlatform: days[0]?.platform,
    lastAppVersion: days.find((day) => day.appVersion)?.appVersion,
    days: days.map((day) => ({ day: day.day, activeMinutes: day.activeWindows * 5 })),
    installs: installs.map((install) => ({ platform: install.platform, appVersion: install.appVersion, firstOpenedAt: install.firstOpenedAt, lastOpenedAt: install.lastOpenedAt, opens: install.opens })),
    totals: { eventsCreated: events, notes, aiConversations: conversations }
  };
};
