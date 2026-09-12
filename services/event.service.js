import { StatusCodes } from 'http-status-codes';
import { DateTime } from 'luxon';
import Event from '../models/Event.js';
import Calendar from '../models/Calendar.js';
import MediaAsset from '../models/MediaAsset.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import { EventResponse, EventShare } from '../models/EventShare.js';
import ApiError from '../utils/ApiError.js';
import { hasPremiumAccess } from '../utils/premium.js';
import { assertCalendarCreate, getCalendarAccess, getEventAccess } from './calendarAccess.service.js';
import { claimMedia, deleteMediaAsset } from './media.service.js';
import { createNotification } from './notification.service.js';
import { scheduleEventReminders } from '../jobs/reminders.js';
import { assertValidRecurrence, recurrenceBetween } from '../utils/recurrence.js';

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const validateRange = (from, to) => {
  if (to <= from) throw new ApiError(400, 'Invalid date range', 'INVALID_DATE_RANGE');
  if (to - from > MAX_RANGE_MS) throw new ApiError(400, 'Date range cannot exceed 366 days', 'DATE_RANGE_TOO_LARGE');
};

const durationMs = (event) => event.endsAt.getTime() - event.startsAt.getTime();

export const expandEvent = (event, from, to) => {
  const raw = event.toObject ? event.toObject() : event;
  if (!raw.recurrenceRrule) {
    if (raw.startsAt < to && raw.endsAt > from) return [{ ...raw, occurrenceStartAt: raw.startsAt, occurrenceEndAt: raw.endsAt }];
    return [];
  }
  const starts = recurrenceBetween({
    recurrenceRrule: raw.recurrenceRrule,
    startsAt: raw.startsAt,
    timeZone: raw.timeZone,
    from: new Date(from.getTime() - durationMs(raw)),
    to
  });
  return starts.map((start) => {
    const exception = raw.recurrenceExceptions?.find((item) => new Date(item.originalStartAt).getTime() === start.getTime());
    if (exception?.cancelled) return null;
    const occurrence = {
      ...raw,
      ...(exception?.overrides || {}),
      occurrenceStartAt: exception?.overrides?.startsAt ? new Date(exception.overrides.startsAt) : start,
      occurrenceEndAt: exception?.overrides?.endsAt ? new Date(exception.overrides.endsAt) : new Date(start.getTime() + durationMs(raw))
    };
    return occurrence.occurrenceStartAt < to && occurrence.occurrenceEndAt > from ? occurrence : null;
  }).filter(Boolean);
};

const candidateEvents = (calendarId, from, to, excludeId) => Event.find({
  calendarId,
  status: 'ACTIVE',
  ...(excludeId && { _id: { $ne: excludeId } }),
  $or: [
    { recurrenceRrule: { $exists: true, $nin: [null, ''] }, startsAt: { $lt: to } },
    { recurrenceRrule: { $in: [null, ''] }, startsAt: { $lt: to }, endsAt: { $gt: from } },
    { recurrenceRrule: { $exists: false }, startsAt: { $lt: to }, endsAt: { $gt: from } }
  ]
});

export const findConflicts = async (calendarId, startsAt, endsAt, excludeId) => {
  const events = await candidateEvents(calendarId, startsAt, endsAt, excludeId);
  return events.flatMap((event) => expandEvent(event, startsAt, endsAt))
    .filter((occurrence) => occurrence.occurrenceStartAt < endsAt && occurrence.occurrenceEndAt > startsAt)
    .map((occurrence) => ({
      eventId: occurrence._id,
      title: occurrence.title,
      startsAt: occurrence.occurrenceStartAt,
      endsAt: occurrence.occurrenceEndAt
    }));
};

const countMonthOccurrences = async (calendarId, startsAt, excludeId) => {
  const monthStart = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + 1, 1));
  const events = await candidateEvents(calendarId, monthStart, monthEnd, excludeId);
  return events.reduce((count, event) => count + expandEvent(event, monthStart, monthEnd).length, 0);
};

