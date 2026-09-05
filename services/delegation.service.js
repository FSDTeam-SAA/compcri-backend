import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import User from '../models/User.js';
import Calendar from '../models/Calendar.js';
import Delegation from '../models/Delegation.js';
import { Subscription } from '../models/Subscription.js';
import ApiError from '../utils/ApiError.js';
import { humanCode, randomUuid } from '../utils/crypto.js';
import { hashPassword } from './auth.service.js';
import { createNotification } from './notification.service.js';

const ownerCalendar = async (ownerId) => {
  const calendar = await Calendar.findOne({ ownerId });
  if (!calendar) throw new ApiError(404, 'Primary calendar not found', 'CALENDAR_NOT_FOUND');
  return calendar;
};

export const lookupAssistant = async (ownerId, email) => {
  const user = await User.findOne({ email, status: 'ACTIVE' }).select('displayName email avatarMediaId');
  if (!user) return { exists: false, email };
  if (user._id.toString() === ownerId.toString()) throw new ApiError(400, 'You cannot delegate to yourself', 'SELF_DELEGATION_FORBIDDEN');
  return { exists: true, user };
};

const createAssistantAccount = async (input) => {
  if (await User.exists({ email: input.email })) throw new ApiError(409, 'Email is already registered; use the existing-account flow', 'EMAIL_IN_USE');
  let contactCode;
  for (let i = 0; i < 10; i += 1) {
    contactCode = humanCode(input.displayName);
    if (!(await User.exists({ contactCode }))) break;
  }
  const user = await User.create({
    email: input.email,
    displayName: input.displayName,
    passwordHash: await hashPassword(input.password),
    contactCode,
    revenueCatAppUserId: randomUuid()
  });
  await Promise.all([
    Calendar.create({ ownerId: user._id, name: `${input.displayName} Calendar` }),
    Subscription.create({ userId: user._id, appUserId: user.revenueCatAppUserId })
  ]);
  return user;
};

export const createDelegation = async (ownerId, input) => {
  const calendar = await ownerCalendar(ownerId);
  const delegate = input.accountType === 'NEW' ? await createAssistantAccount(input) : await User.findOne({ _id: input.userId, status: 'ACTIVE' });
  if (!delegate) throw new ApiError(404, 'Assistant account not found', 'USER_NOT_FOUND');
  if (delegate._id.toString() === ownerId.toString()) throw new ApiError(400, 'You cannot delegate to yourself', 'SELF_DELEGATION_FORBIDDEN');
  const existing = await Delegation.findOne({ calendarId: calendar._id, delegateId: delegate._id });
  if (existing?.status === 'ACTIVE') throw new ApiError(409, 'This assistant already has access', 'DELEGATION_EXISTS');
  const delegation = await Delegation.findOneAndUpdate(
    { calendarId: calendar._id, delegateId: delegate._id },
    { $set: { ownerId, preset: input.preset, status: 'ACTIVE', revokedAt: null } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  await createNotification(delegate._id, 'SECURITY', 'Calendar access granted', 'You now have delegated access to a calendar', { calendarId: calendar._id });
  return delegation.populate('delegateId', 'displayName email avatarMediaId');
};

export const listDelegations = async (ownerId) => Delegation.find({ ownerId, status: 'ACTIVE' })
  .populate('delegateId', 'displayName email avatarMediaId')
  .sort({ createdAt: -1 });

export const getDelegation = async (ownerId, id) => {
  const item = await Delegation.findOne({ _id: id, ownerId, status: 'ACTIVE' }).populate('delegateId', 'displayName email avatarMediaId phone profession country city');
  if (!item) throw new ApiError(404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
  return item;
};

export const updateDelegation = async (ownerId, id, preset) => {
  const item = await Delegation.findOneAndUpdate({ _id: id, ownerId, status: 'ACTIVE' }, { $set: { preset } }, { returnDocument: 'after', runValidators: true });
  if (!item) throw new ApiError(404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
  return item;
};

export const revokeDelegation = async (ownerId, id) => {
  const item = await Delegation.findOneAndUpdate({ _id: id, ownerId, status: 'ACTIVE' }, { $set: { status: 'REVOKED', revokedAt: new Date() } }, { returnDocument: 'after' });
  if (!item) throw new ApiError(404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
  return item;
};
