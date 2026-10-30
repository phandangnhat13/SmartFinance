import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type {
  BudgetAnalyticsStatus,
  BudgetExhaustionProjection,
} from '@smart-finance/shared-types';
import { moneyString, toDecimal } from '../../common/utils/money';

/**
 * Pure budget classification and pace rules (M3b).
 *
 * All arithmetic here is deterministic and documented so the API, tests and UI
 * agree on one definition:
 *
 * - `totalDays` is the inclusive number of calendar days in the budget period.
 * - `daysElapsed` counts today when the period is active (day 1 on the start
 *   date), is 0 before the start and `totalDays` after the last day.
 * - `expectedSpend` is a linear allowance: limit × daysElapsed ÷ totalDays.
 *   It is null before the period starts.
 * - `pacePercent` is spent ÷ expectedSpend × 100, null when there is no
 *   allowance to compare against.
 * - Exhaustion is a simple linear extrapolation of the average daily spend. If
 *   there is no spend yet, or the projection lands after the period ends, no
 *   date is returned — only the reason.
 */

export type BudgetTimeState = 'not_started' | 'active' | 'ended';

export interface BudgetTimeframe {
  /** Date-only strings in the user's timezone (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  today: string;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  state: BudgetTimeState;
}

export interface BudgetPaceResult {
  dailySpendingAverage: string | null;
  expectedSpend: string | null;
  variance: string | null;
  pacePercent: number | null;
  estimatedExhaustionDate: string | null;
  exhaustionProjection: BudgetExhaustionProjection;
}

function dateOnly(value: string): DateTime {
  return DateTime.fromISO(value, { zone: 'utc' }).startOf('day');
}

export function resolveBudgetTimeframe(
  startDate: string,
  endDate: string,
  today: string,
): BudgetTimeframe {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  const current = dateOnly(today);

  // Defensive: a malformed stored period collapses to one day instead of
  // producing negative day counts.
  const totalDays = Math.max(1, Math.round(end.diff(start, 'days').days) + 1);

  let daysElapsed: number;
  if (current < start) daysElapsed = 0;
  else if (current >= end) daysElapsed = totalDays;
  else daysElapsed = Math.round(current.diff(start, 'days').days) + 1;

  const state: BudgetTimeState =
    current < start ? 'not_started' : current > end ? 'ended' : 'active';

  return {
    startDate,
    endDate,
    today,
    totalDays,
    daysElapsed,
    daysRemaining: totalDays - daysElapsed,
    state,
  };
}

/** Lowest configured warning threshold strictly below 100, or null. */
export function lowestWarningThreshold(thresholds: number[]): number | null {
  const relevant = thresholds.filter((value) => Number.isFinite(value) && value > 0 && value < 100);
  return relevant.length === 0 ? null : Math.min(...relevant);
}

export function classifyBudgetStatus(input: {
  limit: Prisma.Decimal | string;
  spent: Prisma.Decimal | string;
  warningThresholds: number[];
  state: BudgetTimeState;
}): BudgetAnalyticsStatus {
  const limit = toDecimal(input.limit);
  const spent = toDecimal(input.spent);

  if (input.state === 'not_started') return 'NOT_STARTED';

  if (limit.lessThanOrEqualTo(0)) {
    // The DTO refuses a zero limit, but historical rows are still readable.
    if (spent.greaterThan(0)) return 'EXCEEDED';
    return input.state === 'ended' ? 'COMPLETED' : 'ON_TRACK';
  }

  const usage = Number(spent.dividedBy(limit).times(100).toFixed(2));
  if (usage >= 100) return 'EXCEEDED';
  if (input.state === 'ended') return 'COMPLETED';

  const threshold = lowestWarningThreshold(input.warningThresholds);
  if (threshold !== null && usage >= threshold) return 'WARNING';
  return 'ON_TRACK';
}

export function buildBudgetPace(input: {
  limit: Prisma.Decimal | string;
  spent: Prisma.Decimal | string;
  timeframe: BudgetTimeframe;
}): BudgetPaceResult {
  const limit = toDecimal(input.limit);
  const spent = toDecimal(input.spent);
  const { daysElapsed, totalDays, today, endDate, state } = input.timeframe;

  if (state === 'not_started' || daysElapsed === 0) {
    return {
      dailySpendingAverage: null,
      expectedSpend: null,
      variance: null,
      pacePercent: null,
      estimatedExhaustionDate: null,
      exhaustionProjection: 'not_started',
    };
  }

  const expected = limit.times(daysElapsed).dividedBy(totalDays);
  const dailyAverage = spent.dividedBy(daysElapsed);
  const variance = spent.minus(expected);
  const pacePercent = expected.lessThanOrEqualTo(0)
    ? null
    : Number(spent.dividedBy(expected).times(100).toFixed(2));

  const exceeded = limit.greaterThan(0) ? spent.greaterThanOrEqualTo(limit) : spent.greaterThan(0);

  let estimatedExhaustionDate: string | null = null;
  let exhaustionProjection: BudgetExhaustionProjection;

  if (exceeded) {
    exhaustionProjection = 'already_exceeded';
  } else if (state === 'ended') {
    // A finished period cannot be exhausted any more; the final status already
    // says whether it stayed within the limit.
    exhaustionProjection = 'period_ended';
  } else if (dailyAverage.lessThanOrEqualTo(0)) {
    exhaustionProjection = 'no_spending';
  } else {
    const remaining = limit.minus(spent);
    // Remaining money ÷ average daily spend, rounded up to whole days.
    const daysToExhaust = Math.ceil(Number(remaining.dividedBy(dailyAverage)));
    const projected = dateOnly(today).plus({ days: daysToExhaust });
    const projectedISO = projected.toISODate();
    if (projectedISO === null || projectedISO > endDate) {
      exhaustionProjection = 'beyond_period';
    } else {
      exhaustionProjection = 'within_period';
      estimatedExhaustionDate = projectedISO;
    }
  }

  return {
    dailySpendingAverage: moneyString(dailyAverage),
    expectedSpend: moneyString(expected),
    variance: moneyString(variance),
    pacePercent,
    estimatedExhaustionDate,
    exhaustionProjection,
  };
}
