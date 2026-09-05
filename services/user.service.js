import { StatusCodes } from 'http-status-codes';
import User from '../models/User.js';
import Calendar from '../models/Calendar.js';
import Delegation from '../models/Delegation.js';
import { Subscription } from '../models/Subscription.js';
import { AccountDeletion } from '../models/Operations.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword } from './auth.service.js';
import { revokeAllSessions } from './token.service.js';
import { claimMedia, deleteMediaAsset } from './media.service.js';
import { enqueueJob } from '../jobs/agenda.js';
import { createNotification } from './notification.service.js';

export const getMe = async (userId) => {
  const [user, subscription, calendar] = await Promise.all([
    User.findById(userId).populate('avatarMediaId'),
    Subscription.findOne({ userId }),
    Calendar.findOne({ ownerId: userId })
  ]);
  return { user, subscription, primaryCalendar: calendar };
};

export const updateMe = async (userId, input) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  const oldAvatarId = user.avatarMediaId;
  Object.assign(user, input);
  if (input.avatarMediaId) {
    await claimMedia({ mediaId: input.avatarMediaId, ownerId: userId, purpose: 'AVATAR', claimedByType: 'USER', claimedById: userId });
  }
  await user.save();
  if (oldAvatarId && oldAvatarId.toString() !== user.avatarMediaId?.toString()) {
    await deleteMediaAsset(userId, oldAvatarId, { allowClaimed: true }).catch(() => undefined);
  }
  return user.populate('avatarMediaId');
};

export const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(userId);
  await createNotification(userId, 'SECURITY', 'Password changed', 'Your password was changed and other sessions were revoked');
};

export const updateNotificationPreferences = async (userId, input) => User.findByIdAndUpdate(
  userId,
  { $set: Object.fromEntries(Object.entries(input).map(([key, value]) => [`notificationPreferences.${key}`, value])) },
  { returnDocument: 'after', runValidators: true }
);

export const accessibleCalendars = async (userId) => {
  const owned = await Calendar.findOne({ ownerId: userId }).populate('ownerId', 'displayName email avatarMediaId');
  const delegations = await Delegation.find({ delegateId: userId, status: 'ACTIVE' })
    .populate({ path: 'calendarId', populate: { path: 'ownerId', select: 'displayName email avatarMediaId' } });
  return {
    owned: owned ? [{ calendar: owned, preset: 'OWNER' }] : [],
    delegated: delegations.map((item) => ({ calendar: item.calendarId, preset: item.preset, delegationId: item._id }))
  };
};

export const subscriptionManagement = async (userId) => {
  const subscription = await Subscription.findOne({ userId });
  return { managementUrl: subscription?.managementUrl || null, status: subscription?.status || 'FREE' };
};

export const requestDeletion = async (userId, password, reason) => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Password is incorrect', 'INVALID_CREDENTIALS');
  }
  if (await AccountDeletion.exists({ userId, cancelledAt: null, purgedAt: null })) {
    throw new ApiError(409, 'Deletion is already scheduled', 'DELETION_ALREADY_SCHEDULED');
  }
  const purgeAt = new Date(Date.now() + env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const deletion = await AccountDeletion.findOneAndUpdate(
    { userId },
    { $set: { reason, requestedAt: new Date(), purgeAt }, $unset: { cancelledAt: 1, purgedAt: 1 } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  user.status = 'PENDING_DELETION';
  await Promise.all([user.save(), revokeAllSessions(userId)]);
  await enqueueJob('purge-account', { userId: userId.toString() }, purgeAt);
  const subscription = await Subscription.findOne({ userId }).select('managementUrl status');
  return { deletion, managementUrl: subscription?.managementUrl || null, billingManagedSeparately: true };
};
