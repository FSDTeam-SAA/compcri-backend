import { DateTime } from 'luxon';

/// Times crossing the model boundary, in both directions.
///
/// The models run with little or no reasoning, so every conversion they are
/// asked to do in their head is a chance to get the day wrong. Coming in, a
/// time without an offset is read in the calendar's zone, so "09:05" means
/// 09:05 there. Going out, every time is already the calendar's wall clock
/// with its offset, so there is nothing left to convert.

const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export const toInstant = (value, zone) => {
  const parsed = HAS_OFFSET.test(value)
    ? DateTime.fromISO(value, { setZone: true })
    : DateTime.fromISO(value, { zone });
  return parsed.isValid ? parsed.toJSDate() : null;
};

const local = (date, zone) => DateTime.fromJSDate(new Date(date), { zone });

export const localIso = (date, zone) => local(date, zone).toISO({ suppressMilliseconds: true });

/// The clock time in the user's format: "15:00", or "3:00 PM" with [hour12].
/// Written out here so the model repeats it instead of converting it — left
/// to convert, it produces things like "15 PM".
const clockTime = (value, hour12) => value.setLocale('en-US').toFormat(hour12 ? 'h:mm a' : 'HH:mm');

/// "Thu 2 Oct 2026, 09:00" — unambiguous, and easy for a model to repeat.
export const localLabel = (date, zone, hour12 = false) => {
  const value = local(date, zone);
  return `${value.setLocale('en-US').toFormat('ccc d LLL yyyy')}, ${clockTime(value, hour12)}`;
};

/// "Thu 2 Oct 2026, 09:00–10:00", or both dates when it crosses midnight.
export const localRange = (startsAt, endsAt, zone, hour12 = false) => {
  const start = local(startsAt, zone);
  const end = local(endsAt, zone);
  return start.hasSame(end, 'day')
    ? `${localLabel(startsAt, zone, hour12)}–${clockTime(end, hour12)}`
    : `${localLabel(startsAt, zone, hour12)} – ${localLabel(endsAt, zone, hour12)}`;
};

export const localSpan = (startsAt, endsAt, zone, hour12 = false) => ({
  start: localIso(startsAt, zone),
  end: localIso(endsAt, zone),
  when: localRange(startsAt, endsAt, zone, hour12)
});

/// Today, tomorrow and the offset in the calendar's zone, so "today at 9"
/// and "tomorrow" resolve against the user's date rather than UTC's.
export const calendarClock = (zone, now = new Date(), hour12 = false) => {
  const today = local(now, zone);
  return {
    now: `${today.setLocale('en-US').toFormat('cccc d LLLL yyyy')}, ${clockTime(today, hour12)}`,
    today: today.toISODate(),
    tomorrow: today.plus({ days: 1 }).toISODate(),
    offset: today.toFormat('ZZ')
  };
};
