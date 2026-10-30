import type {
  AiEvidenceDto,
  AnalyticsAiCategoryFactDto,
  AnalyticsAiFactsDto,
  AnalyticsBudgetsDto,
  AnalyticsCategoriesDto,
  AnalyticsForecastDto,
  AnalyticsOverviewDto,
  AnalyticsTrendsDto,
  FinancialHealthDto,
  HealthGroupKey,
  SavingsRecommendationsDto,
} from '@smart-finance/shared-types';
import { findInventedNumbers } from '../savings-assistant/savings-context';
import { formatAmount, formatDateDisplay } from '../savings-assistant/savings-context';

/**
 * Structured, server-built analytics context for the AI financial analyst
 * (M3e).
 *
 * Every value is copied from the response of the service that owns the rule
 * (M3a overview/trends, M3b categories/budgets, M3c forecast, M3d health,
 * M2c savings plan). Nothing is recalculated here. The context is the only
 * thing sent to a model, and it deliberately contains no email, user id,
 * token, transaction description nor any per-transaction row.
 */

export interface AnalyticsAiTrendPoint {
  month: string;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  hasTransactions: boolean;
}

export interface AnalyticsAiCategoryFact {
  name: string;
  total: string;
  sharePercent: number;
  changePercent: number | null;
  direction: 'increase' | 'decrease' | 'new' | 'removed' | null;
}

export interface AnalyticsAiBudgetFact {
  name: string;
  status: string;
  limitAmount: string;
  spent: string;
  usagePercent: number | null;
}

export interface AnalyticsAiForecastFact {
  status: 'ok' | 'insufficient_data';
  horizon: string;
  horizonMonths: string[];
  incomeTotal: string | null;
  expenseTotal: string | null;
  netBase: string | null;
  projectedBalance: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  dataQuality: 'good' | 'limited' | 'insufficient';
}

export interface AnalyticsAiHealthFact {
  status: 'scored' | 'insufficient_data';
  score: number | null;
  classification: string;
  availableWeight: number;
  totalWeight: number;
  groups: Array<{
    key: HealthGroupKey;
    label: string;
    status: string;
    score: number | null;
    weight: number;
  }>;
  topRecommendation: { title: string; detail: string } | null;
}

export interface AnalyticsAiSavingsFact {
  capacityStatus: string;
  suggestedMonthlySaving: string | null;
  monthlyBudget: string | null;
  allocatedMonthly: string;
  activeGoalCount: number;
}

export interface AnalyticsAiContext {
  currency: string;
  timezone: string;
  generatedAt: string;
  overview: {
    periodLabel: string;
    periodFrom: string;
    periodTo: string;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    transactionCount: number;
    hasTransactions: boolean;
  };
  trends: { rangeMonths: number; points: AnalyticsAiTrendPoint[] } | null;
  categories: AnalyticsAiCategoryFact[];
  /** null: this request did not need budget data. */
  budgets: {
    month: string;
    count: number;
    exceeded: number;
    warning: number;
    onTrack: number;
    items: AnalyticsAiBudgetFact[];
  } | null;
  forecast: AnalyticsAiForecastFact | null;
  health: AnalyticsAiHealthFact | null;
  savings: AnalyticsAiSavingsFact | null;
  rules: string[];
  limitations: string[];
}

export interface AnalyticsAiContextInput {
  overview: AnalyticsOverviewDto;
  trends?: AnalyticsTrendsDto;
  categories?: AnalyticsCategoriesDto;
  budgets?: AnalyticsBudgetsDto;
  forecast?: AnalyticsForecastDto;
  health?: FinancialHealthDto;
  savings?: SavingsRecommendationsDto;
}

const CATEGORY_LIMIT = 5;
const BUDGET_ITEM_LIMIT = 5;

