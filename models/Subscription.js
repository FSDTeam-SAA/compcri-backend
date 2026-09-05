import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  appUserId: { type: String, required: true, unique: true, index: true },
  entitlementId: String,
  productId: String,
  platform: { type: String, enum: ['APP_STORE', 'PLAY_STORE', 'UNKNOWN'], default: 'UNKNOWN' },
  status: { type: String, enum: ['FREE', 'TRIAL', 'ACTIVE', 'GRACE', 'CANCELLED', 'EXPIRED'], default: 'FREE', index: true },
  willRenew: { type: Boolean, default: false },
  purchasedAt: Date,
  expiresAt: Date,
  managementUrl: String,
  lastSyncedAt: Date
}, { timestamps: true });

const revenueCatEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  appUserId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  productId: String,
  platform: String,
  priceMinor: Number,
  currency: String,
  eventAt: Date,
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  processedAt: Date,
  processingError: String
}, { timestamps: true });

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
export const RevenueCatEvent = mongoose.model('RevenueCatEvent', revenueCatEventSchema);