const assertQuota = async (calendar, startsAt, recurrenceRrule, excludeId) => {
  const owner = await User.findById(calendar.ownerId).select('plan premiumUntil');
  if (hasPremiumAccess(owner)) return;
  const monthsToCheck = recurrenceRrule ? 12 : 1;
  for (let offset = 0; offset < monthsToCheck; offset += 1) {
    const target = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + offset, 1));
    const existing = await countMonthOccurrences(calendar._id, target, excludeId);
    const monthEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 1));
    const candidate = { startsAt, endsAt: new Date(startsAt.getTime() + 60_000), recurrenceRrule, recurrenceExceptions: [] };
    const additions = recurrenceRrule ? expandEvent(candidate, target, monthEnd).length : (startsAt >= target && startsAt < monthEnd ? 1 : 0);
    if (existing + additions > 50) throw new ApiError(403, 'Free plan allows up to 50 event occurrences per month', 'FREE_EVENT_LIMIT', { month: target.toISOString().slice(0, 7), existing });
  }
};

const isPremiumCalendar = async (calendar) => {
  const owner = await User.findById(calendar.ownerId).select('plan premiumUntil');
  return hasPremiumAccess(owner);
};

const computeAvailability = async (calendar, calendarId, rangeStart, rangeEnd, durationMinutes) => {
  const events = await candidateEvents(calendarId, rangeStart, rangeEnd);
  const busy = events.flatMap((event) => expandEvent(event, rangeStart, rangeEnd));
  const slots = [];
  const duration = durationMinutes * 60_000;
  const zone = calendar.timeZone;
  let localDay = DateTime.fromJSDate(rangeStart, { zone }).startOf('day');
  const finalLocalDay = DateTime.fromJSDate(rangeEnd, { zone }).startOf('day');
  for (; localDay <= finalLocalDay; localDay = localDay.plus({ days: 1 })) {
    const weekday = localDay.weekday % 7;
    if (!calendar.availability.workingDays.includes(weekday)) continue;
    const [startHour, startMinute] = calendar.availability.workdayStart.split(':').map(Number);
    const [endHour, endMinute] = calendar.availability.workdayEnd.split(':').map(Number);
    const dayStart = localDay.set({ hour: startHour, minute: startMinute }).toUTC().toJSDate();
    const dayEnd = localDay.set({ hour: endHour, minute: endMinute }).toUTC().toJSDate();
    if (dayEnd <= rangeStart || dayStart >= rangeEnd) continue;
    let candidate = dayStart < rangeStart ? new Date(rangeStart) : dayStart;
    const dayBusy = busy.filter((item) => item.occurrenceStartAt < dayEnd && item.occurrenceEndAt > dayStart).sort((a, b) => a.occurrenceStartAt - b.occurrenceStartAt);
    for (const item of dayBusy) {
      if (candidate.getTime() + duration <= item.occurrenceStartAt.getTime()) slots.push({ startsAt: new Date(candidate), endsAt: new Date(candidate.getTime() + duration) });
      if (item.occurrenceEndAt > candidate) candidate = new Date(item.occurrenceEndAt);
    }
    if (candidate.getTime() + duration <= dayEnd.getTime()) slots.push({ startsAt: candidate, endsAt: new Date(candidate.getTime() + duration) });
  }
  return slots.slice(0, 20);
};

const conflictDetails = async (calendar, calendarId, startsAt, endsAt, conflicts) => ({
  conflicts,
  alternatives: await computeAvailability(
    calendar,
    calendarId,
    startsAt,
    new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    Math.min(Math.max(Math.ceil((endsAt - startsAt) / 60_000), 5), 1440)
  )
});