/** Builds the context. Pure and deterministic: the same inputs give the same object. */
export function buildAnalyticsAiContext(input: AnalyticsAiContextInput): AnalyticsAiContext {
  const { overview } = input;
  const currency = overview.currency;
  const limitations = new Set<string>([
    'Chỉ giao dịch thu nhập và chi tiêu được tính; giao dịch chuyển tiền nội bộ bị loại trừ.',
    'Không có quy đổi tỷ giá giữa các loại tiền; mỗi lần chỉ phân tích một loại tiền.',
    'Tháng không có giao dịch là "không có dữ liệu", không phải tháng chi tiêu bằng 0.',
    'Đây là thông tin tham khảo, không phải tư vấn đầu tư và không phải điểm tín dụng.',
  ]);
  input.forecast?.limitations.slice(0, 2).forEach((item) => limitations.add(item));
  input.health?.limitations.slice(0, 2).forEach((item) => limitations.add(item));
  input.savings?.limitations.slice(0, 1).forEach((item) => limitations.add(item));

  return {
    currency,
    timezone: overview.timezone,
    generatedAt: new Date().toISOString(),
    overview: {
      periodLabel: overview.period.label,
      periodFrom: overview.period.from,
      periodTo: overview.period.to,
      income: overview.income,
      expense: overview.expense,
      net: overview.net,
      savingsRate: overview.savingsRate,
      transactionCount: overview.transactionCount,
      hasTransactions: overview.hasTransactions,
    },
    trends: input.trends
      ? {
          rangeMonths: input.trends.rangeMonths,
          points: input.trends.points.map((point) => ({
            month: point.month,
            income: point.income,
            expense: point.expense,
            net: point.net,
            savingsRate: point.savingsRate,
            hasTransactions: point.hasTransactions,
          })),
        }
      : null,
    categories: (input.categories?.categories ?? [])
      .filter((row) => Number(row.total) > 0)
      .slice(0, CATEGORY_LIMIT)
      .map((row) => ({
        name: row.categoryName,
        total: row.total,
        sharePercent: row.sharePercent,
        changePercent: row.changePercent,
        direction: row.direction,
      })),
    budgets: input.budgets
      ? {
          month: input.budgets.month,
          count: input.budgets.summary.budgetCount,
          exceeded: input.budgets.summary.exceededCount,
          warning: input.budgets.summary.warningCount,
          onTrack: input.budgets.summary.onTrackCount,
          items: [...input.budgets.items]
            .sort((left, right) => Number(right.spent) - Number(left.spent))
            .slice(0, BUDGET_ITEM_LIMIT)
            .map((item) => ({
              name: item.name,
              status: item.status,
              limitAmount: item.limitAmount,
              spent: item.spent,
              usagePercent: item.usagePercent,
            })),
        }
      : null,
    forecast: input.forecast
      ? {
          status: input.forecast.status,
          horizon: input.forecast.horizon,
          horizonMonths: [...input.forecast.horizonMonths],
          incomeTotal: input.forecast.income.horizonTotal,
          expenseTotal: input.forecast.expense.horizonTotal,
          netBase: input.forecast.net.base,
          projectedBalance: input.forecast.monthEndBalance.projectedBalance,
          confidence: input.forecast.income.confidence.level,
          dataQuality: input.forecast.dataQuality.level,
        }
      : null,
    health: input.health
      ? {
          status: input.health.overall.status,
          score: input.health.overall.score,
          classification: input.health.overall.classification,
          availableWeight: input.health.overall.availableWeight,
          totalWeight: input.health.overall.totalWeight,
          groups: input.health.groups.map((group) => ({
            key: group.key,
            label: group.label,
            status: group.status,
            score: group.score,
            weight: group.weight,
          })),
          topRecommendation:
            input.health.recommendations.length > 0
              ? {
                  title: input.health.recommendations[0].title,
                  detail: input.health.recommendations[0].detail,
                }
              : null,
        }
      : null,
    savings: input.savings
      ? {
          capacityStatus: input.savings.capacity.status,
          suggestedMonthlySaving: input.savings.capacity.suggestedMonthlySaving,
          monthlyBudget: input.savings.monthlyBudget,
          allocatedMonthly: input.savings.allocatedMonthly,
          activeGoalCount: input.savings.items.length,
        }
      : null,
    rules: [
      'Mọi con số do hệ thống tính từ dữ liệu đã ghi nhận; AI không tính lại và không được thay đổi số.',
      'AI không có quyền tạo, sửa hoặc xóa giao dịch, ngân sách, mục tiêu, khoản góp hay số dư.',
      'Dự báo là ước tính thống kê từ các tháng đã kết thúc, không phải cam kết.',
    ],
    limitations: [...limitations],
  };
}

