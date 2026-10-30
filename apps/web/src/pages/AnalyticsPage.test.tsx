import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AnalyticsAiSummaryDto,
  AnalyticsBudgetPaceDto,
  AnalyticsBudgetsDto,
  AnalyticsCategoriesDto,
  AnalyticsExpenseDto,
  AnalyticsForecastDto,
  AnalyticsIncomeDto,
  AnalyticsOverviewDto,
  AnalyticsPeriodComparisonDto,
  AnalyticsTrendsDto,
  FinancialHealthDto,
  FinancialHealthHistoryDto,
  ForecastSeriesDto,
} from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMonthRange } from '../lib/date';
import { AnalyticsPage } from './AnalyticsPage';

// Recharts cannot measure a container in jsdom; the real charts are covered by
// the Playwright suite. Keeping the DOM tree small also makes the tables and
// cards easy to assert on.
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    BarChart: Container,
    ComposedChart: Container,
    Line: () => null,
    Bar: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', timezone: 'Asia/Ho_Chi_Minh', defaultCurrency: 'VND' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const CURRENT_MONTH = currentMonthRange('Asia/Ho_Chi_Minh').month;

function makeOverview(overrides: Partial<AnalyticsOverviewDto> = {}): AnalyticsOverviewDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    period: {
      kind: 'month',
      label: '2025-01',
      from: '2025-01-01',
      to: '2025-01-31',
      status: 'complete',
    },
    income: '5000000.00',
    expense: '2300000.00',
    net: '2700000.00',
    savingsRate: 54,
    transactionCount: 3,
    hasTransactions: true,
    estimated: false,
    previous: {
      period: {
        kind: 'month',
        label: '2024-12',
        from: '2024-12-01',
        to: '2024-12-31',
        status: 'complete',
      },
      income: '4000000.00',
      expense: '2000000.00',
      net: '2000000.00',
      savingsRate: 50,
      transactionCount: 2,
      hasTransactions: true,
    },
    changes: {
      income: { amount: '1000000.00', percent: 25 },
      expense: { amount: '300000.00', percent: 15 },
      net: { amount: '700000.00', percent: 35 },
      savingsRatePoints: 4,
    },
    availableCurrencies: ['VND', 'USD'],
    ...overrides,
  };
}

function makeTrends(overrides: Partial<AnalyticsTrendsDto> = {}): AnalyticsTrendsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 3,
    estimated: false,
    points: [
      {
        month: '2024-11',
        monthStatus: 'complete',
        income: '0.00',
        expense: '0.00',
        net: '0.00',
        savingsRate: null,
        transactionCount: 0,
        hasTransactions: false,
      },
      {
        month: '2024-12',
        monthStatus: 'complete',
        income: '4000000.00',
        expense: '2000000.00',
        net: '2000000.00',
        savingsRate: 50,
        transactionCount: 2,
        hasTransactions: true,
      },
      {
        month: '2025-01',
        monthStatus: 'complete',
        income: '5000000.00',
        expense: '2300000.00',
        net: '2700000.00',
        savingsRate: 54,
        transactionCount: 3,
        hasTransactions: true,
      },
    ],
    ...overrides,
  };
}

function makeIncome(overrides: Partial<AnalyticsIncomeDto> = {}): AnalyticsIncomeDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 3,
    estimated: false,
    points: [
      {
        month: '2024-11',
        monthStatus: 'complete',
        amount: '0.00',
        hasTransactions: false,
        changePercent: null,
      },
      {
        month: '2024-12',
        monthStatus: 'complete',
        amount: '4000000.00',
        hasTransactions: true,
        changePercent: null,
      },
      {
        month: '2025-01',
        monthStatus: 'complete',
        amount: '5000000.00',
        hasTransactions: true,
        changePercent: 25,
      },
    ],
    total: '9000000.00',
    averageMonthly: '4500000.00',
    monthsWithIncome: 2,
    highest: { month: '2025-01', amount: '5000000.00' },
    lowest: { month: '2024-12', amount: '4000000.00' },
    sources: [
      {
        categoryId: 'salary',
        categoryName: 'Lương',
        total: '9000000.00',
        sharePercent: 100,
        transactionCount: 2,
      },
    ],
    ...overrides,
  };
}

