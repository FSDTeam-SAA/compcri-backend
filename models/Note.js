import mongoose from 'mongoose';
import { NOTE_SOURCES } from '../constants/enums.js';

const noteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true, index: true },
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, required: true, maxlength: 20000 },
  source: { type: String, enum: NOTE_SOURCES, default: 'TEXT' },
  /// Set when the note was captured about a specific event.
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', index: true },
  pinned: { type: Boolean, default: false },
  tags: { type: [String], default: [] },
  /// Transcription metadata, present only on voice notes.
  voice: {
    durationSeconds: Number,
    model: String,
    languages: [String]
  },
  deletedAt: Date
}, { timestamps: true });

noteSchema.index({ userId: 1, deletedAt: 1, pinned: -1, updatedAt: -1 });
export default mongoose.model('Note', noteSchema);