/** Facts returned next to every AI response, so the UI never hides the official figures. */
export function buildAnalyticsAiFacts(context: AnalyticsAiContext): AnalyticsAiFactsDto {
  const topCategories: AnalyticsAiCategoryFactDto[] = context.categories.map((category) => ({
    name: category.name,
    total: category.total,
    sharePercent: category.sharePercent,
  }));

  return {
    currency: context.currency,
    timezone: context.timezone,
    periodLabel: context.overview.periodLabel,
    periodFrom: context.overview.periodFrom,
    periodTo: context.overview.periodTo,
    income: context.overview.income,
    expense: context.overview.expense,
    net: context.overview.net,
    savingsRate: context.overview.savingsRate,
    transactionCount: context.overview.transactionCount,
    hasTransactions: context.overview.hasTransactions,
    monthsAnalyzed: context.trends?.rangeMonths ?? 0,
    topCategories,
    budgetCount: context.budgets?.count ?? null,
    budgetsExceeded: context.budgets?.exceeded ?? null,
    budgetsWarning: context.budgets?.warning ?? null,
    forecastStatus: context.forecast?.status ?? null,
    forecastNet: context.forecast?.netBase ?? null,
    forecastHorizon: (context.forecast?.horizon as AnalyticsAiFactsDto['forecastHorizon']) ?? null,
    healthStatus: context.health?.status ?? null,
    healthScore: context.health?.score ?? null,
    healthClassification:
      (context.health?.classification as AnalyticsAiFactsDto['healthClassification']) ?? null,
    savingsCapacity: context.savings?.suggestedMonthlySaving
      ? formatAmount(context.savings.suggestedMonthlySaving, context.currency)
      : null,
  };
}

export type AnalyticsEvidenceKey = string;

/**
 * Closed catalogue of facts the model may cite. Values are formatted here, so
 * the model can only choose which facts to reference, never what they say.
 */
export function analyticsEvidenceCatalog(
  context: AnalyticsAiContext,
): Record<AnalyticsEvidenceKey, AiEvidenceDto> {
  const { currency } = context;
  const catalog: Record<AnalyticsEvidenceKey, AiEvidenceDto> = {
    overview_period: {
      label: 'Kỳ phân tích',
      value: `${context.overview.periodLabel} (${context.overview.periodFrom} → ${context.overview.periodTo})`,
    },
    overview_income: {
      label: 'Thu nhập trong kỳ',
      value: formatAmount(context.overview.income, currency),
    },
    overview_expense: {
      label: 'Chi tiêu trong kỳ',
      value: formatAmount(context.overview.expense, currency),
    },
    overview_net: {
      label: 'Dòng tiền ròng trong kỳ',
      value: formatAmount(context.overview.net, currency),
    },
    savings_rate: {
      label: 'Tỷ lệ tiết kiệm trong kỳ',
      value:
        context.overview.savingsRate === null
          ? 'Chưa có thu nhập để tính tỷ lệ'
          : `${context.overview.savingsRate}%`,
    },
    transaction_count: {
      label: 'Số giao dịch trong kỳ',
      value: String(context.overview.transactionCount),
    },
  };

  if (context.trends) {
    const withData = context.trends.points.filter((point) => point.hasTransactions);
    catalog.trend_series = {
      label: 'Số tháng trong chuỗi xu hướng',
      value: `${context.trends.rangeMonths} tháng`,
    };
    if (withData.length > 0) {
      const best = withData.reduce((top, point) =>
        Number(point.net) > Number(top.net) ? point : top,
      );
      const worst = withData.reduce((bottom, point) =>
        Number(point.net) < Number(bottom.net) ? point : bottom,
      );
      catalog.trend_best_month = {
        label: 'Tháng có dòng tiền ròng cao nhất',
        value: `${best.month}: ${formatAmount(best.net, currency)}`,
      };
      catalog.trend_worst_month = {
        label: 'Tháng có dòng tiền ròng thấp nhất',
        value: `${worst.month}: ${formatAmount(worst.net, currency)}`,
      };
    }
  }

  context.categories.forEach((category, index) => {
    catalog[`category:${index + 1}`] = {
      label: `Danh mục chi tiêu #${index + 1} — ${category.name}`,
      value: `${formatAmount(category.total, currency)} (${category.sharePercent}% tổng chi)`,
    };
  });

  if (context.budgets) {
    catalog.budgets_summary = {
      label: 'Tổng quan ngân sách tháng',
      value:
        `${context.budgets.count} ngân sách: ${context.budgets.exceeded} vượt hạn mức, ` +
        `${context.budgets.warning} cảnh báo, ${context.budgets.onTrack} trong hạn mức`,
    };
    const worst = [...context.budgets.items].sort(
      (left, right) => (right.usagePercent ?? -1) - (left.usagePercent ?? -1),
    )[0];
    if (worst) {
      catalog.budget_worst = {
        label: `Ngân sách cần chú ý nhất — ${worst.name}`,
        value: `${worst.status} · đã dùng ${formatAmount(worst.spent, currency)} trên ${formatAmount(
          worst.limitAmount,
          currency,
        )}`,
      };
    }
  }

  if (context.forecast) {
    catalog.forecast_income = {
      label: 'Thu nhập dự báo (ước tính)',
      value: formatAmount(context.forecast.incomeTotal, currency),
    };
    catalog.forecast_expense = {
      label: 'Chi tiêu dự báo (ước tính)',
      value: formatAmount(context.forecast.expenseTotal, currency),
    };
    catalog.forecast_net = {
      label: 'Dòng tiền ròng dự báo (ước tính)',
      value: formatAmount(context.forecast.netBase, currency),
    };
    catalog.forecast_balance = {
      label: 'Số dư cuối tháng dự báo (ước tính)',
      value: formatAmount(context.forecast.projectedBalance, currency),
    };
    catalog.forecast_quality = {
      label: 'Chất lượng dữ liệu dự báo',
      value: `Mức ${context.forecast.dataQuality}; độ tin cậy ${
        context.forecast.confidence ?? 'chưa xác định'
      }`,
    };
  }

  if (context.health) {
    catalog.health_overall = {
      label: 'Điểm sức khỏe tài chính',
      value:
        context.health.status === 'scored' && context.health.score !== null
          ? `${context.health.score}/100 (${context.health.classification}) trên ${context.health.availableWeight}% trọng số khả dụng`
          : 'Chưa đủ dữ liệu để tính điểm tổng',
    };
    context.health.groups
      .filter((group) => group.status === 'scored' && group.score !== null)
      .forEach((group) => {
        catalog[`health:${group.key}`] = {
          label: `Nhóm ${group.label}`,
          value: `${group.score}/100 · trọng số ${group.weight}%`,
        };
      });
    if (context.health.topRecommendation) {
      catalog.health_recommendation = {
        label: 'Gợi ý ưu tiên từ điểm sức khỏe',
        value: `${context.health.topRecommendation.title}: ${context.health.topRecommendation.detail}`,
      };
    }
  }

  if (context.savings) {
    catalog.savings_capacity = {
      label: 'Mức tiết kiệm đề xuất mỗi tháng',
      value: formatAmount(context.savings.suggestedMonthlySaving, currency),
    };
    catalog.savings_plan = {
      label: 'Kế hoạch tiết kiệm tháng này',
      value:
        context.savings.monthlyBudget === null
          ? 'Chưa đủ dữ liệu để lập kế hoạch'
          : `${formatAmount(context.savings.allocatedMonthly, currency)} cho ${context.savings.activeGoalCount} mục tiêu`,
    };
  }

  return catalog;
}

