import { describe, expect, it } from 'vitest';
import { calendarMonthRange, currentMonthRange, inputToIso, isoToInput } from './date';

describe('datetime-local conversion', () => {
  it('interprets wall-clock input in the user timezone', () => {
    expect(inputToIso('2026-10-15T10:30', 'Asia/Ho_Chi_Minh')).toBe('2026-10-15T03:30:00.000Z');
    expect(inputToIso('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z');
  });

  it('round-trips an instant back to the same local input', () => {
    const iso = '2026-10-15T03:30:00.000Z';
    expect(isoToInput(iso, 'Asia/Ho_Chi_Minh')).toBe('2026-10-15T10:30');
  });

  it('handles DST offsets on both sides of the transition', () => {
    expect(isoToInput('2026-01-15T17:00:00.000Z', 'America/New_York')).toBe('2026-01-15T12:00');
    expect(isoToInput('2026-07-15T16:00:00.000Z', 'America/New_York')).toBe('2026-07-15T12:00');
  });
});

describe('currentMonthRange', () => {
  it('returns the calendar month and its last day in the user timezone', () => {
    const range = currentMonthRange('Asia/Ho_Chi_Minh');
    expect(range.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(range.month).toBe(range.from.slice(0, 7));
    const [year, month] = range.month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
    expect(range.to).toBe(`${range.month}-${String(lastDay).padStart(2, '0')}`);
  });
});

describe('calendarMonthRange', () => {
  it('returns the first and last calendar day of a month', () => {
    expect(calendarMonthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(calendarMonthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('falls back to the current UTC month for a malformed value', () => {
    const range = calendarMonthRange('2026-13');
    expect(range.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
