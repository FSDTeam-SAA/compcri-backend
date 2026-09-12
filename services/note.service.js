import { StatusCodes } from 'http-status-codes';
import Note from '../models/Note.js';
import ApiError from '../utils/ApiError.js';
import { escapeRegex } from '../utils/regex.js';
import { getCalendarAccess, getEventAccess } from './calendarAccess.service.js';
import { transcribeAudio } from './ai/audio.js';

const MAX_DERIVED_TITLE = 70;

/// Notes are personal: a delegate's access to a calendar never exposes the
/// owner's notes, so every query is scoped to the requesting user.
const ownedFilter = (userId, extra = {}) => ({ userId, deletedAt: null, ...extra });

const notFound = () => new ApiError(StatusCodes.NOT_FOUND, 'Note not found', 'NOTE_NOT_FOUND');

/// First sentence (or first line) of the body, used when the caller — a voice
/// capture or the assistant — did not supply a title of its own.
export const deriveTitle = (body) => {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return 'Note';
  const sentence = flat.split(/(?<=[.!?])\s/, 1)[0];
  const candidate = sentence.length <= MAX_DERIVED_TITLE ? sentence : flat.slice(0, MAX_DERIVED_TITLE);
  return candidate.length < flat.length && !/[.!?]$/.test(candidate)
    ? `${candidate.trimEnd()}…`
    : candidate;
};

/// Confirms the note may reference [eventId] before it is stored.
const assertEventVisible = async (userId, eventId) => {
  if (!eventId) return undefined;
  const access = await getEventAccess(userId, eventId);
  return access.event._id;
};

export const listNotes = async (userId, { search, eventId, pinned, skip = 0, limit = 20 } = {}) => {
  const filter = ownedFilter(userId, {
    ...(eventId && { eventId }),
    ...(pinned !== undefined && { pinned })
  });
  if (search) {
    const pattern = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ title: pattern }, { body: pattern }, { tags: pattern }];
  }
  const [items, total] = await Promise.all([
    Note.find(filter).sort({ pinned: -1, updatedAt: -1 }).skip(skip).limit(limit),
    Note.countDocuments(filter)
  ]);
  return { items, total };
};

export const getNote = async (userId, noteId) => {
  const note = await Note.findOne(ownedFilter(userId, { _id: noteId }));
  if (!note) throw notFound();
  return note;
};

export const createNote = async (userId, calendarId, payload) => {
  await getCalendarAccess(userId, calendarId);
  const eventId = await assertEventVisible(userId, payload.eventId);
  const body = payload.body.trim();
  return Note.create({
    userId,
    calendarId,
    title: payload.title?.trim() || deriveTitle(body),
    body,
    source: payload.source || 'TEXT',
    eventId,
    pinned: payload.pinned ?? false,
    tags: payload.tags || [],
    ...(payload.voice && { voice: payload.voice })
  });
};

export const updateNote = async (userId, noteId, changes) => {
  const note = await getNote(userId, noteId);
  if (changes.eventId !== undefined) {
    note.eventId = changes.eventId === null
      ? undefined
      : await assertEventVisible(userId, changes.eventId);
  }
  if (changes.body !== undefined) note.body = changes.body.trim();
  if (changes.title !== undefined) {
    note.title = changes.title?.trim() || deriveTitle(note.body);
  }
  if (changes.pinned !== undefined) note.pinned = changes.pinned;
  if (changes.tags !== undefined) note.tags = changes.tags;
  await note.save();
  return note;
};

export const deleteNote = async (userId, noteId) => {
  const note = await Note.findOneAndUpdate(
    ownedFilter(userId, { _id: noteId }),
    { $set: { deletedAt: new Date() } }
  );
  if (!note) throw notFound();
  return { deleted: true };
};

/// Records a spoken note: the audio is transcribed and discarded, only the
/// text and its duration are kept.
export const createVoiceNote = async (userId, calendarId, file, payload = {}) => {
  const transcription = await transcribeAudio(file);
  const note = await createNote(userId, calendarId, {
    ...payload,
    body: transcription.text,
    source: 'VOICE',
    voice: {
      model: transcription.model,
      ...(transcription.durationSeconds !== undefined && { durationSeconds: transcription.durationSeconds }),
      ...(transcription.languages?.length && { languages: transcription.languages })
    }
  });
  return { note, transcription };
};

/// Compact projection handed to the assistant's `search_notes` tool.
export const searchNotesForAi = async (userId, { search, limit = 10 } = {}) => {
  const { items } = await listNotes(userId, { search, limit });
  return items.map((note) => ({
    id: note._id.toString(),
    title: note.title,
    body: note.body.length > 500 ? `${note.body.slice(0, 500)}…` : note.body,
    source: note.source,
    pinned: note.pinned,
    tags: note.tags,
    eventId: note.eventId?.toString(),
    updatedAt: note.updatedAt.toISOString()
  }));
};