function makeExpense(overrides: Partial<AnalyticsExpenseDto> = {}): AnalyticsExpenseDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 3,
    estimated: false,
    points: [
      {
        month: '2024-11',
        monthStatus: 'complete',
        amount: '0.00',
        hasTransactions: false,
        changePercent: null,
      },
      {
        month: '2024-12',
        monthStatus: 'complete',
        amount: '2000000.00',
        hasTransactions: true,
        changePercent: null,
      },
      {
        month: '2025-01',
        monthStatus: 'complete',
        amount: '2300000.00',
        hasTransactions: true,
        changePercent: 15,
      },
    ],
    total: '4300000.00',
    averageMonthly: '2150000.00',
    monthsWithExpense: 2,
    highest: { month: '2025-01', amount: '2300000.00' },
    lowest: { month: '2024-12', amount: '2000000.00' },
    volatilityPercent: 6.98,
    longestIncreasingStreak: 1,
    currentIncreasingStreak: 1,
    ...overrides,
  };
}

function makeComparison(
  overrides: Partial<AnalyticsPeriodComparisonDto> = {},
): AnalyticsPeriodComparisonDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    estimated: false,
    current: {
      period: {
        kind: 'month',
        label: '2025-01',
        from: '2025-01-01',
        to: '2025-01-31',
        status: 'in_progress',
      },
      income: '5000000.00',
      expense: '2300000.00',
      net: '2700000.00',
      savingsRate: 54,
      transactionCount: 3,
      hasTransactions: true,
    },
    previous: {
      period: {
        kind: 'month',
        label: '2024-12',
        from: '2024-12-01',
        to: '2024-12-31',
        status: 'complete',
      },
      income: '4000000.00',
      expense: '2000000.00',
      net: '2000000.00',
      savingsRate: 50,
      transactionCount: 2,
      hasTransactions: true,
    },
    changes: {
      income: { amount: '1000000.00', percent: 25 },
      expense: { amount: '300000.00', percent: 15 },
      net: { amount: '700000.00', percent: 35 },
      savingsRatePoints: 4,
    },
    notableCategoryChanges: [
      {
        categoryId: 'food',
        categoryName: 'Ăn uống',
        currentTotal: '2000000.00',
        previousTotal: '1000000.00',
        changeAmount: '1000000.00',
        changePercent: 100,
        direction: 'increase',
      },
      {
        categoryId: 'transport',
        categoryName: 'Đi lại',
        currentTotal: '300000.00',
        previousTotal: '0.00',
        changeAmount: '300000.00',
        changePercent: null,
        direction: 'new',
      },
    ],
    ...overrides,
  };
}

function makeCategories(overrides: Partial<AnalyticsCategoriesDto> = {}): AnalyticsCategoriesDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    type: 'EXPENSE',
    estimated: false,
    period: {
      kind: 'month',
      label: '2025-01',
      from: '2025-01-01',
      to: '2025-01-31',
      status: 'complete',
    },
    previousPeriod: {
      kind: 'month',
      label: '2024-12',
      from: '2024-12-01',
      to: '2024-12-31',
      status: 'complete',
    },
    total: '2300000.00',
    previousTotal: '2000000.00',
    hasTransactions: true,
    monthsInPeriod: 1,
    notableIncreasePercent: 25,
    categories: [
      {
        categoryId: 'food',
        categoryName: 'Ăn uống',
        isArchived: false,
        total: '1500000.00',
        transactionCount: 2,
        sharePercent: 65.22,
        averageMonthly: '1500000.00',
        previousTotal: '1000000.00',
        changeAmount: '500000.00',
        changePercent: 50,
        direction: 'increase',
        notableIncrease: true,
        isNew: false,
        isRemoved: false,
        rank: 1,
      },
      {
        categoryId: 'transport',
        categoryName: 'Đi lại',
        isArchived: false,
        total: '500000.00',
        transactionCount: 1,
        sharePercent: 21.74,
        averageMonthly: '500000.00',
        previousTotal: '1000000.00',
        changeAmount: '-500000.00',
        changePercent: -50,
        direction: 'decrease',
        notableIncrease: false,
        isNew: false,
        isRemoved: false,
        rank: 2,
      },
      {
        categoryId: 'newcat',
        categoryName: 'Cà phê',
        isArchived: false,
        total: '300000.00',
        transactionCount: 1,
        sharePercent: 13.04,
        averageMonthly: '300000.00',
        previousTotal: '0.00',
        changeAmount: '300000.00',
        changePercent: null,
        direction: 'new',
        notableIncrease: false,
        isNew: true,
        isRemoved: false,
        rank: 3,
      },
      {
        categoryId: 'oldcat',
        categoryName: 'Đăng ký',
        isArchived: false,
        total: '0.00',
        transactionCount: 0,
        sharePercent: 0,
        averageMonthly: '0.00',
        previousTotal: '200000.00',
        changeAmount: '-200000.00',
        changePercent: -100,
        direction: 'removed',
        notableIncrease: false,
        isNew: false,
        isRemoved: true,
        rank: null,
      },
    ],
    trend: null,
    ...overrides,
  };
}

