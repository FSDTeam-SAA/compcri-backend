import { StatusCodes } from 'http-status-codes';
import * as noteService from '../services/note.service.js';
import catchAsync from '../utils/catchAsync.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { sendSuccess } from '../utils/response.js';

export const list = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { items, total } = await noteService.listNotes(req.user._id, {
    search: req.query.search,
    eventId: req.query.eventId,
    pinned: req.query.pinned,
    skip,
    limit
  });
  sendSuccess(res, items, { meta: paginationMeta(page, limit, total) });
});

export const get = catchAsync(async (req, res) => {
  sendSuccess(res, await noteService.getNote(req.user._id, req.params.id));
});

export const create = catchAsync(async (req, res) => {
  const { calendarId, ...payload } = req.body;
  const note = await noteService.createNote(req.user._id, calendarId, payload);
  sendSuccess(res, note, { status: StatusCodes.CREATED });
});

export const update = catchAsync(async (req, res) => {
  sendSuccess(res, await noteService.updateNote(req.user._id, req.params.id, req.body));
});

export const remove = catchAsync(async (req, res) => {
  sendSuccess(res, await noteService.deleteNote(req.user._id, req.params.id));
});

export const createFromVoice = catchAsync(async (req, res) => {
  const { calendarId, ...payload } = req.body;
  const { note, transcription } = await noteService.createVoiceNote(req.user._id, calendarId, req.file, payload);
  sendSuccess(res, { note, transcription }, { status: StatusCodes.CREATED });
});
