import { DateTime } from 'luxon';
import rrulePackage from 'rrule';
import ApiError from './ApiError.js';

const { rrulestr } = rrulePackage;

const ruleBody = (value) => {
  const line = value.split(/\r?\n/).find((item) => item.toUpperCase().startsWith('RRULE:'));
  return line ? line.slice(6) : value;
};

const floatingDate = (date, zone) => {
  const local = DateTime.fromJSDate(date, { zone });
  return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond));
};

const zonedDate = (date, zone) => DateTime.fromObject({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  hour: date.getUTCHours(),
  minute: date.getUTCMinutes(),
  second: date.getUTCSeconds(),
  millisecond: date.getUTCMilliseconds()
}, { zone }).toUTC().toJSDate();

export const parseRecurrence = (recurrenceRrule, startsAt, timeZone = 'UTC') => {
  try {
    return rrulestr(ruleBody(recurrenceRrule), { dtstart: floatingDate(startsAt, timeZone) });
  } catch {
    throw new ApiError(422, 'Recurrence rule is invalid', 'INVALID_RECURRENCE_RULE');
  }
};

export const recurrenceBetween = ({ recurrenceRrule, startsAt, timeZone = 'UTC', from, to }) => {
  const rule = parseRecurrence(recurrenceRrule, startsAt, timeZone);
  return rule.between(floatingDate(from, timeZone), floatingDate(to, timeZone), true)
    .map((occurrence) => zonedDate(occurrence, timeZone))
    .filter((occurrence) => occurrence >= from && occurrence <= to);
};

export const assertValidRecurrence = (recurrenceRrule, startsAt, timeZone) => {
  if (recurrenceRrule) parseRecurrence(recurrenceRrule, startsAt, timeZone);
};