function makeBudgets(overrides: Partial<AnalyticsBudgetsDto> = {}): AnalyticsBudgetsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2025-01',
    estimated: false,
    asOf: '2025-01-31',
    monthStatus: 'complete',
    assumesLimitCurrency: 'VND',
    summary: {
      budgetCount: 2,
      exceededCount: 1,
      warningCount: 0,
      onTrackCount: 1,
      notStartedCount: 0,
      completedCount: 0,
    },
    items: [
      {
        id: 'b1',
        name: 'Tổng chi tháng 1',
        categoryId: null,
        categoryName: null,
        limitAmount: '3000000.00',
        spent: '3200000.00',
        remaining: '-200000.00',
        usagePercent: 106.67,
        status: 'EXCEEDED',
        warningThreshold: 80,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        totalDays: 31,
        daysElapsed: 31,
        daysRemaining: 0,
        dailySpendingAverage: '103225.81',
        expectedSpend: '3000000.00',
        variance: '200000.00',
        pacePercent: 106.67,
        estimatedExhaustionDate: null,
        exhaustionProjection: 'already_exceeded',
        transactionCount: 3,
      },
      {
        id: 'b2',
        name: 'Ăn uống tháng 1',
        categoryId: 'food',
        categoryName: 'Ăn uống',
        limitAmount: '2000000.00',
        spent: '1500000.00',
        remaining: '500000.00',
        usagePercent: 75,
        status: 'ON_TRACK',
        warningThreshold: 80,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        totalDays: 31,
        daysElapsed: 20,
        daysRemaining: 11,
        dailySpendingAverage: '75000.00',
        expectedSpend: '1290322.58',
        variance: '209677.42',
        pacePercent: 116.25,
        estimatedExhaustionDate: '2025-01-27',
        exhaustionProjection: 'within_period',
        transactionCount: 2,
      },
    ],
    ...overrides,
  };
}

function makeBudgetPace(overrides: Partial<AnalyticsBudgetPaceDto> = {}): AnalyticsBudgetPaceDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2025-01',
    estimated: false,
    asOf: '2025-01-31',
    items: [
      {
        budgetId: 'b1',
        name: 'Tổng chi tháng 1',
        categoryId: null,
        categoryName: null,
        status: 'EXCEEDED',
        limitAmount: '3000000.00',
        spent: '3200000.00',
        expectedSpend: '3000000.00',
        variance: '200000.00',
        pacePercent: 106.67,
        dailySpendingAverage: '103225.81',
        daysElapsed: 31,
        daysRemaining: 0,
        estimatedExhaustionDate: null,
        exhaustionProjection: 'already_exceeded',
      },
      {
        budgetId: 'b2',
        name: 'Ăn uống tháng 1',
        categoryId: 'food',
        categoryName: 'Ăn uống',
        status: 'ON_TRACK',
        limitAmount: '2000000.00',
        spent: '1500000.00',
        expectedSpend: '1290322.58',
        variance: '209677.42',
        pacePercent: 116.25,
        dailySpendingAverage: '75000.00',
        daysElapsed: 20,
        daysRemaining: 11,
        estimatedExhaustionDate: '2025-01-27',
        exhaustionProjection: 'within_period',
      },
    ],
    ...overrides,
  };
}

function forecastSeries(kind: 'income' | 'expense'): ForecastSeriesDto {
  return {
    kind,
    status: 'ok',
    reason: null,
    model: 'historical_average',
    modelScores: [
      {
        model: 'historical_average',
        eligible: true,
        reason: null,
        origins: 2,
        mae: '100.00',
        wapePercent: 5,
      },
    ],
    selectedBecause: 'Sai số thấp nhất.',
    confidence: { level: 'high', score: 80, basis: [] },
    monthlyAverage: kind === 'income' ? '5000000.00' : '2000000.00',
    monthsWithData: 6,
    history: [{ month: '2024-12', amount: '0.00', hasTransactions: false }],
    months: [
      {
        month: '2025-01',
        amount: kind === 'income' ? '1000000.00' : '500000.00',
        isPartial: true,
      },
    ],
    horizonTotal: kind === 'income' ? '1000000.00' : '500000.00',
  };
}

