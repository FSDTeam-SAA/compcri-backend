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

export const deliverPush = async (notification) => {
  const user = await User.findById(notification.userId).select('notificationPreferences');
  if (!user?.notificationPreferences?.pushEnabled) return;
  const key = preferenceKey[notification.category];
  if (key && user.notificationPreferences[key] === false) return;
  const devices = await Device.find({ userId: notification.userId });
  if (!devices.length) return;
  // A reminder someone asked to be alarmed by rings on its own channel and
  // interrupts a Focus; everything else arrives the quiet way.
  const urgent = notification.category === 'REMINDER'
    && user.notificationPreferences.alarmReminders === true;
  const response = await sendMulticast({
    tokens: devices.map((item) => item.token),
    notification: { title: notification.title, body: notification.body },
    data: Object.fromEntries(Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)])),
    android: {
      priority: urgent ? 'high' : 'normal',
      notification: {
        channelId: urgent ? 'aurox_alarms' : 'aurox_reminders',
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
  if (!response) return;
  const invalidTokens = response.responses
    .map((item, index) => ({ item, token: devices[index].token }))
    .filter(({ item }) => !item.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(item.error?.code))
    .map(({ token }) => token);
  if (invalidTokens.length) await Device.deleteMany({ token: { $in: invalidTokens } });
};

/// Stores and pushes a notification in the recipient's language. [title] and
/// [body] are English message keys (user content, such as an event title,
/// passes through as is); [args] fill their `{placeholders}`, and a function
/// argument receives the locale for values like dates.
export const createNotification = async (userId, category, title, body, data = {}, args = {}) => {
  const recipient = await User.findById(userId).select('locale');
  const locale = recipient?.locale || 'en';
  const notification = await Notification.create({
    userId,
    category,
    title: translate(locale, title, args),
    body: translate(locale, body, args),
    data
  });
  import('../jobs/agenda.js')
    .then(({ enqueueJob }) => enqueueJob('deliver-notification', { notificationId: notification._id.toString() }))
    .catch(() => undefined);
  return notification;
};
