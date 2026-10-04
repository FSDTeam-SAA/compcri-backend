import { agenda, enqueueJob } from './agenda.js';
import { expandEvent } from '../utils/eventOccurrences.js';
import { withEventTimeReminder } from '../utils/reminders.js';

export const scheduleEventReminders = async (event) => {
  await agenda.cancel({ name: 'send-event-reminder', 'data.eventId': event._id.toString() });
  if (event.status !== 'ACTIVE') return;
  const now = new Date();
  const horizon = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const occurrences = event.recurrenceRrule
    ? expandEvent(event, now, new Date(horizon.getTime() + 1))
    : [{ occurrenceStartAt: event.startsAt, reminderMinutes: event.reminderMinutes }];
  for (const row of occurrences) {
    const occurrence = row.occurrenceStartAt;
    if (occurrence <= now || occurrence > horizon) continue;
    for (const minutes of withEventTimeReminder(row.reminderMinutes ?? [])) {
      const at = new Date(occurrence.getTime() - minutes * 60_000);
      if (at >= now) {
        await enqueueJob('send-event-reminder', { eventId: event._id.toString(), occurrenceStartAt: occurrence.toISOString(), minutes }, at);
      }
    }
  }
};
