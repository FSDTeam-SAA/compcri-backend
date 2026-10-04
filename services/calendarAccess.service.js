import { StatusCodes } from 'http-status-codes';
import Calendar from '../models/Calendar.js';
import Delegation from '../models/Delegation.js';
import Event from '../models/Event.js';
import Group from '../models/Group.js';
import { EventShare } from '../models/EventShare.js';
import { DELEGATION_CAPABILITIES } from '../constants/enums.js';
import ApiError from '../utils/ApiError.js';

export const getCalendarAccess = async (userId, calendarId) => {
  const calendar = await Calendar.findById(calendarId);
  if (!calendar) throw new ApiError(404, 'Calendar not found', 'CALENDAR_NOT_FOUND');
  if (calendar.ownerId.toString() === userId.toString()) {
    return { calendar, isOwner: true, capabilities: { view: 'ALL', create: true, edit: 'ALL', delete: 'ALL' } };
  }
  const delegation = await Delegation.findOne({ calendarId, delegateId: userId, status: 'ACTIVE' });
  if (!delegation) throw new ApiError(StatusCodes.FORBIDDEN, 'Calendar access denied', 'CALENDAR_ACCESS_DENIED');
  return { calendar, isOwner: false, delegation, capabilities: DELEGATION_CAPABILITIES[delegation.preset] };
};

export const assertCalendarCreate = async (userId, calendarId) => {
  const access = await getCalendarAccess(userId, calendarId);
  if (!access.capabilities.create) throw new ApiError(403, 'Creating events is not permitted', 'EVENT_CREATE_FORBIDDEN');
  return access;
};

export const getEventAccess = async (userId, eventOrId) => {
  const event = typeof eventOrId === 'string' ? await Event.findById(eventOrId) : eventOrId;
  if (!event || event.status === 'CANCELLED') throw new ApiError(404, 'Event not found', 'EVENT_NOT_FOUND');

  try {
    const calendarAccess = await getCalendarAccess(userId, event.calendarId);
    const createdBySelf = event.createdById.toString() === userId.toString();
    const canView = calendarAccess.capabilities.view === 'ALL' || (calendarAccess.capabilities.view === 'OWN' && createdBySelf);
    if (!canView) throw new ApiError(403, 'Event access denied', 'EVENT_ACCESS_DENIED');
    return {
      event,
      source: calendarAccess.isOwner ? 'OWNER' : 'DELEGATION',
      canView: true,
      canRespond: false,
      canEdit: calendarAccess.capabilities.edit === 'ALL' || (calendarAccess.capabilities.edit === 'OWN' && createdBySelf),
      canDelete: calendarAccess.capabilities.delete === 'ALL' || (calendarAccess.capabilities.delete === 'OWN' && createdBySelf),
      calendarAccess
    };
  } catch (error) {
    if (!['CALENDAR_ACCESS_DENIED', 'EVENT_ACCESS_DENIED'].includes(error.code)) throw error;
  }

  const groups = await Group.find({ 'members.userId': userId, status: 'ACTIVE' }).select('_id');
  const shares = await EventShare.find({ eventId: event._id, status: 'ACTIVE', $or: [
    { targetType: 'USER', targetId: userId },
    { targetType: 'GROUP', targetId: { $in: groups.map((g) => g._id) } }
  ] });
  // A direct invitation must not hide the stronger access granted by a group.
  const rank = { VIEW_ONLY: 1, RESPOND: 2, EDIT: 3 };
  const share = shares.sort((a, b) => rank[b.permission] - rank[a.permission])[0];
  if (!share) throw new ApiError(403, 'Event access denied', 'EVENT_ACCESS_DENIED');
  return {
    event,
    source: share.targetType === 'USER' ? 'DIRECT_SHARE' : 'GROUP_SHARE',
    canView: true,
    canRespond: ['RESPOND', 'EDIT'].includes(share.permission),
    canEdit: share.permission === 'EDIT',
    canDelete: false,
    share
  };
};
