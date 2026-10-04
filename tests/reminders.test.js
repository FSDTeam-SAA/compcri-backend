import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({ cancel: vi.fn(), enqueue: vi.fn() }));
vi.mock('../jobs/agenda.js', () => ({ agenda: { cancel: queue.cancel }, enqueueJob: queue.enqueue }));
import { scheduleEventReminders } from '../jobs/reminders.js';
import { withEventTimeReminder } from '../utils/reminders.js';

describe('event reminder scheduling', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-10-03T12:00:00Z'));
  });
  const event = (changes = {}) => ({
    _id: 'event-id', status: 'ACTIVE', startsAt: new Date('2030-10-03T12:10:00Z'), endsAt: new Date('2030-10-03T13:10:00Z'),
    timeZone: 'UTC', reminderMinutes: [5], ...changes
  });
  const job = (minutes, start = '2030-10-03T12:10:00.000Z') => ({
    eventId: 'event-id', occurrenceStartAt: start, minutes
  });
  it('always schedules event time, with an additional five-minute advance reminder', async () => {
    await scheduleEventReminders(event());
    expect(queue.cancel).toHaveBeenCalledWith({ name: 'send-event-reminder', 'data.eventId': 'event-id' });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(0), new Date('2030-10-03T12:10:00Z'));
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(5), new Date('2030-10-03T12:05:00Z'));
  });
  it.each([[10], [5], [5, 10, 30]].map((reminderMinutes) => ({ reminderMinutes })))('keeps an event-time notification for a two-minute event with $reminderMinutes lead time', async ({ reminderMinutes }) => {
    await scheduleEventReminders(event({ startsAt: new Date('2030-10-03T12:02:00Z'), reminderMinutes }));
    expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith('send-event-reminder',
      job(0, '2030-10-03T12:02:00.000Z'), new Date('2030-10-03T12:02:00Z'));
  });
  it('keeps valid advance reminders and skips only those whose time has passed', async () => {
    await scheduleEventReminders(event({ startsAt: new Date('2030-10-03T12:02:00Z'), reminderMinutes: [10, 1] }));
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(0, '2030-10-03T12:02:00.000Z'), new Date('2030-10-03T12:02:00Z'));
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(1, '2030-10-03T12:02:00.000Z'), new Date('2030-10-03T12:01:00Z'));
  });
  it('keeps an advance reminder whose time is exactly now', async () => {
    await scheduleEventReminders(event({ reminderMinutes: [10] }));
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(10), new Date('2030-10-03T12:00:00Z'));
  });
  it('deduplicates event-time and advance reminder jobs', async () => {
    await scheduleEventReminders(event({ reminderMinutes: [0, 0, 5, 5] }));
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });
  it('does not remind about past events, opted-out events, or cancelled events', async () => {
    await scheduleEventReminders(event({ startsAt: new Date('2030-10-03T11:59:00Z') }));
    await scheduleEventReminders(event({ startsAt: new Date('2030-10-03T12:02:00Z'), reminderMinutes: [] }));
    await scheduleEventReminders(event({ status: 'CANCELLED' }));
    expect(queue.cancel).toHaveBeenCalledTimes(3);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
  it('schedules event time and advance reminders for moved recurring occurrences, and skips cancellations', async () => {
    await scheduleEventReminders(event({ recurrenceRrule: 'FREQ=DAILY;COUNT=3', recurrenceExceptions: [
      { originalStartAt: new Date('2030-10-04T12:10:00Z'), cancelled: true },
      { originalStartAt: new Date('2030-10-05T12:10:00Z'), overrides: { startsAt: '2030-10-05T13:10:00Z' } }
    ] }));
    expect(queue.enqueue).toHaveBeenCalledTimes(4);
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(0, '2030-10-05T13:10:00.000Z'), new Date('2030-10-05T13:10:00Z'));
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(5, '2030-10-05T13:10:00.000Z'), new Date('2030-10-05T13:05:00Z'));
  });
  it('reminds about a past recurrence slot moved into the future', async () => {
    await scheduleEventReminders(event({
      startsAt: new Date('2030-10-02T09:00:00Z'), endsAt: new Date('2030-10-02T10:00:00Z'),
      recurrenceRrule: 'FREQ=DAILY;COUNT=2', reminderMinutes: [0],
      recurrenceExceptions: [{
        originalStartAt: new Date('2030-10-03T09:00:00Z'),
        overrides: { startsAt: '2030-10-03T13:30:00Z', endsAt: '2030-10-03T14:30:00Z' }
      }]
    }));
    expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith('send-event-reminder',
      job(0, '2030-10-03T13:30:00.000Z'), new Date('2030-10-03T13:30:00Z'));
  });

  it('uses each occurrence reminder choice without changing the rest of the series', async () => {
    await scheduleEventReminders(event({
      recurrenceRrule: 'FREQ=DAILY;COUNT=3', reminderMinutes: [0],
      recurrenceExceptions: [
        { originalStartAt: new Date('2030-10-04T12:10:00Z'), overrides: { reminderMinutes: [0, 15] } },
        { originalStartAt: new Date('2030-10-05T12:10:00Z'), overrides: { reminderMinutes: [] } }
      ]
    }));
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(0), new Date('2030-10-03T12:10:00Z'));
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(0, '2030-10-04T12:10:00.000Z'), new Date('2030-10-04T12:10:00Z'));
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(15, '2030-10-04T12:10:00.000Z'), new Date('2030-10-04T11:55:00Z'));
  });

  it('enables a single occurrence reminder even when the series has reminders off', async () => {
    await scheduleEventReminders(event({
      recurrenceRrule: 'FREQ=DAILY;COUNT=3', reminderMinutes: [],
      recurrenceExceptions: [{ originalStartAt: new Date('2030-10-04T12:10:00Z'), overrides: { reminderMinutes: [0, 60] } }]
    }));
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith('send-event-reminder', job(60, '2030-10-04T12:10:00.000Z'), new Date('2030-10-04T11:10:00Z'));
  });
  it('defaults to event time and preserves only explicit opt-outs', () => {
    expect(withEventTimeReminder()).toEqual([0]);
    expect(withEventTimeReminder([10])).toEqual([0, 10]);
    expect(withEventTimeReminder([10, 0, 10])).toEqual([0, 10]);
    expect(withEventTimeReminder([])).toEqual([]);
  });
});
