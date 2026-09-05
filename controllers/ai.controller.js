import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import * as service from '../services/ai.service.js';

export const createConversation = catchAsync(async (req, res) => sendSuccess(res, await service.createConversation(req.user._id, req.body.calendarId, req.body.title), { status: 201 }));
export const listConversations = catchAsync(async (req, res) => sendSuccess(res, await service.listConversations(req.user._id, req.query.search)));
export const getConversation = catchAsync(async (req, res) => sendSuccess(res, await service.getConversation(req.user._id, req.params.id)));
export const deleteConversation = catchAsync(async (req, res) => { await service.deleteConversation(req.user._id, req.params.id); sendSuccess(res, { deleted: true }); });
export const sendMessage = catchAsync(async (req, res) => sendSuccess(res, await service.sendMessage(req.user._id, req.params.id, req.body.content)));
export const sendVoiceMessage = catchAsync(async (req, res) => sendSuccess(
  res,
  await service.sendVoiceMessage(req.user._id, req.params.id, req.file, req.body.voice)
));
export const editMessage = catchAsync(async (req, res) => sendSuccess(res, await service.editMessage(req.user._id, req.params.id, req.params.messageId, req.body.content)));
export const deleteMessage = catchAsync(async (req, res) => { await service.deleteMessage(req.user._id, req.params.id, req.params.messageId); sendSuccess(res, { deleted: true }); });
export const quota = catchAsync(async (req, res) => sendSuccess(res, await service.quotaStatus(req.user._id, req.query.calendarId)));
export const confirmAction = catchAsync(async (req, res) => sendSuccess(res, await service.confirmAction(req.user._id, req.params.id, req.body.overrideConflicts)));
export const rejectAction = catchAsync(async (req, res) => sendSuccess(res, await service.rejectAction(req.user._id, req.params.id)));