export const listEvents = async (userId, calendarId, from, to, search) => {
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  validateRange(rangeStart, rangeEnd);
  const access = await getCalendarAccess(userId, calendarId);
  const events = await candidateEvents(calendarId, rangeStart, rangeEnd);
  const needle = search?.toLocaleLowerCase();
  return events.flatMap((event) => {
    const createdBySelf = event.createdById.toString() === userId.toString();
    if (access.capabilities.view === 'OWN' && !createdBySelf) return [];
    if (needle && ![event.title, event.description, event.location].some((value) => value?.toLocaleLowerCase().includes(needle))) return [];
    return expandEvent(event, rangeStart, rangeEnd);
  }).sort((a, b) => a.occurrenceStartAt - b.occurrenceStartAt);
};

export const listSharedEvents = async (userId, from, to) => {
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  validateRange(rangeStart, rangeEnd);
  const groups = await Group.find({ 'members.userId': userId, status: 'ACTIVE' }).select('_id');
  const shares = await EventShare.find({
    status: 'ACTIVE',
    $or: [
      { targetType: 'USER', targetId: userId },
      { targetType: 'GROUP', targetId: { $in: groups.map((group) => group._id) } }
    ]
  });
  const eventIds = [...new Set(shares.map((share) => share.eventId.toString()))];
  const events = await Event.find({
    _id: { $in: eventIds },
    status: 'ACTIVE',
    $or: [
      { recurrenceRrule: { $exists: true, $nin: [null, ''] }, startsAt: { $lt: rangeEnd } },
      { recurrenceRrule: { $in: [null, ''] }, startsAt: { $lt: rangeEnd }, endsAt: { $gt: rangeStart } },
      { recurrenceRrule: { $exists: false }, startsAt: { $lt: rangeEnd }, endsAt: { $gt: rangeStart } }
    ]
  });
  const responses = await EventResponse.find({ eventId: { $in: eventIds }, userId });
  const responseMap = new Map(responses.map((response) => [response.eventId.toString(), response.status]));
  const permissionRank = { VIEW_ONLY: 1, RESPOND: 2, EDIT: 3 };
  const shareMap = new Map();
  for (const share of shares) {
    const key = share.eventId.toString();
    const current = shareMap.get(key);
    if (!current || permissionRank[share.permission] > permissionRank[current.permission]) shareMap.set(key, share);
  }
  return events.flatMap((event) => event.createdById.toString() === userId.toString() ? [] : expandEvent(event, rangeStart, rangeEnd).map((occurrence) => ({
    ...occurrence,
    sharePermission: shareMap.get(event._id.toString())?.permission,
    shareSource: shareMap.get(event._id.toString())?.targetType,
    rsvpStatus: responseMap.get(event._id.toString()) || 'PENDING'
  }))).sort((a, b) => a.occurrenceStartAt - b.occurrenceStartAt);
};

export const getEvent = async (userId, eventId) => {
  const access = await getEventAccess(userId, eventId);
  return { event: access.event, permissions: { edit: access.canEdit, delete: access.canDelete, respond: access.canRespond }, accessSource: access.source };
};