export function analyticsEvidenceList(
  keys: readonly string[],
  catalog: Record<AnalyticsEvidenceKey, AiEvidenceDto>,
): AiEvidenceDto[] {
  return keys
    .map((key) => catalog[key])
    .filter((item): item is AiEvidenceDto => item !== undefined);
}

const VI_NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** Display-only formatting of a plain number; never used for arithmetic. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : VI_NUMBER.format(value);
}

/**
 * Every number the model is allowed to write: the context's own values, small
 * counts and calendar years. Formatted money ("10.000.000") is added in its
 * digit form so a model quoting a context amount is not rejected.
 */
export function collectAnalyticsNumbers(context: AnalyticsAiContext): Set<string> {
  const allowed = new Set<string>();
  for (let value = 0; value <= 120; value += 1) allowed.add(String(value));
  for (let year = 2000; year <= 2100; year += 1) allowed.add(String(year));

  const addString = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/^-?\d+(?:[.,]\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed.replace(',', '.'));
      if (Number.isFinite(numeric)) {
        allowed.add(String(numeric));
        allowed.add(trimmed.replace(/[^\d]/g, ''));
      }
    }
    // Numbers embedded in labels and formatted money, token by token, so a
    // value like "2.500.000 VND (15.63% tổng chi)" allows 15.63 and not just
    // its split digits.
    const tokens = trimmed.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?/g) ?? [];
    tokens.forEach((token) => {
      allowed.add(token.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''));
      const asFloat = Number(token.replace(/\./g, '').replace(',', '.'));
      if (Number.isFinite(asFloat)) allowed.add(String(asFloat));
    });
  };

  const walk = (value: unknown): void => {
    if (typeof value === 'number') {
      const raw = String(value);
      allowed.add(raw);
      // Decimal shares are matched by their digits too ("15.63" → "1563"),
      // because the text scanner strips separators before comparing.
      allowed.add(raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''));
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
 * result means the model invented a value, so the text is discarded and the
 * deterministic fallback is used instead.
 */
export function findAnalyticsInventedNumbers(text: string, allowed: Set<string>): string[] {
  return findInventedNumbers(text, allowed);
}

/** Display helper shared with prompts and fallbacks. */
export function formatDate(value: string | null): string {
  return formatDateDisplay(value);
}
