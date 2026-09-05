import mongoose from 'mongoose';
import { NOTIFICATION_CATEGORIES } from '../constants/enums.js';

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true, index: true },
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, required: true, maxlength: 1000 },
  data: mongoose.Schema.Types.Mixed,
  readAt: Date,
  deletedAt: Date
}, { timestamps: true });

notificationSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 });
export default mongoose.model('Notification', notificationSchema);

