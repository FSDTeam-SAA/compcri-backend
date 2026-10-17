import { agenda, enqueueJob } from './agenda.js';
import { expandEvent } from '../utils/eventOccurrences.js';
import { withEventTimeReminder } from '../utils/reminders.js';

export const scheduleEventReminders = async (event, { preserveDue = false } = {}) => {
  const now = new Date();
  const query = { name: 'send-event-reminder', data: { eventId: event._id.toString() } };
  const existing = preserveDue ? (await agenda.queryJobs(query)).jobs : [];
  const due = existing.filter((job) => job.lockedAt || (job.nextRunAt && new Date(job.nextRunAt) <= now));
  // Agenda 6 accepts typed options, not raw Mongo queries. A dotted eventId
  // filter was ignored, cancelling every event's reminders on each save.
  // Refresh only replaces future/completed jobs and preserves due/running ones.
  if (preserveDue) {
    const retainedIds = new Set(due.map((job) => job._id.toString()));
    const ids = existing.filter((job) => !retainedIds.has(job._id.toString())).map((job) => job._id.toString());
    if (ids.length) await agenda.cancel({ ids });
  } else {
    await agenda.cancel(query);
  }
  if (event.status !== 'ACTIVE') return;
  const retained = new Set(due.map((job) => `${job.data.occurrenceStartAt}/${job.data.minutes}`));
  const horizon = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const occurrences = event.recurrenceRrule
    ? expandEvent(event, now, new Date(horizon.getTime() + 1))
    : [{ occurrenceStartAt: event.startsAt, reminderMinutes: event.reminderMinutes }];
  for (const row of occurrences) {
    const occurrence = row.occurrenceStartAt;
    if (occurrence <= now || occurrence > horizon) continue;
    for (const minutes of withEventTimeReminder(row.reminderMinutes ?? [])) {
      const at = new Date(occurrence.getTime() - minutes * 60_000);
      if (retained.has(`${occurrence.toISOString()}/${minutes}`)) continue;
      if (at >= now) {
        await enqueueJob('send-event-reminder', { eventId: event._id.toString(), occurrenceStartAt: occurrence.toISOString(), minutes }, at);
      }
    }
  }
};