function makeForecast(overrides: Partial<AnalyticsForecastDto> = {}): AnalyticsForecastDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2025-01-31',
    generatedAt: '2025-01-31T03:00:00.000Z',
    horizon: 'current_month',
    horizonMonths: ['2025-01'],
    status: 'ok',
    reason: null,
    income: forecastSeries('income'),
    expense: forecastSeries('expense'),
    categoryForecasts: [],
    net: {
      status: 'ok',
      reason: null,
      model: 'historical_average',
      base: '500000.00',
      best: '400000.00',
      worst: '600000.00',
      bandMethod: 'mae',
    },
    monthEndBalance: {
      status: 'ok',
      reason: null,
      currentBalance: '3000000.00',
      remainingIncome: '1000000.00',
      remainingExpense: '500000.00',
      projectedBalance: '3500000.00',
      accountsIncluded: 1,
      accountsArchived: 0,
      transfersNetted: true,
    },
    dataQuality: {
      completeMonthsConsidered: 12,
      monthsWithData: 6,
      missingMonths: [],
      transactionCount: 20,
      continuityPercent: 50,
      level: 'limited',
    },
    assumptions: ['Không dùng AI/LLM.'],
    limitations: ['Không dự đoán sự kiện bất thường.'],
    estimated: true,
    ...overrides,
  };
}

function makeHealth(overrides: Partial<FinancialHealthDto> = {}): FinancialHealthDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2025-01-31',
    generatedAt: '2025-01-31T03:00:00.000Z',
    estimated: true,
    formula: 'Điểm tổng = Σ(điểm nhóm × trọng số) ÷ Σ(trọng số của các nhóm có dữ liệu).',
    scoringRules: ['Dòng tiền: tỷ lệ tiết kiệm 30% được 50 điểm.'],
    dataQuality: {
      level: 'good',
      monthsWithData: 6,
      completeMonthsConsidered: 12,
      transactionCount: 20,
      scoredGroups: 2,
      totalGroups: 2,
    },
    assumptions: ['Không dùng AI/LLM.'],
    limitations: ['Không có dữ liệu tài sản ngoài hệ thống.'],
    overall: {
      status: 'scored',
      score: 90,
      classification: 'EXCELLENT',
      availableWeight: 45,
      totalWeight: 100,
      weightedScore: 90,
      explanation: 'Điểm tổng 90/100 trên 45% trọng số khả dụng.',
    },
    groups: [
      {
        key: 'cash-flow',
        label: 'Sức khỏe dòng tiền',
        weight: 25,
        status: 'scored',
        score: 100,
        classification: 'EXCELLENT',
        contribution: 25,
        explanation: 'Tỷ lệ tiết kiệm 30%.',
        evidence: [],
        missingData: [],
        limitations: [],
      },
      {
        key: 'budget',
        label: 'Quản lý ngân sách',
        weight: 20,
        status: 'scored',
        score: 80,
        classification: 'GOOD',
        contribution: 16,
        explanation: '1 ngân sách gần hạn mức.',
        evidence: [],
        missingData: [],
        limitations: [],
      },
    ],
    recommendations: [],
    historyAvailable: false,
    ...overrides,
  };
}

function makeHealthHistory(
  overrides: Partial<FinancialHealthHistoryDto> = {},
): FinancialHealthHistoryDto {
  const cashFlow = makeHealth().groups[0];
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2025-01-31',
    generatedAt: '2025-01-31T03:00:00.000Z',
    method: 'recomputed',
    months: [
      {
        month: '2024-12',
        income: '5000000.00',
        expense: '2300000.00',
        net: '2700000.00',
        savingsRate: 54,
        hasTransactions: true,
        cashFlow,
        budget: { ...cashFlow, key: 'budget', label: 'Quản lý ngân sách', weight: 20 },
      },
    ],
    availableGroups: ['cash-flow', 'budget'],
    overall: null,
    limitations: ['Chỉ nhóm Dòng tiền và Ngân sách tái tạo được cho từng tháng.'],
    ...overrides,
  };
}