export const createEvent = async (userId, calendarId, input) => {
  const access = await assertCalendarCreate(userId, calendarId);
  if (input.groupId && !(await Group.exists({ _id: input.groupId, 'members.userId': userId, status: 'ACTIVE' }))) {
    throw new ApiError(403, 'Active group membership is required', 'GROUP_ACCESS_DENIED');
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  assertValidRecurrence(input.recurrenceRrule, startsAt, input.timeZone);
  await assertQuota(access.calendar, startsAt, input.recurrenceRrule);
  const premium = await isPremiumCalendar(access.calendar);
  const conflicts = premium ? await findConflicts(calendarId, startsAt, endsAt) : [];
  if (conflicts.length && !input.overrideConflicts) {
    throw new ApiError(StatusCodes.CONFLICT, 'Event overlaps with existing events', 'EVENT_CONFLICT', await conflictDetails(access.calendar, calendarId, startsAt, endsAt, conflicts));
  }
  const { overrideConflicts, ...data } = input;
  const event = await Event.create({ ...data, startsAt, endsAt, calendarId, createdById: userId, audit: [{ actorId: userId, action: 'CREATED' }] });
  if (input.posterMediaId) {
    try {
      await claimMedia({ mediaId: input.posterMediaId, ownerId: userId, purpose: 'EVENT_POSTER', claimedByType: 'EVENT', claimedById: event._id });
    } catch (error) {
      await Event.deleteOne({ _id: event._id });
      throw error;
    }
  }
  if (input.groupId) {
    await EventShare.findOneAndUpdate(
      { eventId: event._id, targetType: 'GROUP', targetId: input.groupId },
      { $set: { sharedById: userId, permission: 'RESPOND', status: 'ACTIVE' } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
  }
  await scheduleEventReminders(event);
  return { event, conflicts };
};

export const updateEvent = async (userId, eventId, input) => {
  const access = await getEventAccess(userId, eventId);
  if (!access.canEdit) throw new ApiError(403, 'Editing this event is not permitted', 'EVENT_EDIT_FORBIDDEN');
  if (access.event.__v !== input.version) throw new ApiError(409, 'Event has changed; refresh and retry', 'EVENT_VERSION_CONFLICT');
  const startsAt = input.startsAt ? new Date(input.startsAt) : access.event.startsAt;
  const endsAt = input.endsAt ? new Date(input.endsAt) : access.event.endsAt;
  if (endsAt <= startsAt) throw new ApiError(422, 'Event end must be after its start', 'INVALID_EVENT_RANGE');
  const calendar = access.calendarAccess?.calendar || await Calendar.findById(access.event.calendarId);
  const recurrenceRrule = input.recurrenceRrule !== undefined ? input.recurrenceRrule : access.event.recurrenceRrule;
  assertValidRecurrence(recurrenceRrule, startsAt, input.timeZone || access.event.timeZone);
  if (input.startsAt !== undefined || input.recurrenceRrule !== undefined) {
    await assertQuota(calendar, startsAt, recurrenceRrule, access.event._id);
  }
  const premium = await isPremiumCalendar(calendar);
  const conflicts = premium ? await findConflicts(access.event.calendarId, startsAt, endsAt, access.event._id) : [];
  if (conflicts.length && !input.overrideConflicts) throw new ApiError(409, 'Event overlaps with existing events', 'EVENT_CONFLICT', await conflictDetails(calendar, access.event.calendarId, startsAt, endsAt, conflicts));
  const { version, overrideConflicts, ...changes } = input;
  const oldPosterId = access.event.posterMediaId;
  if (input.posterMediaId) await claimMedia({ mediaId: input.posterMediaId, ownerId: userId, purpose: 'EVENT_POSTER', claimedByType: 'EVENT', claimedById: access.event._id });
  Object.assign(access.event, changes, { startsAt, endsAt });
  access.event.audit.push({ actorId: userId, action: 'UPDATED', changes });
  try {
    await access.event.save();
  } catch (error) {
    if (input.posterMediaId && oldPosterId?.toString() !== input.posterMediaId.toString()) {
      await MediaAsset.updateOne({ _id: input.posterMediaId, claimedById: access.event._id }, { $unset: { claimedByType: 1, claimedById: 1, claimedAt: 1 } });
    }
    throw error;
  }
  if (oldPosterId && oldPosterId.toString() !== access.event.posterMediaId?.toString()) {
    const oldAsset = await MediaAsset.findById(oldPosterId).select('ownerId');
    if (oldAsset) await deleteMediaAsset(oldAsset.ownerId, oldPosterId, { allowClaimed: true }).catch(() => undefined);
  }
  await scheduleEventReminders(access.event);
  return { event: access.event, conflicts };
};

export const getCalendarSettings = async (userId, calendarId) => {
  const { calendar, isOwner } = await getCalendarAccess(userId, calendarId);
  return { calendarId: calendar._id, name: calendar.name, timeZone: calendar.timeZone, availability: calendar.availability, canEdit: isOwner };
};

export const updateCalendarSettings = async (userId, calendarId, input) => {
  const access = await getCalendarAccess(userId, calendarId);
  if (!access.isOwner) throw new ApiError(403, 'Only the calendar owner can change settings', 'CALENDAR_SETTINGS_FORBIDDEN');
  if (input.name !== undefined) access.calendar.name = input.name;
  if (input.timeZone !== undefined) access.calendar.timeZone = input.timeZone;
  if (input.availability !== undefined) access.calendar.availability = input.availability;
  await access.calendar.save();
  return getCalendarSettings(userId, calendarId);
};

export const setRecurrenceException = async (userId, eventId, input) => {
  const access = await getEventAccess(userId, eventId);
  if (!access.canEdit) throw new ApiError(403, 'Editing this event is not permitted', 'EVENT_EDIT_FORBIDDEN');
  if (access.event.__v !== input.version) throw new ApiError(409, 'Event has changed; refresh and retry', 'EVENT_VERSION_CONFLICT');
  if (!access.event.recurrenceRrule) throw new ApiError(409, 'Event is not recurring', 'EVENT_NOT_RECURRING');

  const originalStartAt = new Date(input.originalStartAt);
  const matched = recurrenceBetween({ recurrenceRrule: access.event.recurrenceRrule, startsAt: access.event.startsAt, timeZone: access.event.timeZone, from: new Date(originalStartAt.getTime() - 1000), to: new Date(originalStartAt.getTime() + 1000) });
  if (!matched.some((item) => item.getTime() === originalStartAt.getTime())) throw new ApiError(422, 'The occurrence is not part of this recurrence', 'INVALID_OCCURRENCE');

  const overrides = input.overrides || {};
  const startsAt = overrides.startsAt ? new Date(overrides.startsAt) : originalStartAt;
  const endsAt = overrides.endsAt ? new Date(overrides.endsAt) : new Date(startsAt.getTime() + durationMs(access.event));
  let conflicts = [];
  if (!input.cancelled && (overrides.startsAt || overrides.endsAt)) {
    const calendar = access.calendarAccess?.calendar || await Calendar.findById(access.event.calendarId);
    if (await isPremiumCalendar(calendar)) conflicts = await findConflicts(access.event.calendarId, startsAt, endsAt, access.event._id);
    if (conflicts.length && !input.overrideConflicts) throw new ApiError(409, 'Occurrence overlaps with existing events', 'EVENT_CONFLICT', await conflictDetails(calendar, access.event.calendarId, startsAt, endsAt, conflicts));
  }

  access.event.recurrenceExceptions = access.event.recurrenceExceptions.filter((item) => item.originalStartAt.getTime() !== originalStartAt.getTime());
  access.event.recurrenceExceptions.push({
    originalStartAt,
    cancelled: input.cancelled,
    overrides: input.cancelled ? undefined : { ...overrides, ...(overrides.startsAt && { startsAt }), ...(overrides.endsAt && { endsAt }) }
  });
  access.event.audit.push({ actorId: userId, action: input.cancelled ? 'OCCURRENCE_CANCELLED' : 'OCCURRENCE_UPDATED', changes: { originalStartAt, overrides } });
  await access.event.save();
  await scheduleEventReminders(access.event);
  return { event: access.event, conflicts };
};

export const deleteEvent = async (userId, eventId, version) => {
  const access = await getEventAccess(userId, eventId);
  if (!access.canDelete) throw new ApiError(403, 'Deleting this event is not permitted', 'EVENT_DELETE_FORBIDDEN');
  if (access.event.__v !== Number(version)) throw new ApiError(409, 'Event has changed; refresh and retry', 'EVENT_VERSION_CONFLICT');
  access.event.status = 'CANCELLED';
  access.event.audit.push({ actorId: userId, action: 'CANCELLED' });
  await access.event.save();
  await scheduleEventReminders(access.event);
  return access.event;
};

export const setCompleted = async (userId, eventId, completed, version) => {
  const access = await getEventAccess(userId, eventId);
  if (!access.canEdit) throw new ApiError(403, 'Editing this event is not permitted', 'EVENT_EDIT_FORBIDDEN');
  if (access.event.__v !== version) throw new ApiError(409, 'Event has changed; refresh and retry', 'EVENT_VERSION_CONFLICT');
  access.event.completedAt = completed ? new Date() : null;
  access.event.audit.push({ actorId: userId, action: completed ? 'COMPLETED' : 'REOPENED' });
  await access.event.save();
  return access.event;
};

export const shareEvent = async (userId, eventId, input) => {
  const access = await getEventAccess(userId, eventId);
  if (access.source !== 'OWNER' && access.source !== 'DELEGATION') throw new ApiError(403, 'Re-sharing is not permitted', 'EVENT_RESHARE_FORBIDDEN');
  if (!access.calendarAccess?.isOwner && access.calendarAccess?.delegation?.preset !== 'FULL_ACCESS') throw new ApiError(403, 'Sharing is not permitted', 'EVENT_SHARE_FORBIDDEN');
  const results = [];
  for (const targetId of input.targetIds) {
    if (input.targetType === 'USER' && !(await User.exists({ _id: targetId, status: 'ACTIVE' }))) throw new ApiError(404, 'Target user not found', 'SHARE_TARGET_NOT_FOUND');
    if (input.targetType === 'GROUP' && !(await Group.exists({ _id: targetId, 'members.userId': userId, status: 'ACTIVE' }))) throw new ApiError(404, 'Target group not found', 'SHARE_TARGET_NOT_FOUND');
    const share = await EventShare.findOneAndUpdate(
      { eventId, targetType: input.targetType, targetId },
      { $set: { sharedById: userId, permission: input.permission, status: 'ACTIVE' } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    results.push(share);
    if (input.targetType === 'USER') {
      await EventResponse.findOneAndUpdate({ eventId, userId: targetId }, { $setOnInsert: { status: 'PENDING' } }, { upsert: true });
      await createNotification(targetId, 'INVITATION', 'Event shared with you', access.event.title, { eventId });
    }
  }
  return results;
};

const assertCanManageShares = async (userId, eventId) => {
  const access = await getEventAccess(userId, eventId);
  if (access.source !== 'OWNER' && (!access.calendarAccess || access.calendarAccess.delegation?.preset !== 'FULL_ACCESS')) {
    throw new ApiError(403, 'Sharing is not permitted', 'EVENT_SHARE_FORBIDDEN');
  }
  return access;
};

export const listEventShares = async (userId, eventId) => {
  await assertCanManageShares(userId, eventId);
  return EventShare.find({ eventId, status: 'ACTIVE' }).sort({ createdAt: 1 });
};

export const revokeEventShare = async (userId, eventId, shareId) => {
  await assertCanManageShares(userId, eventId);
  const share = await EventShare.findOne({ _id: shareId, eventId, status: 'ACTIVE' });
  if (!share) throw new ApiError(404, 'Event share not found', 'EVENT_SHARE_NOT_FOUND');
  share.status = 'REVOKED';
  await share.save();
  return { revoked: true };
};

export const respondToEvent = async (userId, eventId, status) => {
  const access = await getEventAccess(userId, eventId);
  if (!access.canRespond) throw new ApiError(403, 'Responding to this event is not permitted', 'EVENT_RESPONSE_FORBIDDEN');
  return EventResponse.findOneAndUpdate(
    { eventId, userId },
    { $set: { status, respondedAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
};

export const findAvailability = async (userId, calendarId, from, to, durationMinutes) => {
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  validateRange(rangeStart, rangeEnd);
  const access = await getCalendarAccess(userId, calendarId);
  const owner = await User.findById(access.calendar.ownerId).select('plan premiumUntil');
  if (!hasPremiumAccess(owner)) throw new ApiError(403, 'Premium subscription required', 'PREMIUM_REQUIRED');
  return computeAvailability(access.calendar, calendarId, rangeStart, rangeEnd, durationMinutes);
};
