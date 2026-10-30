import type { GoalStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type {
  GoalDto,
  GoalProgressDto,
  GoalProgressTimelinePointDto,
  SavingsProgressStatus,
  SavingsProgressSummaryDto,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { moneyString, percentage, toDecimal } from '../../common/utils/money';
import { monthsRemaining, requiredMonthlySaving } from '../goals/goal.mapper';

/**
 * Savings progress tracking (M2d), rule-based and pure.
 *
 * Three different ideas are kept apart on purpose:
 *  - actual progress   = the sum of recorded contributions,
 *  - expected progress = the straight-line plan from the start date to the
 *                        deadline (`target × elapsed / total`),
 *  - projected progress = the observed contribution pace carried forward.
 *
 * No LLM, no ML and no writes live here. The rules are documented in
 * `progressRules()` and returned by the API so the UI can explain them.
 */

/** A goal older than this is charted from its last 60 months to bound the payload. */
const MAX_TIMELINE_MONTHS = 60;

/**
 * Being up to one planned instalment behind the straight line is normal:
 * contributions are recorded in lumps (usually once a month), so mid-month the
 * straight line is always slightly ahead. More than one instalment behind is
 * treated as AT_RISK.
 */
const RISK_TOLERANCE_INSTALMENTS = 1;

const ZERO = new Prisma.Decimal(0);
const VI_NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export interface ProgressGoalInput {
  id: string;
  name: string;
  currency: string;
  status: GoalStatus;
  targetAmount: string;
  savedAmount: string;
  /** Calendar date YYYY-MM-DD in the owner's timezone. */
  startDate: string;
  targetDate: string | null;
  contributions: { amount: string; contributedAt: string }[];
}

export interface ProgressOptions {
  /** Today's calendar date in the owner's timezone, YYYY-MM-DD. */
  today: string;
  /** The owner's timezone, used to group contributions into local months. */
  timezone: string;
}

/** Adapts the M2b goal DTO (already validated and currency-labelled) for progress. */
export function toProgressInput(goal: GoalDto): ProgressGoalInput {
  return {
    id: goal.id,
    name: goal.name,
    currency: goal.currency,
    status: goal.status,
    targetAmount: goal.targetAmount,
    savedAmount: goal.savedAmount,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    contributions: goal.contributions.map((contribution) => ({
      amount: contribution.amount,
      contributedAt: contribution.contributedAt,
    })),
  };
}

function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Display-only formatting for explanation sentences; never used for arithmetic. */
function formatAmount(value: Prisma.Decimal | string, currency: string): string {
  return `${VI_NUMBER.format(toDecimal(value).toNumber())} ${currency}`;
}

function utc(value: string): DateTime {
  return DateTime.fromISO(value, { zone: 'utc' });
}

function daysBetween(from: string, to: string): number {
  return utc(to).diff(utc(from), 'days').days;
}

function monthsBetween(from: string, to: string): number {
  return utc(to).diff(utc(from), 'months').months;
}

/**
 * Straight-line expected amount on `onDate`, computed from the original plan.
 * Before the start it is zero and at/after the deadline it is the full target.
 */
export function expectedAmountAt(
  targetAmount: Prisma.Decimal,
  startDate: string,
  targetDate: string,
  onDate: string,
): Prisma.Decimal {
  const totalDays = daysBetween(startDate, targetDate);
  if (totalDays <= 0) return targetAmount;
  const elapsed = Math.min(Math.max(daysBetween(startDate, onDate), 0), totalDays);
  if (elapsed <= 0) return ZERO;
  if (elapsed >= totalDays) return targetAmount;
  return roundMoney(targetAmount.times(elapsed).dividedBy(totalDays));
}

/** One planned instalment, used as the tolerance before a goal is AT_RISK. */
function plannedInstalment(
  targetAmount: Prisma.Decimal,
  startDate: string,
  targetDate: string,
): Prisma.Decimal {
  const plannedMonths = Math.max(1, Math.ceil(monthsBetween(startDate, targetDate)));
  return targetAmount.dividedBy(plannedMonths);
}

function localMonth(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat('yyyy-MM');
}

function addMonths(date: string, months: number): string | null {
  const next = utc(date).plus({ months }).toISODate();
  return next;
}

/**
 * Cumulative actual versus expected, from the start month to the current
 * month. Actual values include every contribution recorded up to that month;
 * expected values come from the plan, never from the client.
 */
export function buildTimeline(
  input: ProgressGoalInput,
  options: ProgressOptions,
  effectiveTarget: Prisma.Decimal,
  effectiveTargetDate: string | null,
): GoalProgressTimelinePointDto[] {
  const currentMonth = DateTime.fromISO(options.today, { zone: options.timezone }).toFormat(
    'yyyy-MM',
  );
  const startMonth = DateTime.fromISO(input.startDate, { zone: 'utc' }).toFormat('yyyy-MM');
  let firstMonth = startMonth > currentMonth ? currentMonth : startMonth;
  let count = Math.floor(monthsBetween(`${firstMonth}-01`, `${currentMonth}-01`)) + 1;
  if (count > MAX_TIMELINE_MONTHS) {
    firstMonth = DateTime.fromFormat(currentMonth, 'yyyy-MM', { zone: 'utc' })
      .minus({ months: MAX_TIMELINE_MONTHS - 1 })
      .toFormat('yyyy-MM');
    count = MAX_TIMELINE_MONTHS;
  }
  if (!Number.isFinite(count) || count < 1) return [];

  const byMonth = new Map<string, Prisma.Decimal>();
  let opening = ZERO;
  input.contributions.forEach((contribution) => {
    const month = localMonth(contribution.contributedAt, options.timezone);
    if (month < firstMonth) {
      opening = opening.plus(toDecimal(contribution.amount));
      return;
    }
    byMonth.set(month, (byMonth.get(month) ?? ZERO).plus(toDecimal(contribution.amount)));
  });

  const points: GoalProgressTimelinePointDto[] = [];
  let running = opening;
  let cursor = DateTime.fromFormat(firstMonth, 'yyyy-MM', { zone: 'utc' });
  for (let index = 0; index < count; index += 1) {
    const month = cursor.toFormat('yyyy-MM');
    running = running.plus(byMonth.get(month) ?? ZERO);
    const monthEnd = cursor.endOf('month').toISODate() ?? options.today;
    const at = monthEnd < options.today ? monthEnd : options.today;
    const expected =
      effectiveTargetDate === null
        ? ZERO
        : expectedAmountAt(effectiveTarget, input.startDate, effectiveTargetDate, at);
    points.push({
      month,
      actualSaved: moneyString(running),
      expectedSaved: moneyString(expected),
    });
    cursor = cursor.plus({ months: 1 });
  }
  return points;
}

function statusReason(
  status: SavingsProgressStatus,
  input: ProgressGoalInput,
  expected: Prisma.Decimal | null,
  remaining: Prisma.Decimal,
  today: string,
): string {
  const currency = input.currency;
  switch (status) {
    case 'COMPLETED':
      return 'Mục tiêu đã được góp đủ số tiền mục tiêu.';
    case 'PAUSED':
      return 'Mục tiêu đang tạm dừng nên không so sánh với tiến độ kỳ vọng.';
    case 'OVERDUE':
      return `Đã quá hạn từ ${input.targetDate} và vẫn còn thiếu ${formatAmount(
        remaining,
        currency,
      )}.`;
    case 'INSUFFICIENT_DATA':
      return input.status === 'ARCHIVED'
        ? 'Mục tiêu đã lưu trữ nên không còn theo dõi tiến độ.'
        : 'Chưa đặt ngày đích nên không xác định được tiến độ kỳ vọng.';
    case 'ON_TRACK':
      return `Đúng tiến độ: đã tiết kiệm ${formatAmount(
        input.savedAmount,
        currency,
      )}, kỳ vọng ${formatAmount(expected ?? ZERO, currency)} tính đến ${today}.`;
    case 'AT_RISK':
      return `Chậm hơn kế hoạch: đã tiết kiệm ${formatAmount(
        input.savedAmount,
        currency,
      )}, kỳ vọng ${formatAmount(expected ?? ZERO, currency)} tính đến ${today}.`;
  }
}

/**
 * Progress for one goal. The caller passes the plan it wants measured, so a
 * preview can reuse this exact function with a hypothetical target or deadline
 * and a simulation can never drift from the tracked numbers.
 */
export function buildGoalProgress(
  input: ProgressGoalInput,
  options: ProgressOptions,
): GoalProgressDto {
  const target = toDecimal(input.targetAmount);
  const saved = toDecimal(input.savedAmount);
  const remaining = Prisma.Decimal.max(target.minus(saved), ZERO);
  const targetDate = input.targetDate;
  const months = monthsRemaining(options.today, targetDate);
  const required = requiredMonthlySaving(input.status, remaining, months);

  const expected =
    targetDate === null
      ? null
      : expectedAmountAt(target, input.startDate, targetDate, options.today);
  const tolerance =
    targetDate === null ? null : plannedInstalment(target, input.startDate, targetDate);

  // Actual vs expected only exists when there is a timeline to compare against.
  const actualVsExpected = expected === null ? null : saved.minus(expected);
  const atRisk =
    expected === null || tolerance === null
      ? null
      : expected.minus(saved).greaterThan(tolerance.times(RISK_TOLERANCE_INSTALMENTS));
  const aheadOfSchedule = actualVsExpected === null ? null : actualVsExpected.greaterThan(0);

  const monthsObserved = Math.max(1, Math.ceil(monthsBetween(input.startDate, options.today)));
  const hasContributions = input.contributions.length > 0 && saved.greaterThan(0);
  const average = hasContributions ? roundMoney(saved.dividedBy(monthsObserved)) : null;
  let monthsToComplete: number | null = null;
  if (remaining.lessThanOrEqualTo(0)) monthsToComplete = 0;
  else if (average !== null && average.greaterThan(0)) {
    monthsToComplete = Math.ceil(remaining.dividedBy(average).toNumber());
  }
  const estimatedCompletionDate =
    monthsToComplete === null
      ? null
      : monthsToComplete === 0
        ? options.today
        : addMonths(options.today, monthsToComplete);
  const projectedHitsDeadline =
    targetDate !== null && estimatedCompletionDate !== null
      ? estimatedCompletionDate <= targetDate
      : null;
  const projectedAmountAtDeadline =
    average !== null && targetDate !== null && months !== null && months > 0
      ? moneyString(Prisma.Decimal.min(saved.plus(average.times(months)), target))
      : null;

  // Deterministic precedence: a completed goal is completed, a paused goal is
  // paused, then a passed deadline makes an unfinished goal overdue, then the
  // actual/expected comparison applies. Without a deadline there is nothing to
  // compare against, so the goal is INSUFFICIENT_DATA instead of a guess.
  let progressStatus: SavingsProgressStatus;
  if (input.status === 'COMPLETED' || remaining.lessThanOrEqualTo(0)) progressStatus = 'COMPLETED';
  else if (input.status === 'PAUSED') progressStatus = 'PAUSED';
  else if (input.status === 'ARCHIVED') progressStatus = 'INSUFFICIENT_DATA';
  else if (targetDate !== null && targetDate < options.today) progressStatus = 'OVERDUE';
  else if (targetDate === null || atRisk === null) progressStatus = 'INSUFFICIENT_DATA';
  else progressStatus = atRisk ? 'AT_RISK' : 'ON_TRACK';

  const lastContributionAt =
    input.contributions.length === 0
      ? null
      : input.contributions
          .map((contribution) => contribution.contributedAt)
          .reduce((latest, current) => (current > latest ? current : latest));

  return {
    goalId: input.id,
    name: input.name,
    currency: input.currency,
    status: input.status,
    displayStatus:
      input.status === 'ACTIVE' && targetDate !== null && targetDate < options.today
        ? 'OVERDUE'
        : input.status,
    targetAmount: moneyString(target),
    savedAmount: moneyString(saved),
    remainingAmount: moneyString(remaining),
    completionPercentage: percentage(saved, target),
    startDate: input.startDate,
    targetDate,
    monthsRemaining: months,
    requiredMonthlySaving: required,
    expectedAmount: expected === null ? null : moneyString(expected),
    expectedPercentage: expected === null ? null : percentage(expected, target),
    actualVsExpected: actualVsExpected === null ? null : moneyString(actualVsExpected),
    atRisk,
    aheadOfSchedule,
    pace: {
      monthsObserved,
      averageMonthlyContribution: average === null ? null : moneyString(average),
      monthsToComplete,
      estimatedCompletionDate,
      projectedAmountAtDeadline,
      projectedHitsDeadline,
    },
    progressStatus,
    statusReason: statusReason(progressStatus, input, expected, remaining, options.today),
    lastContributionAt,
    timeline: buildTimeline(input, options, target, targetDate),
  };
}

/** The statuses counted in the dashboard, keyed by the DTO field they fill. */
function countStatus(goals: GoalProgressDto[], status: SavingsProgressStatus): number {
  return goals.filter((goal) => goal.progressStatus === status).length;
}

/**
 * Per-currency dashboard totals. Archived goals never reach this function, so
 * nothing archived is summed into a user-facing total.
 */
export function summarizeProgress(
  goals: GoalProgressDto[],
  currency: string,
): SavingsProgressSummaryDto {
  const totals = goals.reduce(
    (acc, goal) => ({
      target: acc.target.plus(toDecimal(goal.targetAmount)),
      saved: acc.saved.plus(toDecimal(goal.savedAmount)),
      remaining: acc.remaining.plus(toDecimal(goal.remainingAmount)),
    }),
    { target: ZERO, saved: ZERO, remaining: ZERO },
  );

  return {
    currency,
    activeGoals: goals.filter((goal) => goal.status === 'ACTIVE').length,
    onTrack: countStatus(goals, 'ON_TRACK'),
    atRisk: countStatus(goals, 'AT_RISK'),
    overdue: countStatus(goals, 'OVERDUE'),
    completed: countStatus(goals, 'COMPLETED'),
    paused: countStatus(goals, 'PAUSED'),
    insufficientData: countStatus(goals, 'INSUFFICIENT_DATA'),
    totalTargetAmount: moneyString(totals.target),
    totalSavedAmount: moneyString(totals.saved),
    totalRemainingAmount: moneyString(totals.remaining),
    overallPercentage: percentage(totals.saved, totals.target),
  };
}

export function progressRules(): string[] {
  return [
    'Tiến độ thực tế = tổng các khoản góp đã ghi nhận cho mục tiêu (không ước lượng).',
    'Tiến độ kỳ vọng tại một ngày = số tiền mục tiêu × (số ngày đã trôi qua / tổng số ngày từ ngày bắt đầu đến ngày đích).',
    'Đúng tiến độ khi số tiền thực tế không thấp hơn kỳ vọng quá một lần góp theo kế hoạch; vượt quá mức đó là chậm tiến độ.',
    'Một lần góp theo kế hoạch = số tiền mục tiêu / số tháng của kế hoạch ban đầu, vì các khoản góp thường được ghi theo tháng.',
    'Quá hạn khi mục tiêu còn đang thực hiện, đã qua ngày đích và chưa góp đủ; mục tiêu tạm dừng hoặc hoàn thành được ưu tiên phân loại trước.',
    'Mục tiêu không có ngày đích không có tiến độ kỳ vọng nên được xếp vào nhóm chưa đủ dữ liệu, thay vì đoán.',
    'Tiến độ dự kiến dùng tốc độ góp thực tế = tổng đã góp / số tháng kể từ ngày bắt đầu, và chỉ là dự báo.',
  ];
}

export function progressLimitations(currency: string): string[] {
  return [
    `Mọi số tiền trong phản hồi đều tính cho ${currency}; số tiền khác tiền tệ không được cộng hoặc quy đổi.`,
    'Không lưu lại lịch sử thay đổi mục tiêu: tiến độ kỳ vọng luôn dùng số tiền và ngày đích hiện tại.',
    'Tốc độ góp trung bình chia đều cho số tháng kể từ ngày bắt đầu, nên góp muộn hoặc góp cách quãng sẽ cho dự báo thận trọng.',
    'Mục tiêu đã lưu trữ không được tính vào tổng quan và không có tiến độ kỳ vọng.',
    'Các khoản góp trong tháng hiện tại vẫn được tính vào tiến độ thực tế, nhưng tháng đó chưa kết thúc.',
  ];
}
