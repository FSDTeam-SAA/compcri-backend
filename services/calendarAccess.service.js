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
    if (error.code !== 'CALENDAR_ACCESS_DENIED') throw error;
  }

  const directShare = await EventShare.findOne({ eventId: event._id, targetType: 'USER', targetId: userId, status: 'ACTIVE' });
  let groupShare;
  if (!directShare) {
    const groups = await Group.find({ 'members.userId': userId, status: 'ACTIVE' }).select('_id');
    groupShare = await EventShare.findOne({ eventId: event._id, targetType: 'GROUP', targetId: { $in: groups.map((g) => g._id) }, status: 'ACTIVE' });
  }
  const share = directShare || groupShare;
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

