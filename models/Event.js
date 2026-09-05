import mongoose from 'mongoose';

const recurrenceExceptionSchema = new mongoose.Schema({
  originalStartAt: { type: Date, required: true },
  cancelled: { type: Boolean, default: false },
  overrides: mongoose.Schema.Types.Mixed
}, { _id: false });

const eventSchema = new mongoose.Schema({
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true, index: true },
  createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 5000 },
  posterMediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
  location: { type: String, trim: true, maxlength: 300 },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  timeZone: { type: String, required: true, default: 'UTC' },
  reminderMinutes: [{ type: Number, min: 0, max: 525600 }],
  recurrenceRrule: { type: String, maxlength: 2000 },
  recurrenceExceptions: [recurrenceExceptionSchema],
  status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE', index: true },
  completedAt: Date,
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },
  audit: [{
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: String,
    at: { type: Date, default: Date.now },
    changes: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true, optimisticConcurrency: true });

eventSchema.index({ calendarId: 1, status: 1, startsAt: 1, endsAt: 1 });
eventSchema.index({ groupId: 1, status: 1, startsAt: 1 });
export default mongoose.model('Event', eventSchema);

