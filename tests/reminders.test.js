import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({ cancel: vi.fn(), enqueue: vi.fn() }));
vi.mock('../jobs/agenda.js', () => ({ agenda: { cancel: queue.cancel }, enqueueJob: queue.enqueue }));
import { scheduleEventReminders } from '../jobs/reminders.js';

describe('event reminder scheduling', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-10-03T12:00:00Z'));
  });
  const event = (changes = {}) => ({
    _id: 'event-id', status: 'ACTIVE', startsAt: new Date('2030-10-03T12:10:00Z'),
    timeZone: 'UTC', reminderMinutes: [5], ...changes
  });
  it('schedules five-minute reminders at the same time for either creation flow', async () => {
    await scheduleEventReminders(event());
    expect(queue.cancel).toHaveBeenCalledWith({ name: 'send-event-reminder', 'data.eventId': 'event-id' });
    expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith('send-event-reminder', {
      eventId: 'event-id', occurrenceStartAt: '2030-10-03T12:10:00.000Z', minutes: 5
    }, new Date('2030-10-03T12:05:00Z'));
  });
  it('cancels old reminders when disabled or the event is cancelled', async () => {
    await scheduleEventReminders(event({ reminderMinutes: [] }));
    await scheduleEventReminders(event({ status: 'CANCELLED' }));
    expect(queue.cancel).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
  it('reschedules moved recurring occurrences and skips cancellations', async () => {
    await scheduleEventReminders(event({ recurrenceRrule: 'FREQ=DAILY;COUNT=3', recurrenceExceptions: [
      { originalStartAt: new Date('2030-10-04T12:10:00Z'), cancelled: true },
      { originalStartAt: new Date('2030-10-05T12:10:00Z'), overrides: { startsAt: '2030-10-05T13:10:00Z' } }
    ] }));
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue.mock.calls[1][2]).toEqual(new Date('2030-10-05T13:05:00Z'));
  });
});