function makeAiSummary(overrides: Partial<AnalyticsAiSummaryDto> = {}): AnalyticsAiSummaryDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2025-01-31T03:00:00.000Z',
    source: 'FALLBACK',
    facts: {
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      periodLabel: '2025-01',
      periodFrom: '2025-01-01',
      periodTo: '2025-01-31',
      income: '5000000.00',
      expense: '2300000.00',
      net: '2700000.00',
      savingsRate: 54,
      transactionCount: 3,
      hasTransactions: true,
      monthsAnalyzed: 6,
      topCategories: [],
      budgetCount: 2,
      budgetsExceeded: 1,
      budgetsWarning: 0,
      forecastStatus: 'ok',
      forecastNet: '500000.00',
      forecastHorizon: 'current_month',
      healthStatus: 'scored',
      healthScore: 90,
      healthClassification: 'EXCELLENT',
      savingsCapacity: '4000000.00',
    },
    evidence: [],
    limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
    canModifyData: false,
    disclosure: {
      aiEnabled: false,
      provider: null,
      model: null,
      usedModel: false,
      fallbackReason: 'disabled',
      notice: 'AI đang tắt. Nội dung do quy tắc của hệ thống tạo ra từ dữ liệu thực của bạn.',
    },
    summary: 'Tóm tắt do quy tắc của hệ thống tạo ra từ dữ liệu đã ghi nhận.',
    highlights: [
      {
        title: 'Dòng tiền trong kỳ',
        body: 'Thu nhập và chi tiêu được tính từ giao dịch đã ghi nhận.',
        evidence: [],
      },
    ],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchHandler = (url: string) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return handler(url);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function installDataFetch(
  overrides: {
    overview?: () => AnalyticsOverviewDto;
    trends?: () => AnalyticsTrendsDto;
    income?: () => AnalyticsIncomeDto;
    expense?: () => AnalyticsExpenseDto;
    comparison?: () => AnalyticsPeriodComparisonDto;
    categories?: () => AnalyticsCategoriesDto;
    budgets?: () => AnalyticsBudgetsDto;
    budgetPace?: () => AnalyticsBudgetPaceDto;
    forecast?: () => AnalyticsForecastDto;
    health?: () => FinancialHealthDto;
    healthHistory?: () => FinancialHealthHistoryDto;
  } = {},
) {
  return installFetch((url) => {
    // The AI analyst panel loads its own summary; it is not part of the
    // deterministic analytics figures asserted by this suite.
    if (url.includes('/ai/analytics/summary')) return json(makeAiSummary());
    if (url.includes('/analytics/overview')) return json((overrides.overview ?? makeOverview)());
    if (url.includes('/analytics/trends')) return json((overrides.trends ?? makeTrends)());
    if (url.includes('/analytics/income')) return json((overrides.income ?? makeIncome)());
    if (url.includes('/analytics/expenses')) return json((overrides.expense ?? makeExpense)());
    if (url.includes('/analytics/period-comparison'))
      return json((overrides.comparison ?? makeComparison)());
    if (url.includes('/analytics/categories'))
      return json((overrides.categories ?? makeCategories)());
    if (url.includes('/analytics/budget-pace'))
      return json((overrides.budgetPace ?? makeBudgetPace)());
    if (url.includes('/analytics/budgets')) return json((overrides.budgets ?? makeBudgets)());
    if (url.includes('/analytics/forecast')) return json((overrides.forecast ?? makeForecast)());
    if (url.includes('/analytics/financial-health/history'))
      return json((overrides.healthHistory ?? makeHealthHistory)());
    if (url.includes('/analytics/financial-health'))
      return json((overrides.health ?? makeHealth)());
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderPage(initialEntry = '/analytics') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Only the active analytics tab is mounted. Switching tabs through the tab bar
 * is how these tests reach the other panels; deep links are exercised by the
 * tests that pass an explicit `?tab=` entry to {@link renderPage}.
 */
function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

function getCalls(mock: ReturnType<typeof installFetch>): string[] {
  return mock.mock.calls.map(([input]) => String(input));
}

function statCard(label: string): HTMLElement {
  const card = screen.getByText(label, { selector: 'p' }).closest('.card');
  if (!card) throw new Error(`No card found for ${label}`);
  return card as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnalyticsPage — loading and errors', () => {
  // Twelve parallel queries plus the charts and the health panel: give the
  // first render more room than the default 5s when the whole suite is running.
  it('shows a loading state, then every analysis area in its tab', async () => {
    installDataFetch();
    renderPage();

    expect(screen.getByText('Đang tính toán xu hướng...')).toBeInTheDocument();
    expect(await screen.findByText('So sánh với kỳ trước')).toBeInTheDocument();
    expect(screen.getByText('Sức khỏe tài chính')).toBeInTheDocument();
    expect(screen.getByText('Cách tính điểm')).toBeInTheDocument();
    expect(screen.getByText('Lịch sử điểm (tính lại)')).toBeInTheDocument();
    // Panels from unopened tabs are not mounted.
    expect(screen.queryByText('Thu nhập và chi tiêu theo tháng')).not.toBeInTheDocument();

    openTab('Danh mục');
    expect(await screen.findByText('Phân tích thu nhập')).toBeInTheDocument();
    expect(screen.getByText('Phân tích chi tiêu')).toBeInTheDocument();
    expect(screen.getByText('Phân tích theo danh mục')).toBeInTheDocument();
    expect(screen.getByText('Ngân sách tháng 01/2025')).toBeInTheDocument();

    openTab('Xu hướng');
    expect(await screen.findByText('Thu nhập và chi tiêu theo tháng')).toBeInTheDocument();
    expect(screen.getByText('Dòng tiền ròng theo tháng')).toBeInTheDocument();
    expect(screen.getByText('Giá trị dự báo, không phải số liệu thực tế')).toBeInTheDocument();

    openTab('Phân tích AI');
    expect(await screen.findByLabelText('Trợ lý phân tích AI')).toBeInTheDocument();
  }, 15_000);

  it('shows the API error and recovers after retrying', async () => {
    const user = userEvent.setup();
    let failing = true;
    const fetchMock = installFetch((url) => {
      // The analyst panel has its own error surface; keep it out of this test so
      // the page-level error stays the only "Lỗi máy chủ" on screen.
      if (url.includes('/ai/analytics/summary')) return json(makeAiSummary());
      if (failing) {
        return json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500);
      }
      if (url.includes('/analytics/overview')) return json(makeOverview());
      if (url.includes('/analytics/trends')) return json(makeTrends());
      if (url.includes('/analytics/income')) return json(makeIncome());
      if (url.includes('/analytics/expenses')) return json(makeExpense());
      if (url.includes('/analytics/categories')) return json(makeCategories());
      if (url.includes('/analytics/budget-pace')) return json(makeBudgetPace());
      if (url.includes('/analytics/budgets')) return json(makeBudgets());
      if (url.includes('/analytics/forecast')) return json(makeForecast());
      if (url.includes('/analytics/financial-health/history')) return json(makeHealthHistory());
      if (url.includes('/analytics/financial-health')) return json(makeHealth());
      return json(makeComparison());
    });
    renderPage();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('So sánh với kỳ trước')).toBeInTheDocument();
    // Only the overview tab was opened: overview, comparison and the two health
    // requests are retried, not the queries of tabs that were never visited.
    await waitFor(() => expect(getCalls(fetchMock).length).toBeGreaterThanOrEqual(8));
    expect(getCalls(fetchMock).some((url) => url.includes('/analytics/trends?'))).toBe(false);
  });
});

