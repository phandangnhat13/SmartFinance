import { DateTime } from 'luxon';
import {
  DATE_ONLY_REGEX,
  isValidTimezone,
  MONTH_REGEX,
  previousRange,
  resolveDateRange,
  resolveMonthPeriod,
} from '../../common/utils/period';

export const QUARTER_REGEX = /^\d{4}-Q[1-4]$/;
export const YEAR_REGEX = /^\d{4}$/;

export type AnalyticsPeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export class InvalidPeriodError extends Error {}

export interface ResolvedPeriodRange {
  kind: AnalyticsPeriodKind;
  label: string;
  /** First local calendar day, YYYY-MM-DD (inclusive). */
  from: string;
  /** Last local calendar day, YYYY-MM-DD (inclusive). */
  to: string;
  /** UTC instant of local midnight at the start of `from`. */
  start: Date;
  /** UTC instant of local midnight after `to`. */
  endExclusive: Date;
}

export interface ResolvedPeriod {
  current: ResolvedPeriodRange;
  previous: ResolvedPeriodRange;
}

export interface AnalyticsPeriodInput {
  period?: AnalyticsPeriodKind;
  month?: string;
  quarter?: string;
  year?: string;
  from?: string;
  to?: string;
}

/**
 * Resolves the requested calendar period and the immediately preceding period
 * of the same kind. Month/quarter/year periods use calendar boundaries (so QoQ
 * and YoY compare like with like); a custom range compares against the range of
 * the same length that ends the day before it starts.
 */
export function resolveAnalyticsPeriod(
  input: AnalyticsPeriodInput,
  timezone: string,
): ResolvedPeriod {
  if (!isValidTimezone(timezone)) {
    throw new InvalidPeriodError('Múi giờ không hợp lệ');
  }
  const now = DateTime.now().setZone(timezone);
  const kind = input.period ?? 'month';

  switch (kind) {
    case 'month':
      return resolveMonth(input.month, timezone, now);
    case 'quarter':
      return resolveQuarter(input.quarter, timezone, now);
    case 'year':
      return resolveYear(input.year, timezone, now);
    case 'custom':
      return resolveCustom(input.from, input.to, timezone, now);
    default:
      throw new InvalidPeriodError('period phải là month, quarter, year hoặc custom');
  }
}

function resolveMonth(
  requested: string | undefined,
  timezone: string,
  now: DateTime,
): ResolvedPeriod {
  const month = requested ?? now.toFormat('yyyy-MM');
  if (!MONTH_REGEX.test(month)) {
    throw new InvalidPeriodError('month phải có định dạng YYYY-MM');
  }
  if (month > now.toFormat('yyyy-MM')) {
    throw new InvalidPeriodError('Không thể phân tích tháng trong tương lai');
  }

  const local = DateTime.fromFormat(month, 'yyyy-MM', { zone: timezone });
  const current = resolveMonthPeriod(month, timezone);
  const previousLocal = local.minus({ months: 1 });
  const previous = resolveMonthPeriod(previousLocal.toFormat('yyyy-MM'), timezone);

  return {
    current: monthRange('month', month, current.start, current.endExclusive, timezone),
    previous: monthRange(
      'month',
      previousLocal.toFormat('yyyy-MM'),
      previous.start,
      previous.endExclusive,
      timezone,
    ),
  };
}

