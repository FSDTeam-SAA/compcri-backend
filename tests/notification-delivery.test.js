import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), devices: vi.fn(), send: vi.fn(), remove: vi.fn() }));
vi.mock('../models/User.js', () => ({ default: { findById: () => ({ select: mocks.user }) } }));
vi.mock('../models/Device.js', () => ({ default: { find: mocks.devices, deleteMany: mocks.remove } }));
vi.mock('../services/firebase.service.js', () => ({ sendMulticast: mocks.send }));
import { deliverPush } from '../services/notification.service.js';

describe('reminder notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.devices.mockResolvedValue([{ token: 'device-token' }]);
    mocks.send.mockResolvedValue({ responses: [{ success: true }] });
  });
  const notification = { _id: 'notification-id', userId: 'user-id', category: 'REMINDER', title: 'Medicine', body: 'Starts 12:10', data: { eventId: 'event-id' } };
  it.each([false, true])('delivers reminders with high priority when alarm sound is %s', async (alarmReminders) => {
    mocks.user.mockResolvedValue({ notificationPreferences: { pushEnabled: true, reminders: true, alarmReminders } });
    await deliverPush(notification);
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.android.priority).toBe('high');
    expect(payload.data).toMatchObject({ category: 'REMINDER', alarm: String(alarmReminders), notificationId: 'notification-id' });
    expect(payload.android.notification.channelId).toBe(alarmReminders ? 'aurox_alarms' : 'aurox_reminders_v2');
    // A reminder is never silent: the app's own sound, or the phone's alarm.
    expect(payload.apns.payload.aps.sound).toBe(alarmReminders ? 'default' : 'aurox_reminder.caf');
    expect(payload.android.notification.sound).toBe(alarmReminders ? 'default' : 'aurox_reminder');
    expect(payload.apns.payload.aps['interruption-level']).toBe(alarmReminders ? 'time-sensitive' : 'active');
  });
  it('keeps invitations and updates quiet', async () => {
    mocks.user.mockResolvedValue({ notificationPreferences: { pushEnabled: true, invitations: true, alarmReminders: true } });
    await deliverPush({ ...notification, category: 'INVITATION' });
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.android.notification.channelId).toBe('aurox_reminders_silent');
    expect(payload.apns.payload.aps.sound).toBeUndefined();
  });
  it.each([{ pushEnabled: false }, { reminders: false }])('respects the explicit opt-out %j', async (preferences) => {
    mocks.user.mockResolvedValue({ notificationPreferences: preferences });
    await deliverPush(notification);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('retries temporary failures only on devices that have not received the reminder', async () => {
    mocks.user.mockResolvedValue({ notificationPreferences: { pushEnabled: true, reminders: true } });
    mocks.devices.mockResolvedValue([{ token: 'delivered' }, { token: 'retry' }]);
    mocks.send.mockResolvedValue({ responses: [
      { success: true }, { success: false, error: { code: 'messaging/server-unavailable' } }
    ] });
    await expect(deliverPush(notification)).rejects.toMatchObject({ retryTokens: ['retry'] });
    mocks.devices.mockResolvedValue([{ token: 'retry' }]);
    mocks.send.mockResolvedValue({ responses: [{ success: true }] });
    await deliverPush(notification, ['retry']);
    expect(mocks.devices).toHaveBeenLastCalledWith({ userId: 'user-id', token: { $in: ['retry'] } });
    expect(mocks.send.mock.calls[1][0].tokens).toEqual(['retry']);
  });
  it('defaults missing preferences to enabled and removes invalid device tokens', async () => {
    mocks.user.mockResolvedValue({});
    mocks.send.mockResolvedValue({ responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] });
    await deliverPush(notification);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith({ token: { $in: ['device-token'] } });
  });
});
