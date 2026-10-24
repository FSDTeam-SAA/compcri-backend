import mongoose from 'mongoose';

const CLIENT_PLATFORMS = ['IOS', 'ANDROID', 'UNKNOWN'];

/// One row per copy of the app, keyed by an id the app generates on its first
/// launch and keeps for as long as it stays installed. A first launch is the
/// closest the API can see to a download; store download totals live in App
/// Store Connect and the Play Console.
const appInstallSchema = new mongoose.Schema({
  installId: { type: String, required: true, unique: true },
  platform: { type: String, enum: CLIENT_PLATFORMS, default: 'UNKNOWN', index: true },
  appVersion: { type: String, maxlength: 40 },
  osVersion: { type: String, maxlength: 80 },
  locale: { type: String, maxlength: 20 },
  // The last account signed in on this copy, linked once it makes an
  // authenticated request.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  firstOpenedAt: { type: Date, required: true, index: true },
  lastOpenedAt: { type: Date, required: true, index: true },
  opens: { type: Number, default: 0 },
  // Installed before the app reported launches, so first seen on an update
  // rather than on a download. Counted as active, never as a new install.
  preexisting: Boolean
}, { timestamps: true });

/// One row per user per UTC day they used the app. `activeWindows` counts the
/// five-minute windows in which the account made at least one request, so it
/// approximates time spent without logging every call.
const userActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: Date, required: true, index: true },
  platform: { type: String, enum: CLIENT_PLATFORMS, default: 'UNKNOWN' },
  appVersion: { type: String, maxlength: 40 },
  activeWindows: { type: Number, default: 0 },
  firstSeenAt: Date,
  lastSeenAt: Date
});
userActivitySchema.index({ userId: 1, day: 1 }, { unique: true });

export const AppInstall = mongoose.model('AppInstall', appInstallSchema);
export const UserActivity = mongoose.model('UserActivity', userActivitySchema);
