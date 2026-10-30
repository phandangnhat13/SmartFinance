import type {
  AiEvidenceDto,
  GoalFeasibility,
  SavingsProgressDto,
  SavingsProgressStatus,
  SavingsRecommendationsDto,
  SavingsRecommendationStatus,
} from '@smart-finance/shared-types';
import { SAFETY_BUFFER_PERCENT } from '../../insights/savings-recommendation';

/**
 * Structured, server-built savings context (M2e phase 1–2).
 *
 * Only these aggregated values are sent to a model. Every figure comes from
 * M2c (`SavingsRecommendationsDto`) and M2d (`SavingsProgressDto`); nothing is
 * recalculated here. The same object feeds the deterministic fallback, the
 * prompts, the evidence catalogue, and the "no invented amounts" check.
 */

const VI_NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** Display-only formatting; never used for arithmetic. */
export function formatAmount(value: string | number | null, currency: string): string {
  if (value === null) return `Chưa xác định (${currency})`;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${currency}`;
  return `${VI_NUMBER.format(numeric)} ${currency}`;
}

export function formatDateDisplay(value: string | null): string {
  if (!value) return 'Chưa có ngày đích';
  const [year, month, day] = value.split('-');
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export interface SavingsAiGoalFact {
  goalId: string;
  goalName: string;
  priority: number | null;
  priorityReason: string;
  progressStatus: SavingsProgressStatus;
  statusReason: string;
  targetDate: string | null;
  monthsRemaining: number | null;
  remainingAmount: string;
  completedPercentage: number;
  requiredMonthlySaving: string | null;
  recommendedMonthlySaving: string | null;
  estimatedCompletionDate: string | null;
  feasibility: GoalFeasibility | null;
  atRisk: boolean | null;
}

export interface SavingsAiContext {
  currency: string;
  timezone: string;
  today: string;
  capacity: {
    status: SavingsRecommendationStatus;
    reason: 'no_complete_months' | 'no_income' | null;
    monthsAnalyzed: number;
    analyzedMonths: string[];
    averageMonthlyIncome: string | null;
    averageMonthlyExpense: string | null;
    averageNetCashFlow: string | null;
    historicalSavingsRate: number | null;
    safetyBufferPercent: number;
    safetyBufferAmount: string | null;
    suggestedMonthlySaving: string | null;
    confidence: 'high' | 'medium' | 'low';
  };
  plan: {
    monthlyBudget: string | null;
    allocatedMonthly: string;
    unallocatedMonthly: string | null;
    simulated: boolean;
    simulatedMonthlySaving: string | null;
  };
  progress: {
    activeGoals: number;
    onTrack: number;
    atRisk: number;
    overdue: number;
    completed: number;
    paused: number;
    insufficientData: number;
    totalTargetAmount: string;
    totalSavedAmount: string;
    totalRemainingAmount: string;
    overallPercentage: number;
  };
  goals: SavingsAiGoalFact[];
  rules: string[];
  limitations: string[];
}

/**
 * Merges the M2c allocation with the M2d progress per goal. A goal can appear
 * in both; the progress row supplies the status, the allocation row the plan.
 */
export function buildSavingsAiContext(
  recommendations: SavingsRecommendationsDto,
  progress: SavingsProgressDto,
): SavingsAiContext {
  const allocation = new Map(recommendations.items.map((item) => [item.goalId, item]));

  const goals: SavingsAiGoalFact[] = progress.goals.map((goal) => {
    const item = allocation.get(goal.goalId);
    return {
      goalId: goal.goalId,
      goalName: goal.name,
      priority: item?.priority ?? null,
      priorityReason:
        item?.priorityReason ?? 'Mục tiêu chưa được phân bổ trong kế hoạch tháng này.',
      progressStatus: goal.progressStatus,
      statusReason: goal.statusReason,
      targetDate: goal.targetDate,
      monthsRemaining: goal.monthsRemaining,
      remainingAmount: goal.remainingAmount,
      completedPercentage: goal.completionPercentage,
      requiredMonthlySaving: goal.requiredMonthlySaving,
      recommendedMonthlySaving: item?.recommendedMonthlySaving ?? null,
      estimatedCompletionDate: item?.estimatedCompletionDate ?? goal.pace.estimatedCompletionDate,
      feasibility: item?.feasibility ?? null,
      atRisk: goal.atRisk,
    };
  });

  // Goals that only appear in the M2c allocation (e.g. past deadline and thus
  // already classified as OVERDUE by M2b) are still explained.
  recommendations.items.forEach((item) => {
    if (goals.some((goal) => goal.goalId === item.goalId)) return;
    goals.push({
      goalId: item.goalId,
      goalName: item.goalName,
      priority: item.priority,
      priorityReason: item.priorityReason,
      progressStatus: 'AT_RISK',
      statusReason: item.explanation,
      targetDate: item.targetDate,
      monthsRemaining: item.monthsRemaining,
      remainingAmount: item.remainingAmount,
      completedPercentage: 0,
      requiredMonthlySaving: item.requiredMonthlySaving,
      recommendedMonthlySaving: item.recommendedMonthlySaving,
      estimatedCompletionDate: item.estimatedCompletionDate,
      feasibility: item.feasibility,
      atRisk: true,
    });
  });
  goals.sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99));

  return {
    currency: recommendations.currency,
    timezone: recommendations.timezone,
    today: progress.today,
    capacity: {
      status: recommendations.capacity.status,
      reason: recommendations.capacity.reason,
      monthsAnalyzed: recommendations.capacity.monthsAnalyzed,
      analyzedMonths: recommendations.capacity.analyzedMonths,
      averageMonthlyIncome: recommendations.capacity.averageMonthlyIncome,
      averageMonthlyExpense: recommendations.capacity.averageMonthlyExpense,
      averageNetCashFlow: recommendations.capacity.averageNetCashFlow,
      historicalSavingsRate: recommendations.capacity.historicalSavingsRate,
      safetyBufferPercent: SAFETY_BUFFER_PERCENT,
      safetyBufferAmount: recommendations.capacity.safetyBufferAmount,
      suggestedMonthlySaving: recommendations.capacity.suggestedMonthlySaving,
      confidence: recommendations.capacity.confidence,
    },
    plan: {
      monthlyBudget: recommendations.monthlyBudget,
      allocatedMonthly: recommendations.allocatedMonthly,
      unallocatedMonthly: recommendations.unallocatedMonthly,
      simulated: recommendations.simulated,
      simulatedMonthlySaving: recommendations.simulatedMonthlySaving,
    },
    progress: { ...progress.summary },
    goals,
    rules: [...progress.rules, ...recommendations.assumptions],
    limitations: [...recommendations.limitations, ...progress.limitations],
  };
}

/** Evidence keys the model may cite. The values are always built here. */
export type EvidenceKey = string;

export function evidenceCatalog(context: SavingsAiContext): Record<EvidenceKey, AiEvidenceDto> {
  const { currency } = context;
  const catalog: Record<EvidenceKey, AiEvidenceDto> = {
    capacity: {
      label: 'Mức tiết kiệm đề xuất mỗi tháng',
      value:
        context.capacity.suggestedMonthlySaving === null
          ? 'Chưa đủ dữ liệu để đề xuất'
          : formatAmount(context.capacity.suggestedMonthlySaving, currency),
    },
    income: {
      label: 'Thu nhập trung bình mỗi tháng',
      value: formatAmount(context.capacity.averageMonthlyIncome, currency),
    },
    expense: {
      label: 'Chi tiêu trung bình mỗi tháng',
      value: formatAmount(context.capacity.averageMonthlyExpense, currency),
    },
    net_cash_flow: {
      label: 'Dòng tiền ròng trung bình mỗi tháng',
      value: formatAmount(context.capacity.averageNetCashFlow, currency),
    },
    safety_buffer: {
      label: `Khoản dự phòng an toàn (${context.capacity.safetyBufferPercent}%)`,
      value: formatAmount(context.capacity.safetyBufferAmount, currency),
    },
    monthly_budget: {
      label: 'Ngân sách phân bổ tháng này',
      value: formatAmount(context.plan.monthlyBudget, currency),
    },
    unallocated: {
      label: 'Phần ngân sách chưa phân bổ',
      value: formatAmount(context.plan.unallocatedMonthly, currency),
    },
    savings_history: {
      label: 'Số tháng dữ liệu đã phân tích',
      value: `${context.capacity.monthsAnalyzed} tháng (${context.capacity.analyzedMonths.join(', ') || 'chưa có'})`,
    },
  };

  context.goals.forEach((goal) => {
    catalog[`goal:${goal.goalId}`] = {
      label: `Mục tiêu ${goal.goalName}`,
      value: `Còn thiếu ${formatAmount(goal.remainingAmount, currency)} · ${
        goal.recommendedMonthlySaving === null
          ? 'chưa có mức đề xuất'
          : `đề xuất ${formatAmount(goal.recommendedMonthlySaving, currency)}/tháng`
      } · dự kiến hoàn thành ${formatDateDisplay(goal.estimatedCompletionDate)}`,
    };
    catalog[`progress:${goal.goalId}`] = {
      label: `Tiến độ ${goal.goalName}`,
      value: `${goal.progressStatus} — ${goal.statusReason}`,
    };
  });

  return catalog;
}

export function evidenceList(
  keys: readonly string[],
  catalog: Record<EvidenceKey, AiEvidenceDto>,
): AiEvidenceDto[] {
  return keys
    .map((key) => catalog[key])
    .filter((item): item is AiEvidenceDto => item !== undefined);
}

/**
 * Every number the model is allowed to write: the context's own values,
 * calendars dates, and small counts (months, priorities, percentages).
 */
export function collectAllowedNumbers(context: SavingsAiContext): Set<string> {
  const allowed = new Set<string>();
  for (let value = 0; value <= 120; value += 1) allowed.add(String(value));
  for (let year = 2000; year <= 2100; year += 1) allowed.add(String(year));

  const addString = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        allowed.add(String(numeric));
        allowed.add(trimmed.replace(/[^\d]/g, ''));
      }
      return;
    }
    // Dates and periods: add each component ("2027-06-30" -> 2027, 06, 30).
    trimmed
      .split(/[^\d]+/)
      .filter(Boolean)
      .forEach((part) => allowed.add(String(Number(part))));
  };

  const walk = (value: unknown): void => {
    if (typeof value === 'number') {
      allowed.add(String(value));
      return;
    }
    if (typeof value === 'string') {
      addString(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(context);
  return allowed;
}

/**
 * Numbers written by the model that do not exist in the context. A non-empty
 * result means the model invented a financial value, so the response is
 * discarded and the deterministic fallback is used instead.
 */
export function findInventedNumbers(text: string, allowed: Set<string>): string[] {
  const matches =
    text.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?/g)?.filter(Boolean) ?? [];
  const invented: string[] = [];
  matches.forEach((match) => {
    const digits = match.replace(/[^\d]/g, '');
    const asFloat = Number(match.replace(/\./g, '').replace(',', '.'));
    const variants = new Set<string>([digits]);
    if (Number.isFinite(asFloat)) variants.add(String(asFloat));
    if (![...variants].some((variant) => allowed.has(variant))) invented.push(match);
  });
  return invented;
}
