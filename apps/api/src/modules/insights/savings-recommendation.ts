import type {
  GoalDisplayStatus,
  GoalFeasibility,
  SavingsCapacityDto,
  SavingsRecommendationItemDto,
} from '@smart-finance/shared-types';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { moneyString, toDecimal } from '../../common/utils/money';

/**
 * Rule-based savings capacity and goal allocation (M2c). No LLM, no ML and no
 * database writes live here: every function is pure so the rules can be tested
 * on their own and the same numbers can be explained to the user.
 */

/** Only completed calendar months are averaged, and never more than this many. */
export const MAX_ANALYSIS_MONTHS = 6;

/**
 * A share of the average positive cash flow is kept unallocated as a safety
 * buffer for unexpected costs. The suggested capacity is therefore
 * `average net cash flow × (1 - 20%)`, never the whole surplus.
 */
export const SAFETY_BUFFER_PERCENT = 20;

const ALLOCATABLE_RATE = new Prisma.Decimal(100 - SAFETY_BUFFER_PERCENT).dividedBy(100);
const ZERO = new Prisma.Decimal(0);
const VI_NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** Display-only formatting for explanation sentences; never used for arithmetic. */
function formatAmount(value: Prisma.Decimal, currency: string): string {
  return `${VI_NUMBER.format(value.toNumber())} ${currency}`;
}

function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** One completed month with recorded activity, as returned by the insights series. */
export interface MonthTotals {
  month: string;
  income: string;
  expense: string;
  hasTransactions: boolean;
}

/**
 * Capacity from the last completed months that actually had transactions.
 *
 * Months without any transaction are never averaged as a zero-spend month: a
 * missing month says nothing about the user's cash flow. Months where the
 * user recorded only one side of the ledger do count for both averages, because
 * the absence of the other side is a measured zero for that month.
 */
export function computeCapacity(months: MonthTotals[], currency: string): SavingsCapacityDto {
  const analyzed = months.filter((month) => month.hasTransactions);
  const base: SavingsCapacityDto = {
    status: 'insufficient_data',
    reason: 'no_complete_months',
    currency,
    monthsAnalyzed: analyzed.length,
    analyzedMonths: analyzed.map((month) => month.month),
    averageMonthlyIncome: null,
    averageMonthlyExpense: null,
    averageNetCashFlow: null,
    historicalSavingsRate: null,
    safetyBufferPercent: SAFETY_BUFFER_PERCENT,
    safetyBufferAmount: null,
    suggestedMonthlySaving: null,
    isPositive: false,
    confidence: 'low',
  };
  if (analyzed.length === 0) return base;

  const count = new Prisma.Decimal(analyzed.length);
  const incomeSum = analyzed.reduce((sum, month) => sum.plus(toDecimal(month.income)), ZERO);
  const expenseSum = analyzed.reduce((sum, month) => sum.plus(toDecimal(month.expense)), ZERO);

  // Without recorded income there is no basis for a capacity: spending alone
  // says nothing about how much the user can set aside.
  if (incomeSum.lessThanOrEqualTo(0)) {
    return { ...base, reason: 'no_income' };
  }

  const income = roundMoney(incomeSum.dividedBy(count));
  const expense = roundMoney(expenseSum.dividedBy(count));
  const net = income.minus(expense);
  const savingsRate = income.greaterThan(0)
    ? Number(net.dividedBy(income).times(100).toFixed(2))
    : null;
  const confidence = analyzed.length >= 3 ? 'high' : analyzed.length === 2 ? 'medium' : 'low';

  if (net.lessThanOrEqualTo(0)) {
    return {
      ...base,
      status: 'no_capacity',
      reason: null,
      monthsAnalyzed: analyzed.length,
      averageMonthlyIncome: moneyString(income),
      averageMonthlyExpense: moneyString(expense),
      averageNetCashFlow: moneyString(net),
      historicalSavingsRate: savingsRate,
      safetyBufferAmount: moneyString(0),
      suggestedMonthlySaving: moneyString(0),
      confidence,
    };
  }

  // Rounded down so the suggestion can never exceed the measured surplus.
  const suggested = net.times(ALLOCATABLE_RATE).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

  return {
    status: 'available',
    reason: null,
    currency,
    monthsAnalyzed: analyzed.length,
    analyzedMonths: analyzed.map((month) => month.month),
    averageMonthlyIncome: moneyString(income),
    averageMonthlyExpense: moneyString(expense),
    averageNetCashFlow: moneyString(net),
    historicalSavingsRate: savingsRate,
    safetyBufferPercent: SAFETY_BUFFER_PERCENT,
    safetyBufferAmount: moneyString(net.minus(suggested)),
    suggestedMonthlySaving: moneyString(suggested),
    isPositive: true,
    confidence,
  };
}

