import type { GoalStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type {
  AdjustmentChangeDto,
  MultiGoalSimulationDifferenceDto,
  PlanFiguresDto,
  SavingsRecommendationItemDto,
  SimulationFeasibility,
  SimulationScenario,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { moneyString, percentage, toDecimal } from '../../common/utils/money';
import { monthsRemaining, requiredMonthlySaving } from '../goals/goal.mapper';

/**
 * Deterministic, read-only plan simulations (M2d).
 *
 * Every scenario keeps the recorded contributions untouched and only moves the
 * plan's target, deadline or assumed monthly amount. The arithmetic is pure and
 * returns the figures plus the reason, so the API and the UI never disagree.
 */

const ZERO = new Prisma.Decimal(0);
const VI_NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

function formatAmount(value: Prisma.Decimal | string, currency: string): string {
  return `${VI_NUMBER.format(toDecimal(value).toNumber())} ${currency}`;
}

function completionDate(today: string, months: number): string | null {
  return DateTime.fromISO(today, { zone: 'utc' }).plus({ months }).toISODate();
}

export interface PlanInput {
  status: GoalStatus;
  targetAmount: string;
  savedAmount: string;
  targetDate: string | null;
  /** Today's calendar date in the owner's timezone. */
  today: string;
  /** Monthly amount the projection assumes; null when none is available. */
  monthlySaving: Prisma.Decimal | null;
}

/** The figures of one plan (current or hypothetical). Saved money never moves. */
export function planFigures(input: PlanInput): PlanFiguresDto {
  const target = toDecimal(input.targetAmount);
  const saved = toDecimal(input.savedAmount);
  const remaining = Prisma.Decimal.max(target.minus(saved), ZERO);
  const months = monthsRemaining(input.today, input.targetDate);
  const required = requiredMonthlySaving(input.status, remaining, months);

  // With nothing left to save the goal is already complete, whatever the date.
  if (remaining.lessThanOrEqualTo(0)) {
    return {
      targetAmount: moneyString(target),
      savedAmount: moneyString(saved),
      remainingAmount: moneyString(remaining),
      completionPercentage: percentage(saved, target),
      targetDate: input.targetDate,
      monthsRemaining: months,
      requiredMonthlySaving: required,
      monthlySaving: input.monthlySaving === null ? null : moneyString(input.monthlySaving),
      monthsToComplete: 0,
      estimatedCompletionDate: input.today,
      deadlineMet: input.targetDate === null ? null : true,
    };
  }

  const monthsToComplete =
    input.monthlySaving !== null && input.monthlySaving.greaterThan(0)
      ? Math.ceil(remaining.dividedBy(input.monthlySaving).toNumber())
      : null;
  const estimatedCompletionDate =
    monthsToComplete === null ? null : completionDate(input.today, monthsToComplete);
  const deadlineMet =
    input.targetDate !== null && estimatedCompletionDate !== null
      ? estimatedCompletionDate <= input.targetDate
      : null;

  return {
    targetAmount: moneyString(target),
    savedAmount: moneyString(saved),
    remainingAmount: moneyString(remaining),
    completionPercentage: percentage(saved, target),
    targetDate: input.targetDate,
    monthsRemaining: months,
    requiredMonthlySaving: required,
    monthlySaving: input.monthlySaving === null ? null : moneyString(input.monthlySaving),
    monthsToComplete,
    estimatedCompletionDate,
    deadlineMet,
  };
}

/** The monthly amount the current plan implies, used as the baseline projection. */
export function baselineMonthlySaving(
  status: GoalStatus,
  targetAmount: string,
  savedAmount: string,
  today: string,
  targetDate: string | null,
  averagePace: Prisma.Decimal | null,
): Prisma.Decimal | null {
  const remaining = Prisma.Decimal.max(toDecimal(targetAmount).minus(toDecimal(savedAmount)), ZERO);
  const required = requiredMonthlySaving(status, remaining, monthsRemaining(today, targetDate));
  if (required !== null) {
    const value = toDecimal(required);
    if (value.greaterThan(0)) return value;
  }
  return averagePace !== null && averagePace.greaterThan(0) ? averagePace : null;
}

export interface CapacityReference {
  status: 'available' | 'no_capacity' | 'insufficient_data';
  suggested: Prisma.Decimal | null;
}

export interface SingleSimulationInput {
  scenario: Exclude<SimulationScenario, 'MULTI_GOAL_BUDGET'>;
  today: string;
  currency: string;
  goal: {
    id: string;
    name: string;
    status: GoalStatus;
    targetAmount: string;
    savedAmount: string;
    startDate: string;
    targetDate: string | null;
    averagePace: Prisma.Decimal | null;
  };
  capacity: CapacityReference;
  monthlyAmount?: string;
  newTargetDate?: string;
  newTargetAmount?: string;
}

/**
 * Runs one scenario. The assumed monthly amount differs by scenario:
 *  - MONTHLY_AMOUNT: the amount the user typed,
 *  - DEADLINE: the amount the new deadline requires (so the projection lands on it),
 *  - TARGET_AMOUNT: the current plan's amount, so the deadline comparison shows
 *    whether the old pace still fits the new target.
 */
export function simulateSingleGoal(
  input: SingleSimulationInput,
): Omit<SingleGoalSimulationDto, 'generatedAt' | 'timezone'> {
  const goal = input.goal;
  const currentMonthly = baselineMonthlySaving(
    goal.status,
    goal.targetAmount,
    goal.savedAmount,
    input.today,
    goal.targetDate,
    goal.averagePace,
  );

  const current = planFigures({
    status: goal.status,
    targetAmount: goal.targetAmount,
    savedAmount: goal.savedAmount,
    targetDate: goal.targetDate,
    today: input.today,
    monthlySaving: currentMonthly,
  });

  let targetAmount = goal.targetAmount;
  let targetDate = goal.targetDate;
  let monthlySaving = currentMonthly;

  if (input.scenario === 'MONTHLY_AMOUNT' && input.monthlyAmount !== undefined) {
    monthlySaving = toDecimal(input.monthlyAmount);
  } else if (input.scenario === 'DEADLINE' && input.newTargetDate !== undefined) {
    targetDate = input.newTargetDate;
    const remaining = Prisma.Decimal.max(
      toDecimal(goal.targetAmount).minus(toDecimal(goal.savedAmount)),
      ZERO,
    );
    const months = monthsRemaining(input.today, targetDate);
    // Rounded up, so paying the required amount every month really lands on
    // or before the deadline instead of one rounding step short.
    monthlySaving = remaining.lessThanOrEqualTo(0)
      ? currentMonthly
      : months !== null && months > 0
        ? remaining.dividedBy(months).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP)
        : null;
  } else if (input.scenario === 'TARGET_AMOUNT' && input.newTargetAmount !== undefined) {
    targetAmount = input.newTargetAmount;
  }

  const simulated = planFigures({
    status: goal.status,
    targetAmount,
    savedAmount: goal.savedAmount,
    targetDate,
    today: input.today,
    monthlySaving,
  });

  const capacitySuggested = input.capacity.suggested;
  const requiredWithinCapacity =
    capacitySuggested !== null && simulated.requiredMonthlySaving !== null
      ? toDecimal(simulated.requiredMonthlySaving).lessThanOrEqualTo(capacitySuggested)
      : null;
  const deadlineMet = simulated.deadlineMet;
  const canFinish = simulated.monthsToComplete !== null;

  let feasibility: SimulationFeasibility;
  if (deadlineMet === false || requiredWithinCapacity === false) feasibility = 'NOT_FEASIBLE';
  else if (deadlineMet === true || canFinish) feasibility = 'FEASIBLE';
  else feasibility = 'INSUFFICIENT_DATA';

  const delta = (left: string | null, right: string | null): string | null =>
    left === null || right === null ? null : moneyString(toDecimal(right).minus(toDecimal(left)));
  const deltaNumber = (left: number | null, right: number | null): number | null =>
    left === null || right === null ? null : right - left;

  const warnings: string[] = [];
  if (simulated.targetDate !== null && simulated.deadlineMet === false) {
    warnings.push(
      `Với ${simulated.monthlySaving === null ? 'mức tiết kiệm này' : `${formatAmount(simulated.monthlySaving, input.currency)}/tháng`}, mục tiêu dự kiến hoàn thành ${simulated.estimatedCompletionDate ?? '—'}, sau hạn ${simulated.targetDate}.`,
    );
  }
  if (requiredWithinCapacity === false && capacitySuggested !== null) {
    warnings.push(
      `Mức cần thiết ${formatAmount(simulated.requiredMonthlySaving ?? '0', input.currency)}/tháng vượt khả năng tiết kiệm hiện tại ${formatAmount(capacitySuggested, input.currency)}/tháng.`,
    );
  }
  if (goal.averagePace === null) {
    warnings.push(
      'Mục tiêu chưa có khoản góp nào nên chưa có tốc độ thực tế để so sánh; kết quả dùng mức tiết kiệm cần thiết theo kế hoạch.',
    );
  }
  if (input.capacity.status === 'insufficient_data') {
    warnings.push(
      'Chưa đủ dữ liệu thu nhập và chi tiêu để đối chiếu khả năng tiết kiệm; kết quả chỉ là phép tính theo kế hoạch.',
    );
  }

  let feasibilityReason: string;
  if (feasibility === 'NOT_FEASIBLE') {
    feasibilityReason =
      deadlineMet === false
        ? `Không đạt hạn ${simulated.targetDate ?? 'đã chọn'} với mức tiết kiệm giả định.`
        : `Mức cần thiết ${formatAmount(simulated.requiredMonthlySaving ?? '0', input.currency)}/tháng vượt khả năng tiết kiệm hiện tại.`;
  } else if (feasibility === 'FEASIBLE') {
    feasibilityReason =
      simulated.targetDate === null
        ? 'Không đặt hạn chót; với mức tiết kiệm này, số tiền còn thiếu sẽ được góp xong.'
        : `Với mức tiết kiệm này, mục tiêu dự kiến hoàn thành ${simulated.estimatedCompletionDate ?? '—'}, đúng hạn ${simulated.targetDate}.`;
  } else {
    feasibilityReason = 'Không đủ dữ liệu để xác định mục tiêu có hoàn thành đúng hạn hay không.';
  }

  return {
    scenario: input.scenario,
    currency: input.currency,
    goalId: goal.id,
    goalName: goal.name,
    current,
    simulated,
    difference: {
      targetAmount: moneyString(toDecimal(targetAmount).minus(toDecimal(goal.targetAmount))),
      remainingAmount: moneyString(
        toDecimal(simulated.remainingAmount).minus(toDecimal(current.remainingAmount)),
      ),
      requiredMonthlySaving: delta(current.requiredMonthlySaving, simulated.requiredMonthlySaving),
      monthlySaving: delta(current.monthlySaving, simulated.monthlySaving),
      completionDateShiftMonths: deltaNumber(current.monthsToComplete, simulated.monthsToComplete),
    },
    capacity: {
      available: input.capacity.status === 'available' && capacitySuggested !== null,
      monthlySaving: capacitySuggested === null ? null : moneyString(capacitySuggested),
      requiredWithinCapacity,
    },
    feasibility,
    feasibilityReason,
    warnings,
    limitations: simulationLimitations(input.currency),
  };
}

export function simulationLimitations(currency: string): string[] {
  return [
    `Mọi số tiền tính cho ${currency}; không quy đổi giữa các tiền tệ.`,
    'Đây là mô phỏng: không có giao dịch nào được tạo, không có khoản góp nào được ghi và không có trường nào của mục tiêu bị thay đổi.',
    'Dự báo giả định mức tiết kiệm giữ nguyên mỗi tháng và không tính lãi suất, lạm phát hay nghĩa vụ phát sinh.',
    'Khả năng đáp ứng mức cần thiết được đối chiếu với khả năng tiết kiệm của M2c khi có dữ liệu; dưới 3 tháng dữ liệu thì độ tin cậy thấp.',
    'Số tiền đã góp hiện có luôn được giữ nguyên trong mọi kịch bản.',
  ];
}

/** Per-goal allocation changes between the current advice and an alternative budget. */
export function compareAllocations(
  baseline: SavingsRecommendationItemDto[],
  simulated: SavingsRecommendationItemDto[],
): MultiGoalSimulationDifferenceDto[] {
  const before = new Map(baseline.map((item) => [item.goalId, item.recommendedMonthlySaving]));
  return simulated.map((item) => {
    const previous = before.get(item.goalId) ?? null;
    const current = item.recommendedMonthlySaving;
    return {
      goalId: item.goalId,
      goalName: item.goalName,
      baselineMonthlySaving: previous,
      simulatedMonthlySaving: current,
      deltaMonthlySaving:
        previous === null || current === null
          ? null
          : moneyString(toDecimal(current).minus(toDecimal(previous))),
    };
  });
}

export interface AdjustmentInput {
  status: GoalStatus;
  targetAmount: string;
  savedAmount: string;
  startDate: string;
  targetDate: string | null;
  today: string;
  newTargetAmount?: string;
  newTargetDate?: string;
}

export interface AdjustmentValidation {
  changes: AdjustmentChangeDto[];
  problems: string[];
  warnings: string[];
}

/**
 * The same rules the goals API enforces, evaluated before anything is written.
 * `GoalsService.update` remains the authority: the apply endpoint delegates to
 * it, so a preview can never allow a change the real endpoint would reject.
 */
export function validateAdjustment(input: AdjustmentInput): AdjustmentValidation {
  const changes: AdjustmentChangeDto[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];

  if (input.status === 'ARCHIVED') {
    problems.push('Mục tiêu đã lưu trữ, không thể chỉnh sửa.');
  }

  const saved = toDecimal(input.savedAmount);
  if (input.newTargetAmount !== undefined) {
    const target = toDecimal(input.newTargetAmount);
    if (target.lessThanOrEqualTo(0)) {
      problems.push('Số tiền mục tiêu phải lớn hơn 0.');
    } else if (target.lessThan(saved)) {
      problems.push('Số tiền mục tiêu không được thấp hơn số tiền đã tiết kiệm.');
    } else if (target.equals(toDecimal(input.targetAmount))) {
      problems.push('Số tiền mục tiêu mới trùng với mức hiện tại.');
    } else {
      changes.push({
        field: 'targetAmount',
        oldValue: moneyString(input.targetAmount),
        newValue: moneyString(target),
      });
      if (target.equals(saved)) {
        warnings.push(
          'Số tiền mục tiêu bằng số đã tiết kiệm nên mục tiêu sẽ được đánh dấu hoàn thành.',
        );
      }
    }
  }

  if (input.newTargetDate !== undefined) {
    const date = input.newTargetDate;
    if (date <= input.startDate) {
      problems.push('Ngày đích phải sau ngày bắt đầu.');
    } else if (date === input.targetDate) {
      problems.push('Ngày đích mới trùng với hạn hiện tại.');
    } else {
      changes.push({ field: 'targetDate', oldValue: input.targetDate ?? '', newValue: date });
      if (date < input.today) {
        warnings.push(
          'Ngày đích mới đã ở quá khứ: mục tiêu sẽ được xếp vào nhóm quá hạn nếu chưa góp đủ.',
        );
      }
    }
  }

  if (changes.length === 0 && problems.length === 0) {
    problems.push('Không có thay đổi nào để áp dụng.');
  }

  return { changes, problems, warnings };
}
