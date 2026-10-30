import type {
  BudgetAnalyticsStatus,
  FinancialHealthOverallDto,
  HealthClassification,
  HealthEvidenceDto,
  HealthGroupDto,
  HealthGroupKey,
  HealthRecommendationDto,
  HealthRecommendationSeverity,
  SavingsProgressStatus,
} from '@smart-finance/shared-types';
import { HEALTH_GROUP_LABELS, HEALTH_CLASSIFICATION_LABELS } from '@smart-finance/shared-types';

/**
 * Deterministic financial-health scoring (M3d).
 *
 * Every rule and threshold is defined here, in one pure module, so the API, the
 * tests and the UI describe the same score. Nothing is AI, ML or a credit
 * score; missing data yields `null` with an explanation, never a zero.
 *
 * Groups and weights (sum 100):
 * - cash-flow      25  saving rate, positive months, income stability
 * - budget         20  budgets of the current month
 * - savings        20  goal progress from M2c
 * - stability      20  emergency fund = balance ÷ average monthly expense
 * - forecast-risk  15  M3c forecast confidence and projected cash flow
 *
 * The overall score is the weighted average over the groups that could be
 * scored, renormalised by their weight. It is withheld unless at least three
 * groups are scored and at least 60% of the total weight is available.
 */

export const HEALTH_WEIGHTS: Record<HealthGroupKey, number> = {
  'cash-flow': 25,
  budget: 20,
  savings: 20,
  stability: 20,
  'forecast-risk': 15,
};

export const HEALTH_GROUP_ORDER: HealthGroupKey[] = [
  'cash-flow',
  'budget',
  'savings',
  'stability',
  'forecast-risk',
];

export const HEALTH_THRESHOLDS = {
  excellent: 85,
  good: 70,
  fair: 50,
} as const;

/** An overall score needs at least this many scored groups… */
export const MIN_SCORED_GROUPS = 3;
/** …and at least this share of the configured weight. */
export const MIN_OVERALL_WEIGHT = 60;

/** Target saving rate used by the cash-flow recommendation. */
export const TARGET_SAVINGS_RATE = 20;
/** Target emergency fund used by the stability recommendation. */
export const TARGET_EMERGENCY_MONTHS = 3;

export interface HealthMonthPoint {
  month: string;
  income: number;
  expense: number;
  hasTransactions: boolean;
}

export interface CashFlowInput {
  /** The analysis window in the requested currency, oldest first. */
  months: HealthMonthPoint[];
}

export interface BudgetHealthItem {
  id: string;
  name: string;
  status: BudgetAnalyticsStatus;
  limit: number;
  spent: number;
  usagePercent: number | null;
}

export interface BudgetHealthInput {
  month: string;
  currency: string;
  items: BudgetHealthItem[];
}

export interface SavingsHealthGoal {
  goalId: string;
  name: string;
  progressStatus: SavingsProgressStatus;
  requiredMonthlySaving: number | null;
  remainingAmount: number;
}

export interface SavingsHealthInput {
  currency: string;
  goals: SavingsHealthGoal[];
  archived: number;
}

export interface StabilityInput {
  currency: string;
  currentBalance: number | null;
  accountsIncluded: number;
  months: HealthMonthPoint[];
}

export interface ForecastRiskInput {
  currency: string;
  status: 'ok' | 'insufficient_data';
  reason: string | null;
  income: {
    confidenceScore: number;
    confidenceLevel: string;
    model: string | null;
    monthsWithData: number;
  };
  expense: {
    confidenceScore: number;
    confidenceLevel: string;
    model: string | null;
    monthsWithData: number;
  };
  net: {
    status: 'ok' | 'insufficient_data';
    base: number | null;
    best: number | null;
    worst: number | null;
  };
  balance: {
    status: 'ok' | 'insufficient_data';
    currentBalance: number | null;
    projectedBalance: number | null;
  };
}

