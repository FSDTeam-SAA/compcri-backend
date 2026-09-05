import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['IOS', 'ANDROID'], required: true },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Device', deviceSchema);

