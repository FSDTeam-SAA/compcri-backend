import { DateTime } from 'luxon';
import ApiError from './ApiError.js';

export const isPastDate = (value, zone, now = new Date()) =>
  DateTime.fromJSDate(new Date(value), { zone }).startOf('day') <
  DateTime.fromJSDate(now, { zone }).startOf('day');

export const assertEditableDate = (value, zone) => {
  if (isPastDate(value, zone)) {
    throw new ApiError(422, 'Past dates are view-only. Choose today or a future date.', 'PAST_DATE_LOCKED');
  }
};
