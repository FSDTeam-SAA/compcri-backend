import Notification from '../models/Notification.js';
import { translate } from '../utils/i18n.js';
import Device from '../models/Device.js';
import User from '../models/User.js';
import { sendMulticast } from './firebase.service.js';

const preferenceKey = {
  REMINDER: 'reminders',
  INVITATION: 'invitations',
  GROUP_UPDATE: 'groupUpdates',
  CONTACT_REQUEST: 'contactRequests',
  SECURITY: null,
  SUBSCRIPTION: 'subscriptionUpdates'
};

export const deliverPush = async (notification, retryTokens) => {
  const user = await User.findById(notification.userId).select('notificationPreferences');
  if (!user || user.notificationPreferences?.pushEnabled === false) return;
  const key = preferenceKey[notification.category];
  if (key && user.notificationPreferences?.[key] === false) return;
  const devices = await Device.find({ userId: notification.userId, ...(retryTokens && { token: { $in: retryTokens } }) });
  if (!devices.length) return;
  // A reminder someone asked to be alarmed by rings on its own channel and
  // interrupts a Focus; everything else arrives the quiet way.
  const urgent = notification.category === 'REMINDER'
    && user.notificationPreferences?.alarmReminders === true;
  const response = await sendMulticast({
    tokens: devices.map((item) => item.token),
    notification: { title: notification.title, body: notification.body },
    data: {
      ...Object.fromEntries(Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)])),
      category: notification.category,
      notificationId: notification._id.toString(),
      alarm: String(urgent)
    },
    android: {
      priority: notification.category === 'REMINDER' ? 'high' : 'normal',
      notification: {
        channelId: urgent ? 'aurox_alarms' : 'aurox_reminders_silent',
        ...(urgent && { sound: 'default', defaultVibrateTimings: true })
      }
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          sound: urgent ? 'default' : undefined,
          // 'time-sensitive' breaks through a Focus; it needs the matching
          // capability on the App ID, which the shipped profile carries.
          'interruption-level': urgent ? 'time-sensitive' : 'active'
        }
      }
    }
  });
  if (!response) throw new Error('Push delivery is unavailable');
  const invalidTokens = response.responses
    .map((item, index) => ({ item, token: devices[index].token }))
    .filter(({ item }) => !item.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(item.error?.code))
    .map(({ token }) => token);
  if (invalidTokens.length) await Device.deleteMany({ token: { $in: invalidTokens } });
  const failedTokens = response.responses
    .flatMap((item, index) => !item.success && !invalidTokens.includes(devices[index].token) ? [devices[index].token] : []);
  if (failedTokens.length) {
    const error = new Error('Push delivery failed for one or more devices');
    // The worker retries only the failed devices so successful ones do not
    // receive the same reminder again.
    error.retryTokens = failedTokens;
    throw error;
  }
};

/// Stores and pushes a notification in the recipient's language. [title] and
/// [body] are English message keys (user content, such as an event title,
/// passes through as is); [args] fill their `{placeholders}`, and a function
/// argument receives the locale for values like dates.
export const createNotification = async (userId, category, title, body, data = {}, args = {}) => {
  const recipient = await User.findById(userId).select('locale timeFormat deviceUses24Hour notificationPreferences');
  if (category === 'REMINDER' && recipient?.notificationPreferences?.reminders === false) return null;
  const locale = recipient?.locale || 'en';
  // A function argument is rendered per recipient, so each one reads dates
  // and times in their own language and clock format.
  args = Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    typeof value === 'function' ? value(locale, recipient) : value
  ]));
  const notification = await Notification.create({
    userId,
    category,
    title: translate(locale, title, args).slice(0, 160),
    body: translate(locale, body, args),
    data
  });
  const { enqueueJob } = await import('../jobs/agenda.js');
  await enqueueJob('deliver-notification', { notificationId: notification._id.toString() });
  return notification;
};
