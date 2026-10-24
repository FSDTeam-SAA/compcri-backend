import { StatusCodes } from 'http-status-codes';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { AccountDeletion, AuditLog } from '../models/Operations.js';
import { RevenueCatEvent, Subscription } from '../models/Subscription.js';
import ApiError from '../utils/ApiError.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { revokeAllSessions } from './token.service.js';
import { enqueueJob } from '../jobs/agenda.js';
import { escapeRegex } from '../utils/regex.js';
import CouponRedemption from '../models/CouponRedemption.js';
import Device from '../models/Device.js';
import { userActivitySummary } from './analytics.service.js';

const periodStart = (period) => {
  const now = new Date();
  if (period === 'week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === 'year') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

export const dashboard = async (period = 'month') => {
  const start = periodStart(period);
  const [totalUsers, freeUsers, premiumUsers, userGrowth, revenue, recentActivity] = await Promise.all([
    User.countDocuments({ role: 'USER', status: { $ne: 'DELETED' } }),
    User.countDocuments({ role: 'USER', plan: 'FREE', status: { $ne: 'DELETED' } }),
    User.countDocuments({ role: 'USER', plan: 'PREMIUM', status: { $ne: 'DELETED' } }),
    User.aggregate([
      { $match: { role: 'USER', createdAt: { $gte: start } } },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } }, count: { $sum: 1 }, free: { $sum: { $cond: [{ $eq: ['$plan', 'FREE'] }, 1, 0] } }, premium: { $sum: { $cond: [{ $eq: ['$plan', 'PREMIUM'] }, 1, 0] } } } },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]),
    RevenueCatEvent.aggregate([
      { $match: { type: { $in: ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE'] }, eventAt: { $gte: start } } },
      { $group: { _id: '$currency', amountMinor: { $sum: '$priceMinor' }, transactions: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    AuditLog.find({ createdAt: { $gte: start } }).populate('actorId', 'displayName email contactCode avatarMediaId').sort({ createdAt: -1 }).limit(20)
  ]);
  return { totals: { totalUsers, freeUsers, premiumUsers }, userGrowth, revenueByCurrency: revenue, recentActivity };
};

const userSorts = {
  newest: { createdAt: -1 },
  lastActive: { lastActiveAt: -1, createdAt: -1 },
  leastActive: { lastActiveAt: 1, createdAt: 1 }
};

export const listUsers = async (query) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = { role: 'USER' };
  if (query.plan) filter.plan = query.plan;
  if (query.status) filter.status = query.status;
  if (query.activeWithinDays) filter.lastActiveAt = { $gte: new Date(Date.now() - query.activeWithinDays * 24 * 60 * 60 * 1000) };
  if (query.inactiveForDays) filter.$and = [{ $or: [{ lastActiveAt: { $lt: new Date(Date.now() - query.inactiveForDays * 24 * 60 * 60 * 1000) } }, { lastActiveAt: null }] }];
  if (query.search) filter.$or = [
    { displayName: { $regex: escapeRegex(query.search), $options: 'i' } },
    { email: { $regex: escapeRegex(query.search), $options: 'i' } },
    { contactCode: { $regex: escapeRegex(query.search), $options: 'i' } }
  ];
  const [items, total] = await Promise.all([
    User.find(filter).select('displayName email contactCode plan status createdAt avatarMediaId profession country city phone interests lastActiveAt lastLoginAt').populate('avatarMediaId').sort(userSorts[query.sort] || userSorts.newest).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
};

export const getUser = async (id) => {
  const [user, subscription, deletion] = await Promise.all([
    User.findOne({ _id: id, role: 'USER' }).populate('avatarMediaId'),
    Subscription.findOne({ userId: id }),
    AccountDeletion.findOne({ userId: id, cancelledAt: null, purgedAt: null })
  ]);
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  const [activity, devices, payments, coupons, recentActions] = await Promise.all([
    userActivitySummary(user._id),
    Device.find({ userId: id }).select('platform lastSeenAt createdAt').sort({ lastSeenAt: -1 }).limit(5).lean(),
    RevenueCatEvent.find({ appUserId: user.revenueCatAppUserId, type: { $in: ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'UNCANCELLATION', 'PRODUCT_CHANGE'] } })
      .select('eventId type productId platform priceMinor currency eventAt payload.event.environment payload.event.period_type payload.event.is_trial_conversion').sort({ eventAt: -1 }).limit(20).lean(),
    CouponRedemption.find({ userId: id }).select('code status environment appliedAt completedAt paidAt revenueUsd refundedAt').sort({ createdAt: -1 }).limit(10).lean(),
    AuditLog.find({ $or: [{ actorId: id }, { targetType: 'User', targetId: id }] }).select('action createdAt metadata actorId').sort({ createdAt: -1 }).limit(20).lean()
  ]);
  return {
    user, subscription, deletion, activity, devices, coupons, recentActions,
    payments: payments.map((row) => ({
      id: row.eventId,
      type: row.type,
      productId: row.productId,
      store: row.platform,
      amount: (row.priceMinor || 0) / 100,
      currency: row.currency,
      at: row.eventAt,
      environment: row.payload?.event?.environment || 'PRODUCTION',
      trial: row.payload?.event?.period_type === 'TRIAL',
      trialConversion: Boolean(row.payload?.event?.is_trial_conversion)
    }))
  };
};

export const changeUserStatus = async (actorId, id, action) => {
  if (actorId.toString() === id.toString()) throw new ApiError(400, 'You cannot change your own status', 'SELF_STATUS_CHANGE_FORBIDDEN');
  const status = action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
  const user = await User.findOneAndUpdate({ _id: id, role: 'USER', status: { $ne: 'PENDING_DELETION' } }, { $set: { status } }, { returnDocument: 'after' });
  if (!user) throw new ApiError(404, 'User not found or pending deletion', 'USER_NOT_FOUND');
  if (status === 'SUSPENDED') await revokeAllSessions(id);
  return user;
};

export const scheduleUserDeletion = async (id, reason) => {
  const user = await User.findOne({ _id: id, role: 'USER' });
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  if (await AccountDeletion.exists({ userId: id, cancelledAt: null, purgedAt: null })) throw new ApiError(409, 'Deletion is already scheduled', 'DELETION_ALREADY_SCHEDULED');
  const purgeAt = new Date(Date.now() + env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const deletion = await AccountDeletion.findOneAndUpdate(
    { userId: id },
    { $set: { reason: `Admin: ${reason}`, requestedAt: new Date(), purgeAt }, $unset: { cancelledAt: 1, purgedAt: 1 } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  user.status = 'PENDING_DELETION';
  await Promise.all([user.save(), revokeAllSessions(id), enqueueJob('purge-account', { userId: id.toString() }, purgeAt)]);
  return deletion;
};

export const subscriptionAnalytics = async (period = 'month') => {
  const start = periodStart(period);
  const [statusCounts, productCounts, revenue] = await Promise.all([
    Subscription.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Subscription.aggregate([{ $match: { productId: { $ne: null } } }, { $group: { _id: { productId: '$productId', platform: '$platform' }, count: { $sum: 1 } } }]),
    RevenueCatEvent.aggregate([
      { $match: { type: { $in: ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE'] }, eventAt: { $gte: start } } },
      { $group: { _id: { currency: '$currency', year: { $year: '$eventAt' }, month: { $month: '$eventAt' } }, amountMinor: { $sum: '$priceMinor' }, transactions: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ])
  ]);
  return { statusCounts, productCounts, revenue };
};

export const listAuditLogs = async (query) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.from || query.to) filter.createdAt = { ...(query.from && { $gte: new Date(`${query.from}T00:00:00.000Z`) }), ...(query.to && { $lte: new Date(`${query.to}T23:59:59.999Z`) }) };
  const [items, total] = await Promise.all([
    AuditLog.find(filter).populate({ path: 'actorId', select: 'displayName email role contactCode avatarMediaId', populate: { path: 'avatarMediaId' } }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter)
  ]);
  return { items, meta: paginationMeta(page, limit, total) };
};

export const auditActions = () => AuditLog.distinct('action');
