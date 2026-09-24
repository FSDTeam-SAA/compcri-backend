import mongoose from 'mongoose';
import { LOCALES, PLANS, USER_ROLES, USER_STATUSES } from '../constants/enums.js';
import { env } from '../config/env.js';

const notificationPreferencesSchema = new mongoose.Schema({
  pushEnabled: { type: Boolean, default: true },
  reminders: { type: Boolean, default: true },
  invitations: { type: Boolean, default: true },
  groupUpdates: { type: Boolean, default: true },
  contactRequests: { type: Boolean, default: true },
  subscriptionUpdates: { type: Boolean, default: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, select: false },
  googleSubject: { type: String, sparse: true, unique: true, index: true },
  appleSubject: { type: String, sparse: true, unique: true, index: true },
  role: { type: String, enum: USER_ROLES, default: 'USER', index: true },
  status: { type: String, enum: USER_STATUSES, default: 'ACTIVE', index: true },
  displayName: { type: String, trim: true, maxlength: 100 },
  firstName: { type: String, trim: true, maxlength: 60 },
  lastName: { type: String, trim: true, maxlength: 60 },
  phone: { type: String, trim: true, maxlength: 40 },
  profession: { type: String, trim: true, maxlength: 120 },
  country: { type: String, trim: true, maxlength: 80 },
  city: { type: String, trim: true, maxlength: 80 },
  locale: { type: String, enum: LOCALES, default: 'en' },
  interests: [{ type: String, trim: true, maxlength: 50 }],
  aiPersonalizationConsent: { type: Boolean, default: false },
  avatarMediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
  contactCode: { type: String, required: true, unique: true, index: true },
  revenueCatAppUserId: { type: String, required: true, unique: true, index: true },
  plan: { type: String, enum: PLANS, default: 'FREE', index: true },
  premiumUntil: Date,
  notificationPreferences: { type: notificationPreferencesSchema, default: () => ({}) },
  lastLoginAt: Date,
  passwordChangedAt: Date
}, { timestamps: true });

userSchema.methods.toJSON = function toJSON() {
  const value = this.toObject();
  if (!env.PAYWALL_ENABLED && value.role === 'USER') {
    value.plan = 'PREMIUM';
    value.premiumUntil = null;
  }
  delete value.passwordHash;
  delete value.__v;
  return value;
};

export default mongoose.model('User', userSchema);
