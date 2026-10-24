import ApiError from './ApiError.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/// Midnight UTC of [date]'s day.
export const utcDay = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const isoDay = (date) => date.toISOString().slice(0, 10);

/// The report window from `from`/`to` (YYYY-MM-DD, both inclusive, UTC),
/// defaulting to the last 30 days. Spans over three months are charted by
/// month rather than by day.
export const resolveRange = ({ from, to } = {}) => {
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(utcDay(end).getTime() - 29 * DAY_MS);
  if (Number.isNaN(+start) || Number.isNaN(+end) || start > end) {
    throw new ApiError(422, 'The start date must be on or before the end date', 'INVALID_DATE_RANGE');
  }
  const days = Math.ceil((end - start) / DAY_MS);
  return { start, end, unit: days > 92 ? 'month' : 'day' };
};

/// Aggregation expression naming the chart bucket [field] falls in.
export const bucketOf = (field, unit) => ({
  $dateToString: { format: unit === 'month' ? '%Y-%m' : '%Y-%m-%d', date: field, timezone: 'UTC' }
});