describe('AnalyticsPage — overview', () => {
  it('renders totals, changes, transaction count and the period status', async () => {
    installDataFetch();
    renderPage();

    await screen.findByText('So sánh với kỳ trước');

    const income = statCard('Thu nhập');
    expect(within(income).getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(within(income).getByText(/\+25\.0%/)).toBeInTheDocument();

    const expense = statCard('Chi tiêu');
    expect(within(expense).getByText(/2\.300\.000/)).toBeInTheDocument();
    expect(within(expense).getByText(/\+15\.0%/)).toBeInTheDocument();

    const net = statCard('Dòng tiền ròng');
    expect(within(net).getByText(/2\.700\.000/)).toBeInTheDocument();
    expect(within(net).getByText(/\+700\.000/)).toBeInTheDocument();

    const savings = statCard('Tỷ lệ tiết kiệm');
    expect(within(savings).getByText('54.0%')).toBeInTheDocument();
    expect(within(savings).getByText(/\+\d+\.\d điểm %/)).toBeInTheDocument();

    expect(within(statCard('Số giao dịch')).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Kỳ hiện tại: đã kết thúc')).toBeInTheDocument();
    expect(screen.getAllByText(/Kỳ 2025-01/).length).toBeGreaterThan(0);
  });

  it('distinguishes "no data" months from measured zero months', async () => {
    installDataFetch();
    renderPage();

    await screen.findByText('So sánh với kỳ trước');

    // 11/2024 has no transactions; the trend table says so, and so do both
    // breakdown tables on the categories tab.
    openTab('Xu hướng');
    await screen.findByText('Thu nhập và chi tiêu theo tháng');
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('11/2024').length).toBeGreaterThanOrEqual(1);

    openTab('Danh mục');
    await screen.findByText('Phân tích thu nhập');
    expect(screen.getAllByText('Không có dữ liệu').length).toBeGreaterThanOrEqual(2);
  });

  it('shows income sources, expense volatility and descriptive wording', async () => {
    installDataFetch();
    renderPage();

    await screen.findByText('So sánh với kỳ trước');
    openTab('Danh mục');
    await screen.findByText('Phân tích thu nhập');

    expect(screen.getByText('Cơ cấu nguồn thu theo danh mục')).toBeInTheDocument();
    expect(screen.getByText('Lương')).toBeInTheDocument();
    expect(screen.getByText(/100\.0% tổng thu · 2 giao dịch/)).toBeInTheDocument();
    expect(screen.getByText(/Mức biến động/)).toBeInTheDocument();
    expect(screen.getByText('6.98%')).toBeInTheDocument();
    expect(screen.getByText(/không kết luận về thói quen chi tiêu của bạn/)).toBeInTheDocument();
  });

  it('shows the previous-period baseline warning and category changes', async () => {
    installDataFetch({
      comparison: () =>
        makeComparison({
          previous: {
            period: {
              kind: 'month',
              label: '2024-12',
              from: '2024-12-01',
              to: '2024-12-31',
              status: 'complete',
            },
            income: '0.00',
            expense: '0.00',
            net: '0.00',
            savingsRate: null,
            transactionCount: 0,
            hasTransactions: false,
          },
          changes: {
            income: { amount: '5000000.00', percent: null },
            expense: { amount: '2300000.00', percent: null },
            net: { amount: '2700000.00', percent: null },
            savingsRatePoints: null,
          },
        }),
    });
    renderPage();

    await screen.findByText('So sánh với kỳ trước');
    expect(screen.getByText(/chưa có giao dịch thu hoặc chi/)).toBeInTheDocument();
    expect(screen.getAllByText('Ăn uống').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tăng').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đi lại').length).toBeGreaterThan(0);
    expect(screen.getByText('Chi tiêu mới')).toBeInTheDocument();
  });

  it('shows an empty state when neither the period nor the previous one has data', async () => {
    const emptySide = {
      period: {
        kind: 'month' as const,
        label: '2025-01',
        from: '2025-01-01',
        to: '2025-01-31',
        status: 'complete' as const,
      },
      income: '0.00',
      expense: '0.00',
      net: '0.00',
      savingsRate: null,
      transactionCount: 0,
      hasTransactions: false,
    };
    installDataFetch({
      overview: () =>
        makeOverview({
          income: '0.00',
          expense: '0.00',
          net: '0.00',
          savingsRate: null,
          transactionCount: 0,
          hasTransactions: false,
          previous: { ...emptySide, period: { ...emptySide.period, label: '2024-12' } },
        }),
    });
    renderPage();

    expect(await screen.findByText(/Chưa có giao dịch thu hoặc chi trong kỳ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Thêm giao dịch/ })).toHaveAttribute(
      'href',
      '/transactions/new',
    );
  });
});

