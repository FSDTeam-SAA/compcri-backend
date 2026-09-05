import mongoose from 'mongoose';

const availabilitySchema = new mongoose.Schema({
  workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
  workdayStart: { type: String, default: '09:00' },
  workdayEnd: { type: String, default: '17:00' }
}, { _id: false });

const calendarSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  name: { type: String, default: 'My Calendar', maxlength: 100 },
  timeZone: { type: String, default: 'UTC' },
  availability: { type: availabilitySchema, default: () => ({}) }
}, { timestamps: true });

export default mongoose.model('Calendar', calendarSchema);

