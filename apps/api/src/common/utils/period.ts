import { DateTime, IANAZone } from 'luxon';

export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_RANGE_DAYS = 731;

export interface DateRange {
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
}

export interface MonthPeriod {
  month: string;
  /** UTC midnight of the first calendar day, suitable for a PostgreSQL DATE column. */
  periodStart: Date;
  /** UTC midnight of the last calendar day, inclusive. */
  periodEnd: Date;
  /** UTC instant of local midnight at the start of the month. */
  start: Date;
  /** UTC instant of local midnight at the start of the following month. */
  endExclusive: Date;
}

export function isValidTimezone(timezone: string): boolean {
  return IANAZone.isValidZone(timezone);
}

export function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): DateRange {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  const now = DateTime.now().setZone(timezone);
  const defaultFrom = now.startOf('month').toISODate()!;
  const defaultTo = now.toISODate()!;
  const fromStr = from ?? defaultFrom;
  const toStr = to ?? defaultTo;

  assertDateOnly(fromStr, 'from');
  assertDateOnly(toStr, 'to');

  const startLocal = DateTime.fromISO(fromStr, { zone: timezone }).startOf('day');
  const endLocal = DateTime.fromISO(toStr, { zone: timezone }).startOf('day');
  if (endLocal < startLocal) {
    throw new Error('Ngày bắt đầu không được sau ngày kết thúc');
  }
  const days = endLocal.diff(startLocal, 'days').days + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Khoảng thời gian tối đa là ${MAX_RANGE_DAYS} ngày`);
  }

  return {
    from: fromStr,
    to: toStr,
    start: startLocal.toUTC().toJSDate(),
    endExclusive: endLocal.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

/**
 * Budget periods are month-scoped. A calendar month is defined in the user's
 * timezone; query boundaries are converted to UTC instants.
 */
export function resolveMonthPeriod(month: string | undefined, timezone: string): MonthPeriod {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  const now = DateTime.now().setZone(timezone);
  const monthStr = month ?? now.toFormat('yyyy-MM');
  if (!MONTH_REGEX.test(monthStr)) {
    throw new Error('Tháng phải có định dạng YYYY-MM');
  }
  const local = DateTime.fromFormat(monthStr, 'yyyy-MM', { zone: timezone });
  if (!local.isValid) {
    throw new Error('Tháng không hợp lệ');
  }
  const startLocal = local.startOf('month');
  const nextLocal = startLocal.plus({ months: 1 });
  const year = startLocal.year;
  const monthNumber = startLocal.month;

  return {
    month: monthStr,
    periodStart: new Date(Date.UTC(year, monthNumber - 1, 1)),
    periodEnd: new Date(Date.UTC(year, monthNumber - 1, startLocal.daysInMonth!)),
    start: startLocal.toUTC().toJSDate(),
    endExclusive: nextLocal.toUTC().toJSDate(),
  };
}

export function previousRange(range: DateRange, timezone: string): DateRange {
  const start = DateTime.fromISO(range.from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(range.to, { zone: timezone }).startOf('day');
  const days = Math.round(end.diff(start, 'days').days) + 1;
  const previousEnd = start.minus({ days: 1 });
  const previousStart = previousEnd.minus({ days: days - 1 });
  return {
    from: previousStart.toISODate()!,
    to: previousEnd.toISODate()!,
    start: previousStart.toUTC().toJSDate(),
    endExclusive: previousEnd.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

export function toMonthLabel(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('yyyy-MM');
}

export function assertDateOnly(value: string, field: string): void {
  if (!DATE_ONLY_REGEX.test(value)) {
    throw new Error(`${field} phải có định dạng YYYY-MM-DD`);
  }
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  if (!parsed.isValid || parsed.toISODate() !== value) {
    throw new Error(`${field} không phải ngày hợp lệ`);
  }
}