describe('AnalyticsPage — categories and budgets', () => {
  it('shows category change badges and budget utilization with pace', async () => {
    installDataFetch();
    renderPage('/analytics?tab=categories');

    await screen.findByText('Phân tích theo danh mục');

    expect(screen.getByText('Tăng ≥ 25%')).toBeInTheDocument();
    expect(screen.getByText('Mới')).toBeInTheDocument();
    expect(screen.getByText('Không còn')).toBeInTheDocument();
    expect(screen.getByText(/hai danh mục trùng tên vẫn được tính riêng/)).toBeInTheDocument();

    expect(screen.getByText('Vượt hạn mức')).toBeInTheDocument();
    expect(screen.getByText('Trong mức')).toBeInTheDocument();
    expect(screen.getByText(/Hạn mức đã được sử dụng hết hoặc vượt/)).toBeInTheDocument();
    expect(screen.getByText(/hạn mức sẽ hết vào khoảng 27\/01\/2025/)).toBeInTheDocument();
    expect(screen.getByText(/hạn mức được đọc theo VND/i)).toBeInTheDocument();
  });

  it('switches between expense and income categories', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage('/analytics?tab=categories');
    await screen.findByText('Phân tích theo danh mục');

    await user.selectOptions(screen.getByLabelText('Danh mục thu / chi'), 'INCOME');
    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) => url.includes('/analytics/categories?') && url.includes('type=INCOME'),
        ),
      ).toBe(true),
    );
  });

  it('requests the monthly trend only for the selected category', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage('/analytics?tab=categories');
    await screen.findByText('Phân tích theo danh mục');

    await user.selectOptions(screen.getByLabelText('Danh mục xem xu hướng'), 'food');
    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) =>
            url.includes('/analytics/categories?') &&
            url.includes('categoryId=food') &&
            url.includes('months=6'),
        ),
      ).toBe(true),
    );
  });

  it('scopes budget analysis to the last month of the selected period', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage('/analytics?tab=categories');
    await screen.findByText('Ngân sách tháng 01/2025');

    await user.selectOptions(screen.getByLabelText('Kỳ phân tích'), 'quarter');
    const quarter = Math.ceil(Number(CURRENT_MONTH.slice(5, 7)) / 3);
    const quarterEndMonth = `${CURRENT_MONTH.slice(0, 4)}-${String(quarter * 3).padStart(2, '0')}`;
    // An ongoing quarter is anchored at the current month, never in the future.
    const expectedMonth = quarterEndMonth > CURRENT_MONTH ? CURRENT_MONTH : quarterEndMonth;

    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) =>
            url.includes('/analytics/budgets?') &&
            url.includes(`month=${expectedMonth}`) &&
            url.includes('currency=VND'),
        ),
      ).toBe(true),
    );
  });
});

