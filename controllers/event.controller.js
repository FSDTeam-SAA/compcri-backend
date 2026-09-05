import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import * as service from '../services/event.service.js';
import { audit } from '../services/audit.service.js';

export const list = catchAsync(async (req, res) => sendSuccess(res, await service.listEvents(req.user._id, req.params.calendarId, req.query.from, req.query.to, req.query.search)));
export const shared = catchAsync(async (req, res) => sendSuccess(res, await service.listSharedEvents(req.user._id, req.query.from, req.query.to)));
export const get = catchAsync(async (req, res) => sendSuccess(res, await service.getEvent(req.user._id, req.params.eventId)));
export const create = catchAsync(async (req, res) => {
  const data = await service.createEvent(req.user._id, req.params.calendarId, req.body);
  await audit({ req, action: 'EVENT_CREATED', targetType: 'Event', targetId: data.event._id });
  sendSuccess(res, data, { status: 201 });
});
export const update = catchAsync(async (req, res) => sendSuccess(res, await service.updateEvent(req.user._id, req.params.eventId, req.body)));
export const remove = catchAsync(async (req, res) => sendSuccess(res, await service.deleteEvent(req.user._id, req.params.eventId, req.query.version)));
export const complete = catchAsync(async (req, res) => sendSuccess(res, await service.setCompleted(req.user._id, req.params.eventId, req.body.completed, req.body.version)));
export const share = catchAsync(async (req, res) => sendSuccess(res, await service.shareEvent(req.user._id, req.params.eventId, req.body)));
export const rsvp = catchAsync(async (req, res) => sendSuccess(res, await service.respondToEvent(req.user._id, req.params.eventId, req.body.status)));
export const availability = catchAsync(async (req, res) => sendSuccess(res, await service.findAvailability(req.user._id, req.params.calendarId, req.query.from, req.query.to, req.query.durationMinutes)));
export const getSettings = catchAsync(async (req, res) => sendSuccess(res, await service.getCalendarSettings(req.user._id, req.params.calendarId)));
export const updateSettings = catchAsync(async (req, res) => sendSuccess(res, await service.updateCalendarSettings(req.user._id, req.params.calendarId, req.body)));
export const exception = catchAsync(async (req, res) => sendSuccess(res, await service.setRecurrenceException(req.user._id, req.params.eventId, req.body)));
export const listShares = catchAsync(async (req, res) => sendSuccess(res, await service.listEventShares(req.user._id, req.params.eventId)));
export const revokeShare = catchAsync(async (req, res) => sendSuccess(res, await service.revokeEventShare(req.user._id, req.params.eventId, req.params.shareId)));