/** The minimal goal shape the allocator needs; built from the goal DTO. */
export interface RecommendationGoalInput {
  id: string;
  name: string;
  currency: string;
  displayStatus: GoalDisplayStatus;
  targetDate: string | null;
  monthsRemaining: number | null;
  remaining: Prisma.Decimal;
  requiredMonthly: Prisma.Decimal | null;
  createdAt: Date;
}

export interface AllocationOptions {
  /** Monthly amount to distribute; null when the data cannot support one. */
  budget: Prisma.Decimal | null;
  /** Today's calendar date in the user's timezone, YYYY-MM-DD. */
  today: string;
}

/**
 * Priority order, highest first:
 *   1. Overdue goals (their target date is in the past),
 *   2. then goals by nearest target date,
 *   3. goals without a deadline last.
 * Amounts are never the primary factor; ties fall back to the older goal and
 * finally the id so the order is deterministic.
 */
export function prioritizeGoals(goals: RecommendationGoalInput[]): RecommendationGoalInput[] {
  return [...goals].sort((left, right) => {
    const leftDate = left.targetDate ?? '9999-12-31';
    const rightDate = right.targetDate ?? '9999-12-31';
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
  });
}

function priorityReason(goal: RecommendationGoalInput): string {
  if (goal.displayStatus === 'OVERDUE') {
    return `Đã quá hạn từ ${goal.targetDate} nên được xếp đầu.`;
  }
  if (goal.targetDate) {
    return `Hạn chót ${goal.targetDate}; xếp theo thứ tự hạn gần nhất.`;
  }
  return 'Không đặt hạn chót nên xếp sau các mục tiêu có hạn.';
}

function completionDate(today: string, months: number): string | null {
  return DateTime.fromISO(today, { zone: 'utc' }).plus({ months }).toISODate();
}

/**
 * Distributes the budget sequentially in priority order: each goal receives up
 * to its required monthly amount (or its whole remaining amount when it has no
 * deadline), and whatever is left flows to the next goal. The sum of the
 * recommendations can therefore never exceed the budget.
 */