function resolveQuarter(
  requested: string | undefined,
  timezone: string,
  now: DateTime,
): ResolvedPeriod {
  const quarter = requested ?? `${now.year}-Q${now.quarter}`;
  if (!QUARTER_REGEX.test(quarter)) {
    throw new InvalidPeriodError('quarter phải có định dạng YYYY-Q1..Q4');
  }

  const [yearText, quarterText] = quarter.split('-Q');
  const year = Number(yearText);
  const quarterNumber = Number(quarterText);
  const startLocal = DateTime.fromObject(
    { year, month: (quarterNumber - 1) * 3 + 1 },
    { zone: timezone },
  ).startOf('month');

  if (!startLocal.isValid) {
    throw new InvalidPeriodError('Quý không hợp lệ');
  }
  if (startLocal > now.startOf('quarter')) {
    throw new InvalidPeriodError('Không thể phân tích quý trong tương lai');
  }

  const previousStart = startLocal.minus({ months: 3 });
  const previousQuarter = Math.floor(previousStart.month / 3) + 1;
  return {
    current: rangeFromLocal('quarter', quarter, startLocal, startLocal.plus({ months: 3 })),
    previous: rangeFromLocal(
      'quarter',
      `${previousStart.year}-Q${previousQuarter}`,
      previousStart.startOf('month'),
      previousStart.startOf('month').plus({ months: 3 }),
    ),
  };
}

function resolveYear(
  requested: string | undefined,
  timezone: string,
  now: DateTime,
): ResolvedPeriod {
  const yearText = requested ?? String(now.year);
  if (!YEAR_REGEX.test(yearText)) {
    throw new InvalidPeriodError('year phải có định dạng YYYY');
  }
  const year = Number(yearText);
  if (year > now.year) {
    throw new InvalidPeriodError('Không thể phân tích năm trong tương lai');
  }

  const startLocal = DateTime.fromObject({ year, month: 1 }, { zone: timezone }).startOf('month');
  if (!startLocal.isValid) {
    throw new InvalidPeriodError('Năm không hợp lệ');
  }

  return {
    current: rangeFromLocal('year', String(year), startLocal, startLocal.plus({ years: 1 })),
    previous: rangeFromLocal('year', String(year - 1), startLocal.minus({ years: 1 }), startLocal),
  };
}

function resolveCustom(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
  now: DateTime,
): ResolvedPeriod {
  if (!from || !to) {
    throw new InvalidPeriodError('Khoảng tuỳ chọn cần cả from và to');
  }
  if (!DATE_ONLY_REGEX.test(from) || !DATE_ONLY_REGEX.test(to)) {
    throw new InvalidPeriodError('from và to phải có định dạng YYYY-MM-DD');
  }

  let range;
  try {
    range = resolveDateRange(from, to, timezone);
  } catch (error) {
    throw new InvalidPeriodError(
      error instanceof Error ? error.message : 'Khoảng thời gian không hợp lệ',
    );
  }

  const startLocal = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  if (startLocal > now) {
    throw new InvalidPeriodError('Khoảng thời gian chưa bắt đầu');
  }

  const previous = previousRange(range, timezone);
  return {
    current: {
      kind: 'custom',
      label: `${from} → ${to}`,
      from,
      to,
      start: range.start,
      endExclusive: range.endExclusive,
    },
    previous: {
      kind: 'custom',
      label: `${previous.from} → ${previous.to}`,
      from: previous.from,
      to: previous.to,
      start: previous.start,
      endExclusive: previous.endExclusive,
    },
  };
}

/** Converts UTC month boundaries back to a local-calendar range descriptor. */
function monthRange(
  kind: AnalyticsPeriodKind,
  label: string,
  start: Date,
  endExclusive: Date,
  timezone: string,
): ResolvedPeriodRange {
  const startLocal = DateTime.fromJSDate(start).setZone(timezone);
  return {
    kind,
    label,
    from: startLocal.toISODate()!,
    to: DateTime.fromJSDate(endExclusive).setZone(timezone).minus({ days: 1 }).toISODate()!,
    start,
    endExclusive,
  };
}

function rangeFromLocal(
  kind: AnalyticsPeriodKind,
  label: string,
  startLocal: DateTime,
  endExclusiveLocal: DateTime,
): ResolvedPeriodRange {
  return {
    kind,
    label,
    from: startLocal.toISODate()!,
    to: endExclusiveLocal.minus({ days: 1 }).toISODate()!,
    start: startLocal.toUTC().toJSDate(),
    endExclusive: endExclusiveLocal.toUTC().toJSDate(),
  };
}