describe('AnalyticsPage — filters', () => {
  it('requests the current month by default and re-requests on currency switch', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage();
    await screen.findByText('So sánh với kỳ trước');

    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) =>
            url.includes('/analytics/overview?') &&
            url.includes('period=month') &&
            url.includes(`month=${CURRENT_MONTH}`) &&
            url.includes('currency=VND'),
        ),
      ).toBe(true),
    );
    // The trends query only exists once its tab has been opened.
    expect(getCalls(fetchMock).some((url) => url.includes('/analytics/trends?'))).toBe(false);
    openTab('Xu hướng');
    await screen.findByText('Thu nhập và chi tiêu theo tháng');
    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) =>
            url.includes('/analytics/trends?') &&
            url.includes('months=6') &&
            url.includes(`month=${CURRENT_MONTH}`),
        ),
      ).toBe(true),
    );

    await user.selectOptions(screen.getByLabelText('Tiền tệ'), 'USD');
    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) => url.includes('/analytics/overview?') && url.includes('currency=USD'),
        ),
      ).toBe(true),
    );
  });

  it('switches the chart window to 12 months', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage('/analytics?tab=trends');
    await screen.findByText('Thu nhập và chi tiêu theo tháng');

    await user.selectOptions(screen.getByLabelText('Khoảng biểu đồ & phân tích tháng'), '12');
    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) => url.includes('/analytics/trends?') && url.includes('months=12'),
        ),
      ).toBe(true),
    );
  });

  it('requests a quarter comparison when the period kind changes', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage();
    await screen.findByText('So sánh với kỳ trước');

    await user.selectOptions(screen.getByLabelText('Kỳ phân tích'), 'quarter');
    const quarter = `${CURRENT_MONTH.slice(0, 4)}-Q${Math.ceil(
      Number(CURRENT_MONTH.slice(5, 7)) / 3,
    )}`;

    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) =>
            url.includes('/analytics/period-comparison?') &&
            url.includes('period=quarter') &&
            url.includes(`quarter=${quarter}`),
        ),
      ).toBe(true),
    );
  });

  it('requests the forecast for the selected horizon', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage('/analytics?tab=trends');
    await screen.findByText('Dự báo tài chính');

    await user.selectOptions(screen.getByLabelText('Khoảng dự báo'), '3m');

    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) => url.includes('/analytics/forecast?') && url.includes('horizon=3m'),
        ),
      ).toBe(true),
    );
  });

  it('blocks requests and explains an invalid custom range', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage();
    await screen.findByText('So sánh với kỳ trước');

    await user.selectOptions(screen.getByLabelText('Kỳ phân tích'), 'custom');
    await waitFor(() =>
      expect(getCalls(fetchMock).some((url) => url.includes('period=custom'))).toBe(true),
    );
    const callsBefore = getCalls(fetchMock).length;

    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2000-01-01' } });

    expect(await screen.findByText(/Khoảng ngày chưa hợp lệ/)).toBeInTheDocument();
    expect(getCalls(fetchMock).length).toBe(callsBefore);
  });
});