interface ScoredGroup {
  status: 'scored' | 'insufficient_data';
  score: number | null;
  explanation: string;
  evidence: HealthEvidenceDto[];
  missingData: string[];
  limitations: string[];
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values) ?? 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function moneyText(value: number, currency: string): string {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(round(value, 2))} ${currency}`;
}

export function classifyHealth(score: number | null): HealthClassification {
  if (score === null) return 'INSUFFICIENT_DATA';
  if (score >= HEALTH_THRESHOLDS.excellent) return 'EXCELLENT';
  if (score >= HEALTH_THRESHOLDS.good) return 'GOOD';
  if (score >= HEALTH_THRESHOLDS.fair) return 'FAIR';
  return 'NEEDS_ATTENTION';
}

const STATUS_POINTS: Record<BudgetAnalyticsStatus, number> = {
  EXCEEDED: 0,
  WARNING: 50,
  ON_TRACK: 100,
  NOT_STARTED: 100,
  COMPLETED: 100,
};

const SAVINGS_POINTS: Partial<Record<SavingsProgressStatus, number>> = {
  ON_TRACK: 100,
  COMPLETED: 100,
  AT_RISK: 50,
  OVERDUE: 0,
};

/* ------------------------------ cash flow ------------------------------ */

export function scoreCashFlow(input: CashFlowInput, currency: string): ScoredGroup {
  const months = input.months;
  const dataMonths = months.filter((month) => month.hasTransactions);
  const missingMonths = months.length - dataMonths.length;
  const missingData =
    missingMonths === 0
      ? []
      : [`${missingMonths} tháng trong cửa sổ không có giao dịch nên không được tính là 0.`];
  const limitations = [
    'Chỉ tính giao dịch thu nhập và chi tiêu; chuyển khoản nội bộ không được tính.',
    'Tháng không có giao dịch bị loại khỏi mẫu thay vì coi là tháng chi 0.',
  ];

  if (dataMonths.length === 0) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: 'Chưa có tháng nào đã kết thúc với giao dịch thu hoặc chi.',
      evidence: [],
      missingData: ['Cần ít nhất một tháng đã kết thúc có giao dịch thu/chi.'],
      limitations,
    };
  }

  const totalIncome = dataMonths.reduce((sum, month) => sum + month.income, 0);
  if (totalIncome <= 0) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation:
        'Các tháng có giao dịch chưa ghi nhận thu nhập nên chưa tính được tỷ lệ tiết kiệm.',
      evidence: [
        {
          key: 'months_with_data',
          label: 'Số tháng có dữ liệu',
          value: String(dataMonths.length),
          reference: null,
        },
      ],
      missingData: ['Cần ít nhất một tháng có thu nhập để chấm điểm dòng tiền.'],
      limitations,
    };
  }

  const totalExpense = dataMonths.reduce((sum, month) => sum + month.expense, 0);
  const net = totalIncome - totalExpense;
  const savingsRate = round((net / totalIncome) * 100, 1);
  const savingsPoints =
    savingsRate >= 30
      ? 50
      : savingsRate >= 20
        ? 42
        : savingsRate >= 10
          ? 32
          : savingsRate >= 0
            ? 20
            : 0;

  const positiveMonths = dataMonths.filter((month) => month.income - month.expense >= 0).length;
  const positiveShare = positiveMonths / dataMonths.length;
  const positivePoints = round(positiveShare * 30);

  const incomes = dataMonths.map((month) => month.income);
  const averageIncome = mean(incomes) ?? 0;
  const variation = averageIncome > 0 ? populationStdDev(incomes) / averageIncome : 0;
  const variationPoints =
    variation <= 0.15 ? 20 : variation <= 0.35 ? 12 : variation <= 0.6 ? 6 : 0;

  const score = clamp(round(savingsPoints + positivePoints + variationPoints));

  return {
    status: 'scored',
    score,
    explanation:
      `Tỷ lệ tiết kiệm ${savingsRate}% trên ${dataMonths.length} tháng có dữ liệu; ` +
      `${positiveMonths}/${dataMonths.length} tháng dòng tiền không âm; ` +
      `thu nhập biến động ${round(variation * 100, 1)}%.`,
    evidence: [
      {
        key: 'savings_rate',
        label: 'Tỷ lệ tiết kiệm',
        value: `${savingsRate}%`,
        reference: 'Mốc tham chiếu 20%',
      },
      {
        key: 'positive_months',
        label: 'Tháng dòng tiền không âm',
        value: `${positiveMonths}/${dataMonths.length}`,
        reference: null,
      },
      {
        key: 'income_variation',
        label: 'Mức biến động thu nhập',
        value: `${round(variation * 100, 1)}%`,
        reference: 'Càng thấp càng ổn định',
      },
      {
        key: 'net',
        label: 'Dòng tiền ròng cộng dồn',
        value: moneyText(net, currency),
        reference: null,
      },
      {
        key: 'months_with_data',
        label: 'Số tháng có dữ liệu',
        value: String(dataMonths.length),
        reference: `${months.length} tháng trong cửa sổ`,
      },
    ],
    missingData,
    limitations,
  };
}

/* -------------------------------- budget -------------------------------- */

export function scoreBudget(input: BudgetHealthInput): ScoredGroup {
  const items = input.items;
  const limitations = [
    `Ngân sách không lưu loại tiền; hạn mức được hiểu theo ${input.currency}.`,
    `Chỉ xét ngân sách của tháng ${input.month}.`,
  ];

  if (items.length === 0) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: `Chưa có ngân sách nào trong tháng ${input.month}.`,
      evidence: [],
      missingData: ['Tạo ít nhất một ngân sách tháng để nhóm này có dữ liệu chấm điểm.'],
      limitations,
    };
  }

  const counts = {
    exceeded: items.filter((item) => item.status === 'EXCEEDED').length,
    warning: items.filter((item) => item.status === 'WARNING').length,
    onTrack: items.filter((item) => item.status === 'ON_TRACK').length,
    notStarted: items.filter((item) => item.status === 'NOT_STARTED').length,
    completed: items.filter((item) => item.status === 'COMPLETED').length,
  };
  const score = clamp(
    round(items.reduce((sum, item) => sum + STATUS_POINTS[item.status], 0) / items.length),
  );
  const worstUsage = items.reduce<number | null>((worst, item) => {
    if (item.usagePercent === null) return worst;
    return worst === null || item.usagePercent > worst ? item.usagePercent : worst;
  }, null);

  return {
    status: 'scored',
    score,
    explanation:
      `${counts.exceeded + counts.warning === 0 ? 'Mọi ngân sách đang trong hạn mức' : `${counts.exceeded} ngân sách vượt hạn mức và ${counts.warning} ngân sách gần hạn mức`} ` +
      `trong tổng ${items.length} ngân sách của tháng ${input.month}.`,
    evidence: [
      {
        key: 'budgets',
        label: 'Số ngân sách trong tháng',
        value: String(items.length),
        reference: null,
      },
      {
        key: 'exceeded',
        label: 'Ngân sách vượt hạn mức',
        value: String(counts.exceeded),
        reference: 'Càng thấp càng tốt',
      },
      {
        key: 'warning',
        label: 'Ngân sách gần hạn mức',
        value: String(counts.warning),
        reference: 'Theo ngưỡng cảnh báo đã đặt',
      },
      {
        key: 'worst_usage',
        label: 'Mức sử dụng cao nhất',
        value: worstUsage === null ? '—' : `${round(worstUsage, 1)}%`,
        reference: null,
      },
    ],
    missingData: [],
    limitations,
  };
}

/* -------------------------------- savings -------------------------------- */

export function scoreSavings(input: SavingsHealthInput): ScoredGroup {
  const limitations = [
    'Mục tiêu đã lưu trữ bị loại khỏi điểm.',
    'Điểm chỉ phản ánh tiến độ đã ghi nhận; không tạo khoản góp tự động.',
  ];

  if (input.goals.length === 0) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: `Chưa có mục tiêu tiết kiệm nào bằng ${input.currency}.`,
      evidence: [],
      missingData: ['Tạo ít nhất một mục tiêu tiết kiệm để nhóm này có dữ liệu chấm điểm.'],
      limitations,
    };
  }

  const scored = input.goals.filter((goal) => SAVINGS_POINTS[goal.progressStatus] !== undefined);
  const paused = input.goals.filter((goal) => goal.progressStatus === 'PAUSED').length;
  const insufficient = input.goals.filter(
    (goal) => goal.progressStatus === 'INSUFFICIENT_DATA',
  ).length;
  const missingData: string[] = [];
  if (paused > 0) missingData.push(`${paused} mục tiêu tạm dừng không được tính điểm.`);
  if (insufficient > 0) {
    missingData.push(`${insufficient} mục tiêu chưa đủ dữ liệu tiến độ nên không được tính điểm.`);
  }
  if (input.archived > 0) {
    missingData.push(`${input.archived} mục tiêu đã lưu trữ bị loại khỏi điểm.`);
  }

  if (scored.length === 0) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: 'Các mục tiêu hiện có chưa đủ dữ liệu tiến độ để chấm điểm.',
      evidence: [],
      missingData,
      limitations,
    };
  }

  const counts = {
    onTrack: input.goals.filter((goal) => goal.progressStatus === 'ON_TRACK').length,
    atRisk: input.goals.filter((goal) => goal.progressStatus === 'AT_RISK').length,
    overdue: input.goals.filter((goal) => goal.progressStatus === 'OVERDUE').length,
    completed: input.goals.filter((goal) => goal.progressStatus === 'COMPLETED').length,
  };
  const score = clamp(
    round(
      scored.reduce((sum, goal) => sum + (SAVINGS_POINTS[goal.progressStatus] ?? 0), 0) /
        scored.length,
    ),
  );

  return {
    status: 'scored',
    score,
    explanation:
      `Chấm ${scored.length} mục tiêu có dữ liệu tiến độ: ${counts.onTrack} đúng tiến độ, ` +
      `${counts.atRisk} chậm tiến độ, ${counts.overdue} quá hạn, ${counts.completed} hoàn thành.`,
    evidence: [
      {
        key: 'scored_goals',
        label: 'Mục tiêu được chấm',
        value: String(scored.length),
        reference: `${input.goals.length} mục tiêu đang hoạt động`,
      },
      {
        key: 'on_track',
        label: 'Đúng tiến độ / hoàn thành',
        value: `${counts.onTrack + counts.completed}/${scored.length}`,
        reference: null,
      },
      {
        key: 'at_risk',
        label: 'Chậm tiến độ',
        value: String(counts.atRisk),
        reference: null,
      },
      {
        key: 'overdue',
        label: 'Quá hạn',
        value: String(counts.overdue),
        reference: null,
      },
    ],
    missingData,
    limitations,
  };
}

/* ------------------------------- stability ------------------------------- */

export function scoreStability(input: StabilityInput): ScoredGroup {
  const limitations = [
    'Chỉ dùng số dư các tài khoản đã ghi nhận; không tính tài sản hoặc khoản nợ bên ngoài.',
    'Quỹ dự phòng = số dư hiện tại ÷ chi tiêu trung bình các tháng có chi.',
  ];

  if (input.currentBalance === null) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: `Chưa xác định được số dư hiện tại bằng ${input.currency}.`,
      evidence: [],
      missingData: ['Cần ít nhất một tài khoản cùng loại tiền để tính quỹ dự phòng.'],
      limitations,
    };
  }

  const expenseMonths = input.months.filter((month) => month.hasTransactions && month.expense > 0);
  if (expenseMonths.length === 0) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: 'Chưa có tháng chi tiêu nào để tính chi tiêu trung bình.',
      evidence: [
        {
          key: 'current_balance',
          label: 'Số dư hiện tại',
          value: moneyText(input.currentBalance, input.currency),
          reference: null,
        },
      ],
      missingData: ['Cần ít nhất một tháng đã kết thúc có chi tiêu.'],
      limitations,
    };
  }

  const averageExpense =
    expenseMonths.reduce((sum, month) => sum + month.expense, 0) / expenseMonths.length;
  const monthsCovered = input.currentBalance > 0 ? input.currentBalance / averageExpense : 0;
  const score =
    input.currentBalance <= 0
      ? 0
      : monthsCovered >= 6
        ? 100
        : monthsCovered >= 3
          ? 80
          : monthsCovered >= 1
            ? 55
            : 30;

  return {
    status: 'scored',
    score,
    explanation:
      input.currentBalance <= 0
        ? 'Số dư hiện tại đang âm hoặc bằng 0 nên chưa có quỹ dự phòng.'
        : `Số dư hiện tại đủ cho ${round(monthsCovered, 1)} tháng chi tiêu trung bình ` +
          `(${moneyText(averageExpense, input.currency)}/tháng).`,
    evidence: [
      {
        key: 'current_balance',
        label: 'Số dư hiện tại',
        value: moneyText(input.currentBalance, input.currency),
        reference: null,
      },
      {
        key: 'average_expense',
        label: 'Chi tiêu trung bình / tháng',
        value: moneyText(averageExpense, input.currency),
        reference: `${expenseMonths.length} tháng có chi`,
      },
      {
        key: 'months_covered',
        label: 'Số tháng chi tiêu được dự phòng',
        value: `${round(monthsCovered, 1)} tháng`,
        reference: 'Mốc tham chiếu 3 tháng',
      },
      {
        key: 'accounts',
        label: 'Tài khoản được tính',
        value: String(input.accountsIncluded),
        reference: null,
      },
    ],
    missingData: [],
    limitations,
  };
}

/* ----------------------------- forecast risk ----------------------------- */

export function scoreForecastRisk(input: ForecastRiskInput): ScoredGroup {
  const limitations = [
    'Dự báo là thống kê từ quá khứ, không phải AI và không bảo đảm tương lai.',
    'Điểm tin cậy của dự báo không phải xác suất xảy ra.',
  ];

  if (
    input.status !== 'ok' ||
    input.net.status !== 'ok' ||
    input.net.base === null ||
    input.balance.status !== 'ok'
  ) {
    return {
      status: 'insufficient_data',
      score: null,
      explanation: 'Dự báo chưa đủ dữ liệu nên không chấm điểm rủi ro dự báo.',
      evidence:
        input.net.base === null
          ? []
          : [
              {
                key: 'forecast_net',
                label: 'Dòng tiền ròng dự báo',
                value: moneyText(input.net.base, input.currency),
                reference: null,
              },
            ],
      missingData: [
        input.reason === 'no_income'
          ? 'Chuỗi thu nhập chưa đủ dữ liệu để dự báo.'
          : 'Cần ít nhất 3 tháng đã kết thúc có dữ liệu và số dư tài khoản để chấm điểm.',
      ],
      limitations,
    };
  }

  const confidenceBase = round((input.income.confidenceScore + input.expense.confidenceScore) / 2);
  let score = confidenceBase;
  const penalties: string[] = [];
  if (input.net.base < 0) {
    score -= 25;
    penalties.push('dòng tiền ròng dự báo âm');
  }
  if (input.balance.projectedBalance !== null && input.balance.projectedBalance < 0) {
    score -= 25;
    penalties.push('số dư cuối tháng dự kiến âm');
  }
  score = clamp(round(score));

  const evidence: HealthEvidenceDto[] = [
    {
      key: 'forecast_net',
      label: 'Dòng tiền ròng dự báo',
      value: moneyText(input.net.base, input.currency),
      reference:
        input.net.best !== null && input.net.worst !== null
          ? `Dải sai số ${moneyText(input.net.worst, input.currency)} – ${moneyText(input.net.best, input.currency)}`
          : null,
    },
    {
      key: 'confidence',
      label: 'Điểm tin cậy dự báo',
      value: `${confidenceBase}/100`,
      reference: `${input.income.model ?? '—'} / ${input.expense.model ?? '—'}`,
    },
    {
      key: 'months_with_data',
      label: 'Số tháng dữ liệu dự báo',
      value: String(Math.min(input.income.monthsWithData, input.expense.monthsWithData)),
      reference: null,
    },
  ];
  if (input.balance.projectedBalance !== null) {
    evidence.push({
      key: 'projected_balance',
      label: 'Số dư cuối tháng dự kiến',
      value: moneyText(input.balance.projectedBalance, input.currency),
      reference: 'Giá trị dự báo, không phải số liệu thực tế',
    });
  }

  return {
    status: 'scored',
    score,
    explanation:
      `Điểm tin cậy dự báo trung bình ${confidenceBase}/100` +
      (penalties.length > 0
        ? `, trừ điểm vì ${penalties.join(' và ')}.`
        : ', không có dấu hiệu rủi ro âm.'),
    evidence,
    missingData: [],
    limitations,
  };
}

/* ------------------------------- combining ------------------------------- */

export function toHealthGroup(key: HealthGroupKey, scored: ScoredGroup): HealthGroupDto {
  const weight = HEALTH_WEIGHTS[key];
  return {
    key,
    label: HEALTH_GROUP_LABELS[key],
    weight,
    status: scored.status,
    score: scored.score,
    classification: classifyHealth(scored.score),
    contribution:
      scored.status === 'scored' && scored.score !== null
        ? round((scored.score * weight) / 100, 2)
        : null,
    explanation: scored.explanation,
    evidence: scored.evidence,
    missingData: scored.missingData,
    limitations: scored.limitations,
  };
}

export function combineHealthGroups(groups: HealthGroupDto[]): FinancialHealthOverallDto {
  const totalWeight = HEALTH_GROUP_ORDER.reduce((sum, key) => sum + HEALTH_WEIGHTS[key], 0);
  const scored = groups.filter((group) => group.status === 'scored' && group.score !== null);
  const availableWeight = scored.reduce((sum, group) => sum + group.weight, 0);

  if (scored.length < MIN_SCORED_GROUPS || availableWeight < MIN_OVERALL_WEIGHT) {
    const missing = groups
      .filter((group) => group.status !== 'scored')
      .map((group) => group.label)
      .join(', ');
    return {
      status: 'insufficient_data',
      score: null,
      classification: 'INSUFFICIENT_DATA',
      availableWeight,
      totalWeight,
      weightedScore: null,
      explanation:
        `Chưa tính điểm tổng: cần ít nhất ${MIN_SCORED_GROUPS} nhóm có dữ liệu và ` +
        `${MIN_OVERALL_WEIGHT}% trọng số (hiện có ${scored.length} nhóm, ${availableWeight}%).` +
        (missing ? ` Nhóm còn thiếu dữ liệu: ${missing}.` : ''),
    };
  }

  const weightedScore =
    scored.reduce((sum, group) => sum + (group.score ?? 0) * group.weight, 0) / availableWeight;
  const score = round(clamp(weightedScore));

  return {
    status: 'scored',
    score,
    classification: classifyHealth(score),
    availableWeight,
    totalWeight,
    weightedScore: round(weightedScore, 2),
    explanation:
      `Điểm tổng ${score}/100 = trung bình có trọng số của ${scored.length} nhóm có dữ liệu, ` +
      `trên ${availableWeight}% trọng số khả dụng (${HEALTH_CLASSIFICATION_LABELS[classifyHealth(score)]}).`,
  };
}

/* ---------------------------- recommendations ---------------------------- */

export interface RecommendationInput {
  currency: string;
  groups: HealthGroupDto[];
  cashFlow: CashFlowInput;
  budgets: BudgetHealthInput;
  savings: SavingsHealthInput;
  stability: StabilityInput;
  forecast: ForecastRiskInput;
}

const SEVERITY_ORDER: Record<HealthRecommendationSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function groupOf(groups: HealthGroupDto[], key: HealthGroupKey): HealthGroupDto | undefined {
  return groups.find((group) => group.key === key);
}

export function buildHealthRecommendations(input: RecommendationInput): HealthRecommendationDto[] {
  const recommendations: HealthRecommendationDto[] = [];
  const { currency } = input;

  /* cash flow */
  const cashFlow = groupOf(input.groups, 'cash-flow');
  if (cashFlow?.status === 'scored') {
    const dataMonths = input.cashFlow.months.filter((month) => month.hasTransactions);
    const totalIncome = dataMonths.reduce((sum, month) => sum + month.income, 0);
    const totalExpense = dataMonths.reduce((sum, month) => sum + month.expense, 0);
    const net = totalIncome - totalExpense;
    if (totalIncome > 0) {
      const rate = (net / totalIncome) * 100;
      if (rate < TARGET_SAVINGS_RATE) {
        const months = dataMonths.length;
        const averageIncome = totalIncome / months;
        const averageNet = net / months;
        const required = Math.max(0, (TARGET_SAVINGS_RATE / 100) * averageIncome - averageNet);
        recommendations.push({
          id: 'cash-flow-savings-rate',
          group: 'cash-flow',
          severity: (cashFlow.score ?? 0) < 50 ? 'high' : 'medium',
          title: `Tăng tỷ lệ tiết kiệm lên ${TARGET_SAVINGS_RATE}%`,
          detail: `Tỷ lệ tiết kiệm hiện tại là ${round(rate, 1)}% trên ${months} tháng có dữ liệu.`,
          evidence: [
            `Tỷ lệ tiết kiệm ${round(rate, 1)}%`,
            `Dòng tiền ròng trung bình ${moneyText(averageNet, currency)}/tháng`,
          ],
          impact: `Cần thêm khoảng ${moneyText(required, currency)} mỗi tháng (hoặc giảm chi tương ứng) để đạt ${TARGET_SAVINGS_RATE}%.`,
          confidence: months >= 6 ? 'high' : months >= 3 ? 'medium' : 'low',
          limitations: ['Mục tiêu dựa trên thu nhập trung bình quá khứ, không phải cam kết.'],
          module: 'transactions',
          requiresConfirmation: true,
        });
      }
    }
  }

  /* budget */
  const budget = groupOf(input.groups, 'budget');
  if (budget?.status !== 'scored') {
    recommendations.push({
      id: 'budget-not-configured',
      group: 'budget',
      severity: 'medium',
      title: 'Thiết lập ngân sách cho tháng này',
      detail: 'Chưa có ngân sách nào trong tháng nên nhóm Quản lý ngân sách chưa thể chấm điểm.',
      evidence: [],
      impact:
        'Có ngân sách giúp theo dõi hạn mức và bật nhóm điểm Quản lý ngân sách (20% trọng số).',
      confidence: 'high',
      limitations: [
        'Hạn mức ngân sách không lưu loại tiền; hệ thống hiểu theo loại tiền đang xem.',
      ],
      module: 'budgets',
      requiresConfirmation: true,
    });
  } else {
    const exceeded = input.budgets.items.filter((item) => item.status === 'EXCEEDED');
    const warning = input.budgets.items.filter((item) => item.status === 'WARNING');
    if (exceeded.length > 0) {
      const overspend = exceeded.reduce(
        (sum, item) => sum + Math.max(0, item.spent - item.limit),
        0,
      );
      recommendations.push({
        id: 'budget-exceeded',
        group: 'budget',
        severity: 'high',
        title: 'Đưa chi tiêu trở lại trong hạn mức',
        detail: `${exceeded.length} ngân sách đã vượt hạn mức: ${exceeded
          .slice(0, 3)
          .map((item) => item.name)
          .join(', ')}${exceeded.length > 3 ? '…' : ''}.`,
        evidence: exceeded.map(
          (item) =>
            `${item.name}: đã chi ${moneyText(item.spent, currency)} / hạn mức ${moneyText(item.limit, currency)}`,
        ),
        impact: `Giảm ít nhất ${moneyText(overspend, currency)} để đưa các ngân sách này về trong hạn mức.`,
        confidence: 'high',
        limitations: ['Chỉ xét ngân sách của tháng hiện tại.'],
        module: 'budgets',
        requiresConfirmation: true,
      });
    } else if (warning.length > 0) {
      const remaining = warning.reduce(
        (sum, item) => sum + Math.max(0, item.limit - item.spent),
        0,
      );
      recommendations.push({
        id: 'budget-warning',
        group: 'budget',
        severity: 'medium',
        title: 'Chú ý các ngân sách gần hạn mức',
        detail: `${warning.length} ngân sách đã chạm ngưỡng cảnh báo: ${warning
          .slice(0, 3)
          .map((item) => item.name)
          .join(', ')}.`,
        evidence: warning.map(
          (item) => `${item.name}: ${round(item.usagePercent ?? 0, 1)}% hạn mức`,
        ),
        impact: `Chỉ còn ${moneyText(remaining, currency)} trong hạn mức của các ngân sách này.`,
        confidence: 'high',
        limitations: ['Ngưỡng cảnh báo do người dùng đặt cho từng ngân sách.'],
        module: 'budgets',
        requiresConfirmation: true,
      });
    }
  }

  /* savings */
  const savings = groupOf(input.groups, 'savings');
  if (savings?.status !== 'scored') {
    recommendations.push({
      id: 'savings-no-goal',
      group: 'savings',
      severity: 'medium',
      title: 'Tạo mục tiêu tiết kiệm đầu tiên',
      detail: `Chưa có mục tiêu tiết kiệm nào bằng ${currency} để chấm điểm.`,
      evidence: [],
      impact:
        'Mục tiêu tiết kiệm bật nhóm Sức khỏe tiết kiệm (20% trọng số) và giúp theo dõi tiến độ.',
      confidence: 'high',
      limitations: ['Chỉ xét mục tiêu cùng loại tiền; mục tiêu đã lưu trữ bị loại.'],
      module: 'savings',
      requiresConfirmation: true,
    });
  } else {
    const overdue = input.savings.goals.filter((goal) => goal.progressStatus === 'OVERDUE');
    const atRisk = input.savings.goals.filter((goal) => goal.progressStatus === 'AT_RISK');
    const actionable = overdue.length > 0 ? overdue : atRisk;
    if (actionable.length > 0) {
      const required = actionable.reduce((sum, goal) => sum + (goal.requiredMonthlySaving ?? 0), 0);
      recommendations.push({
        id: overdue.length > 0 ? 'savings-overdue' : 'savings-at-risk',
        group: 'savings',
        severity: overdue.length > 0 ? 'high' : 'medium',
        title:
          overdue.length > 0
            ? 'Xử lý mục tiêu tiết kiệm quá hạn'
            : 'Điều chỉnh mục tiêu chậm tiến độ',
        detail: `${actionable.length} mục tiêu ${overdue.length > 0 ? 'đã quá hạn' : 'đang chậm tiến độ'}: ${actionable
          .slice(0, 3)
          .map((goal) => goal.name)
          .join(', ')}${actionable.length > 3 ? '…' : ''}.`,
        evidence: actionable.map(
          (goal) =>
            `${goal.name}: còn ${moneyText(goal.remainingAmount, currency)}` +
            (goal.requiredMonthlySaving === null
              ? ''
              : `, cần ${moneyText(goal.requiredMonthlySaving, currency)}/tháng`),
        ),
        impact:
          required > 0
            ? `Cần thêm khoảng ${moneyText(required, currency)} mỗi tháng cho các mục tiêu này.`
            : 'Xem lại hạn chót hoặc số tiền mục tiêu để có kế hoạch khả thi.',
        confidence: 'medium',
        limitations: [
          'Tiến độ dựa trên các khoản góp đã ghi nhận, không phải số dư thực tế của mục tiêu.',
        ],
        module: 'savings',
        requiresConfirmation: true,
      });
    }
  }

  /* stability */
  const stability = groupOf(input.groups, 'stability');
  if (stability?.status !== 'scored') {
    recommendations.push({
      id: 'stability-no-balance',
      group: 'stability',
      severity: 'low',
      title: 'Bổ sung tài khoản và chi tiêu để tính quỹ dự phòng',
      detail: 'Chưa đủ số dư tài khoản hoặc lịch sử chi tiêu để tính quỹ dự phòng.',
      evidence: [],
      impact:
        'Nhóm Ổn định tài chính (20% trọng số) cần số dư tài khoản và ít nhất một tháng có chi tiêu.',
      confidence: 'high',
      limitations: ['Chỉ dùng dữ liệu tài khoản và giao dịch đã ghi nhận.'],
      module: 'accounts',
      requiresConfirmation: true,
    });
  } else if ((stability.score ?? 0) < 70) {
    const expenseMonths = input.stability.months.filter(
      (month) => month.hasTransactions && month.expense > 0,
    );
    const averageExpense =
      expenseMonths.reduce((sum, month) => sum + month.expense, 0) / expenseMonths.length;
    const balance = input.stability.currentBalance ?? 0;
    const target = TARGET_EMERGENCY_MONTHS * averageExpense;
    const needed = Math.max(0, target - balance);
    recommendations.push({
      id: 'stability-emergency-fund',
      group: 'stability',
      severity: balance <= 0 ? 'high' : 'medium',
      title: `Tăng quỹ dự phòng lên ${TARGET_EMERGENCY_MONTHS} tháng chi tiêu`,
      detail:
        balance <= 0
          ? 'Số dư hiện tại âm hoặc bằng 0 nên chưa có quỹ dự phòng.'
          : `Số dư hiện tại tương đương ${round(balance / averageExpense, 1)} tháng chi tiêu trung bình.`,
      evidence: [
        `Số dư hiện tại ${moneyText(balance, currency)}`,
        `Chi tiêu trung bình ${moneyText(averageExpense, currency)}/tháng`,
      ],
      impact: `Cần thêm khoảng ${moneyText(needed, currency)} để đạt ${TARGET_EMERGENCY_MONTHS} tháng chi tiêu.`,
      confidence: 'medium',
      limitations: ['Không tính tài sản hoặc khoản nợ bên ngoài hệ thống.'],
      module: 'accounts',
      requiresConfirmation: true,
    });
  }

  /* forecast risk */
  const forecast = groupOf(input.groups, 'forecast-risk');
  if (forecast?.status !== 'scored') {
    recommendations.push({
      id: 'forecast-not-ready',
      group: 'forecast-risk',
      severity: 'low',
      title: 'Bổ sung dữ liệu để đánh giá rủi ro dự báo',
      detail: 'Dự báo chưa đủ dữ liệu nên nhóm Rủi ro dự báo chưa được chấm.',
      evidence: [],
      impact: 'Cần ít nhất 3 tháng đã kết thúc có dữ liệu để dự báo và chấm điểm.',
      confidence: 'high',
      limitations: ['Dự báo không dùng AI và không bảo đảm kết quả tương lai.'],
      module: 'analytics-forecast',
      requiresConfirmation: true,
    });
  } else if ((forecast.score ?? 0) < 70) {
    const negativeNet = input.forecast.net.base !== null && input.forecast.net.base < 0;
    const negativeBalance =
      input.forecast.balance.projectedBalance !== null &&
      input.forecast.balance.projectedBalance < 0;
    recommendations.push({
      id: negativeNet || negativeBalance ? 'forecast-negative' : 'forecast-low-confidence',
      group: 'forecast-risk',
      severity: negativeNet || negativeBalance ? 'high' : 'medium',
      title:
        negativeNet || negativeBalance
          ? 'Dòng tiền hoặc số dư dự báo đang âm'
          : 'Độ tin cậy dự báo còn thấp',
      detail:
        negativeNet || negativeBalance
          ? 'Dự báo tháng hiện tại cho thấy dòng tiền ròng hoặc số dư cuối tháng âm.'
          : 'Mô hình dự báo chưa có nhiều tháng dữ liệu hoặc sai số kiểm chứng chéo còn cao.',
      evidence: [
        input.forecast.net.base === null
          ? 'Chưa có dòng tiền ròng dự báo'
          : `Dòng tiền ròng dự báo ${moneyText(input.forecast.net.base, currency)}`,
        input.forecast.balance.projectedBalance === null
          ? 'Chưa có số dư cuối tháng dự kiến'
          : `Số dư cuối tháng dự kiến ${moneyText(input.forecast.balance.projectedBalance, currency)}`,
      ],
      impact:
        negativeNet || negativeBalance
          ? 'Điều chỉnh chi tiêu tháng này để tránh âm dòng tiền; đây là dự báo, không phải số liệu thực tế.'
          : 'Ghi nhận thêm tháng dữ liệu để mô hình dự báo ổn định hơn.',
      confidence: 'medium',
      limitations: ['Đây là dự báo thống kê, không phải AI và không phải cam kết.'],
      module: 'analytics-forecast',
      requiresConfirmation: true,
    });
  }

  return recommendations.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      HEALTH_GROUP_ORDER.indexOf(left.group) - HEALTH_GROUP_ORDER.indexOf(right.group) ||
      left.id.localeCompare(right.id),
  );
}
