import mongoose from 'mongoose';
import { EVENT_SHARE_PERMISSIONS, RSVP_STATUSES } from '../constants/enums.js';

const eventShareSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  sharedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['USER', 'GROUP'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  permission: { type: String, enum: EVENT_SHARE_PERMISSIONS, required: true },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' }
}, { timestamps: true });

eventShareSchema.index({ eventId: 1, targetType: 1, targetId: 1 }, { unique: true });

const eventResponseSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: RSVP_STATUSES, default: 'PENDING' },
  respondedAt: Date
}, { timestamps: true });
eventResponseSchema.index({ eventId: 1, userId: 1 }, { unique: true });

export const EventShare = mongoose.model('EventShare', eventShareSchema);
export const EventResponse = mongoose.model('EventResponse', eventResponseSchema);