export function buildRecommendations(
  goals: RecommendationGoalInput[],
  options: AllocationOptions,
): SavingsRecommendationItemDto[] {
  const ordered = prioritizeGoals(goals);
  let budget = options.budget;

  return ordered.map((goal, index) => {
    const priority = index + 1;
    const base = {
      goalId: goal.id,
      goalName: goal.name,
      currency: goal.currency,
      displayStatus: goal.displayStatus,
      targetDate: goal.targetDate,
      monthsRemaining: goal.monthsRemaining,
      remainingAmount: moneyString(goal.remaining),
      requiredMonthlySaving:
        goal.requiredMonthly === null ? null : moneyString(goal.requiredMonthly),
      priority,
      priorityReason: priorityReason(goal),
    };

    // Nothing left to save, or already fully funded.
    if (goal.remaining.lessThanOrEqualTo(0)) {
      return {
        ...base,
        recommendedMonthlySaving: moneyString(0),
        estimatedCompletionDate: options.today,
        feasibility: 'ON_TRACK' as GoalFeasibility,
        explanation: 'Mục tiêu đã đủ số tiền; không cần phân bổ thêm.',
      };
    }

    if (budget === null) {
      return {
        ...base,
        recommendedMonthlySaving: null,
        estimatedCompletionDate: null,
        feasibility: 'INSUFFICIENT_DATA' as GoalFeasibility,
        explanation:
          'Chưa đủ dữ liệu thu nhập và chi tiêu để đề xuất mức tiết kiệm cho mục tiêu này.',
      };
    }

    const desired = goal.requiredMonthly ?? goal.remaining;
    const allocated = Prisma.Decimal.min(desired, budget).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_DOWN,
    );
    budget = budget.minus(allocated);

    if (allocated.lessThanOrEqualTo(0)) {
      const required = goal.requiredMonthly;
      return {
        ...base,
        recommendedMonthlySaving: moneyString(0),
        estimatedCompletionDate: null,
        feasibility: 'NOT_FEASIBLE' as GoalFeasibility,
        explanation:
          goal.displayStatus === 'OVERDUE'
            ? `Đã quá hạn từ ${goal.targetDate} và khả năng tiết kiệm hiện tại chưa thể phân bổ thêm.`
            : required
              ? `Cần ${formatAmount(required, goal.currency)}/tháng nhưng khả năng tiết kiệm hiện tại đã được phân bổ hết.`
              : 'Khả năng tiết kiệm hiện tại chưa thể phân bổ cho mục tiêu này.',
      };
    }

    const monthsToComplete = Math.max(1, Math.ceil(goal.remaining.dividedBy(allocated).toNumber()));
    const estimated = completionDate(options.today, monthsToComplete);
    const recommended = formatAmount(allocated, goal.currency);

    if (goal.displayStatus === 'OVERDUE') {
      return {
        ...base,
        recommendedMonthlySaving: moneyString(allocated),
        estimatedCompletionDate: estimated,
        feasibility: 'NOT_FEASIBLE' as GoalFeasibility,
        explanation: `Đã quá hạn từ ${goal.targetDate}. Đề xuất ${recommended}/tháng; dự kiến hoàn thành ${estimated}.`,
      };
    }

    if (goal.targetDate === null || goal.requiredMonthly === null) {
      return {
        ...base,
        recommendedMonthlySaving: moneyString(allocated),
        estimatedCompletionDate: estimated,
        feasibility: 'ON_TRACK' as GoalFeasibility,
        explanation: `Không đặt hạn chót. Đề xuất ${recommended}/tháng; dự kiến hoàn thành ${estimated}.`,
      };
    }

    const onTrack = allocated.greaterThanOrEqualTo(goal.requiredMonthly);
    return {
      ...base,
      recommendedMonthlySaving: moneyString(allocated),
      estimatedCompletionDate: estimated,
      feasibility: onTrack ? 'ON_TRACK' : 'AT_RISK',
      explanation: onTrack
        ? `Đề xuất ${recommended}/tháng, đáp ứng mức cần thiết ${formatAmount(goal.requiredMonthly, goal.currency)}/tháng để hoàn thành trước ${goal.targetDate}.`
        : `Đề xuất ${recommended}/tháng, thấp hơn mức cần thiết ${formatAmount(goal.requiredMonthly, goal.currency)}/tháng; dự kiến hoàn thành ${estimated}, sau hạn ${goal.targetDate}.`,
    };
  });
}

/** Sum of the positive allocations, which the response reports as allocated. */
export function sumRecommended(items: SavingsRecommendationItemDto[]): Prisma.Decimal {
  return items.reduce(
    (sum, item) =>
      item.recommendedMonthlySaving === null
        ? sum
        : sum.plus(toDecimal(item.recommendedMonthlySaving)),
    ZERO,
  );
}
