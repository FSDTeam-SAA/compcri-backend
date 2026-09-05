import { agenda, enqueueJob } from './agenda.js';
import { recurrenceBetween } from '../utils/recurrence.js';

export const scheduleEventReminders = async (event) => {
  await agenda.cancel({ name: 'send-event-reminder', 'data.eventId': event._id.toString() });
  if (event.status !== 'ACTIVE' || !event.reminderMinutes?.length) return;
  const now = new Date();
  const horizon = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const recurrenceStarts = event.recurrenceRrule
    ? recurrenceBetween({ recurrenceRrule: event.recurrenceRrule, startsAt: event.startsAt, timeZone: event.timeZone, from: now, to: horizon })
    : [event.startsAt];
  const occurrences = recurrenceStarts.map((originalStartAt) => {
    const exception = event.recurrenceExceptions?.find((item) => item.originalStartAt.getTime() === originalStartAt.getTime());
    if (exception?.cancelled) return null;
    return exception?.overrides?.startsAt ? new Date(exception.overrides.startsAt) : originalStartAt;
  }).filter((occurrence) => occurrence && occurrence > now && occurrence <= horizon);
  for (const occurrence of occurrences) {
    for (const minutes of new Set(event.reminderMinutes)) {
      const at = new Date(occurrence.getTime() - minutes * 60_000);
      if (at > now) await enqueueJob('send-event-reminder', { eventId: event._id.toString(), occurrenceStartAt: occurrence.toISOString(), minutes }, at);
    }
  }
};
