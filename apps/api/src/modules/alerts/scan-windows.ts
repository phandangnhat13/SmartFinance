import { DateTime } from 'luxon';

/**
 * One month-shaped window used by the category-spike detector.
 *
 * Months are calendar months in the *user's* timezone: `start`/`endExclusive`
 * are the UTC instants that bound them, while `periodStart`/`periodEnd` are the
 * calendar dates stored in DATE columns. The current window ends at "now"; the
 * reference windows cover the same calendar days (1..today) of earlier months,
 * so a longer month cannot look like extra spending.
 */
export interface AlertScanWindow {
  /** 'YYYY-MM' in the user's timezone. */
  month: string;
  start: Date;
  endExclusive: Date;
  periodStart: Date;
  periodEnd: Date;
  days: number;
}

export interface AlertScanWindows {
  current: AlertScanWindow;
  /** Previous months, newest first. */
  references: AlertScanWindow[];
  historyStart: Date;
  candidateStart: Date;
  nowExclusive: Date;
}

export interface AlertScanWindowOptions {
  /** How far back transaction history is loaded (large-transaction baseline). */
  lookbackDays: number;
  /** How far back transactions are re-examined as large-transaction candidates. */
  candidateDays: number;
  /** Number of previous months compared by the category-spike detector. */
  referenceMonths: number;
}

function calendarDate(value: DateTime): Date {
  return new Date(Date.UTC(value.year, value.month - 1, value.day));
}

function buildWindow(monthStart: DateTime, days: number, endExclusive: DateTime): AlertScanWindow {
  const lastDay = monthStart.plus({ days: days - 1 });
  return {
    month: monthStart.toFormat('yyyy-MM'),
    start: monthStart.toUTC().toJSDate(),
    endExclusive: endExclusive.toUTC().toJSDate(),
    periodStart: calendarDate(monthStart),
    periodEnd: calendarDate(lastDay),
    days,
  };
}

/**
 * Builds every window one scan needs from a zoned "now".
 *
 * `now` must already be in the user's timezone; it is never converted here, so
 * DST and offset changes are handled by Luxon at the calendar level. A reference
 * month shorter than the current one (February vs. the 31st) is compared over
 * its own last day; the small mismatch in day count is documented rather than
 * silently padding with zero-spend days.
 */
export function buildScanWindows(now: DateTime, options: AlertScanWindowOptions): AlertScanWindows {
  if (!now.isValid) throw new Error(`Invalid scan time: ${now.invalidReason ?? 'unknown'}`);
  const monthStart = now.startOf('month');
  const currentDays = now.day;
  const current = buildWindow(monthStart, currentDays, now);

  const references: AlertScanWindow[] = [];
  for (let index = 1; index <= options.referenceMonths; index += 1) {
    const referenceStart = monthStart.minus({ months: index });
    const days = Math.min(currentDays, referenceStart.daysInMonth ?? currentDays);
    references.push(buildWindow(referenceStart, days, referenceStart.plus({ days })));
  }

  return {
    current,
    references,
    historyStart: now.minus({ days: options.lookbackDays }).toUTC().toJSDate(),
    candidateStart: now.minus({ days: options.candidateDays }).toUTC().toJSDate(),
    nowExclusive: now.toUTC().toJSDate(),
  };
}
