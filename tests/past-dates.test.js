import { describe, expect, it } from 'vitest';
import { isPastDate } from '../utils/pastDates.js';

describe('view-only calendar dates', () => {
  it('leaves the whole current date open, including an earlier time', () => {
    const now = new Date('2026-10-06T12:12:00Z');
    expect(isPastDate('2026-10-06T00:00:00Z', 'UTC', now)).toBe(false);
    expect(isPastDate('2026-10-05T23:59:00Z', 'UTC', now)).toBe(true);
    expect(isPastDate('2026-10-07T00:00:00Z', 'UTC', now)).toBe(false);
  });
  it('uses the calendar timezone across midnight', () => {
    const now = new Date('2026-10-06T02:00:00Z');
    expect(isPastDate('2026-10-05T08:00:00Z', 'America/Los_Angeles', now)).toBe(false);
    expect(isPastDate('2026-10-05T23:00:00Z', 'Asia/Dhaka', now)).toBe(false);
    expect(isPastDate('2026-10-05T17:59:00Z', 'Asia/Dhaka', now)).toBe(true);
  });
});
