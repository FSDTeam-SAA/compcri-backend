// An advance reminder supplements the event-time notification. Only an
// explicit empty list disables reminders for the event.
export const withEventTimeReminder = (minutes = [0]) =>
  minutes.length ? [...new Set([0, ...minutes])] : [];
