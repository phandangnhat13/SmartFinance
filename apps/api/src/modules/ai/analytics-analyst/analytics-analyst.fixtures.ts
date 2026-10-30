import type {
  AnalyticsBudgetsDto,
  AnalyticsCategoriesDto,
  AnalyticsCategoryRowDto,
  AnalyticsForecastDto,
  AnalyticsOverviewDto,
  AnalyticsTrendsDto,
  FinancialHealthDto,
  ForecastSeriesDto,
  HealthGroupDto,
  SavingsRecommendationsDto,
} from '@smart-finance/shared-types';

/**
 * Test fixtures for the AI financial analyst (M3e). Each builder returns a
 * complete DTO with the same figures the analytics services would produce for
 * a typical month, so the specs can assert on exact formatted values.
 */

const PERIOD = {
  kind: 'month' as const,
  label: 'Tháng 10/2026',
  from: '2026-10-01',
  to: '2026-10-31',
  status: 'in_progress' as const,
};

const PREVIOUS_PERIOD = {
  kind: 'month' as const,
  label: 'Tháng 9/2026',
  from: '2026-09-01',
  to: '2026-09-30',
  status: 'complete' as const,
};

export function overviewDto(overrides: Partial<AnalyticsOverviewDto> = {}): AnalyticsOverviewDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    period: PERIOD,
    income: '20000000.00',
    expense: '16000000.00',
    net: '4000000.00',
    savingsRate: 20,
    transactionCount: 37,
    hasTransactions: true,
    estimated: false,
    previous: {
      period: PREVIOUS_PERIOD,
      income: '18000000.00',
      expense: '15000000.00',
      net: '3000000.00',
      savingsRate: 16.67,
      transactionCount: 30,
      hasTransactions: true,
    },
    changes: {
      income: { amount: '2000000.00', percent: 11.11 },
      expense: { amount: '1000000.00', percent: 6.67 },
      net: { amount: '1000000.00', percent: 33.33 },
      savingsRatePoints: 3.33,
    },
    availableCurrencies: ['VND'],
    ...overrides,
  };
}

export function trendsDto(overrides: Partial<AnalyticsTrendsDto> = {}): AnalyticsTrendsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    rangeMonths: 3,
    estimated: false,
    points: [
      {
        month: '2026-08',
        monthStatus: 'complete',
        income: '19000000.00',
        expense: '17500000.00',
        net: '1500000.00',
        savingsRate: 7.89,
        transactionCount: 41,
        hasTransactions: true,
      },
      {
        month: '2026-09',
        monthStatus: 'complete',
        income: '18000000.00',
        expense: '15000000.00',
        net: '3000000.00',
        savingsRate: 16.67,
        transactionCount: 30,
        hasTransactions: true,
      },
      {
        month: '2026-10',
        monthStatus: 'in_progress',
        income: '20000000.00',
        expense: '16000000.00',
        net: '4000000.00',
        savingsRate: 20,
        transactionCount: 37,
        hasTransactions: true,
      },
    ],
    ...overrides,
  };
}

function categoryRow(overrides: Partial<AnalyticsCategoryRowDto>): AnalyticsCategoryRowDto {
  return {
    categoryId: 'cat-1',
    categoryName: 'Ăn uống',
    isArchived: false,
    total: '8000000.00',
    transactionCount: 14,
    sharePercent: 50,
    averageMonthly: '8000000.00',
    previousTotal: '7000000.00',
    changeAmount: '1000000.00',
    changePercent: 14.29,
    direction: 'increase',
    notableIncrease: false,
    isNew: false,
    isRemoved: false,
    rank: 1,
    ...overrides,
  };
}

export function categoriesDto(
  overrides: Partial<AnalyticsCategoriesDto> = {},
): AnalyticsCategoriesDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    type: 'EXPENSE',
    estimated: false,
    period: PERIOD,
    previousPeriod: PREVIOUS_PERIOD,
    total: '16000000.00',
    previousTotal: '15000000.00',
    hasTransactions: true,
    monthsInPeriod: 1,
    notableIncreasePercent: 25,
    categories: [
      categoryRow({}),
      categoryRow({
        categoryId: 'cat-2',
        categoryName: 'Di chuyển',
        total: '4000000.00',
        sharePercent: 25,
        transactionCount: 9,
        previousTotal: '4200000.00',
        changeAmount: '-200000.00',
        changePercent: -4.76,
        direction: 'decrease',
        rank: 2,
      }),
      categoryRow({
        categoryId: 'cat-3',
        categoryName: 'Mua sắm',
        total: '2500000.00',
        sharePercent: 15.63,
        transactionCount: 5,
        previousTotal: '0.00',
        changeAmount: '2500000.00',
        changePercent: null,
        direction: 'new',
        isNew: true,
        rank: 3,
      }),
    ],
    trend: null,
    ...overrides,
  };
}

export function budgetsDto(overrides: Partial<AnalyticsBudgetsDto> = {}): AnalyticsBudgetsDto {
  const base = {
    categoryId: null,
    categoryName: null,
    warningThreshold: 80,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    totalDays: 31,
    daysElapsed: 30,
    daysRemaining: 1,
    dailySpendingAverage: '80000.00',
    expectedSpend: '2400000.00',
    variance: '600000.00',
    pacePercent: 125,
    estimatedExhaustionDate: null,
    exhaustionProjection: 'already_exceeded' as const,
    transactionCount: 5,
  };
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2026-10',
    estimated: false,
    asOf: '2026-10-30',
    monthStatus: 'in_progress',
    assumesLimitCurrency: 'VND',
    summary: {
      budgetCount: 3,
      exceededCount: 1,
      warningCount: 1,
      onTrackCount: 1,
      notStartedCount: 0,
      completedCount: 0,
    },
    items: [
      {
        ...base,
        id: 'b-1',
        name: 'Mua sắm',
        limitAmount: '2500000.00',
        spent: '3000000.00',
        remaining: '-500000.00',
        usagePercent: 120,
        status: 'EXCEEDED',
      },
      {
        ...base,
        id: 'b-2',
        name: 'Ăn uống',
        limitAmount: '8000000.00',
        spent: '7000000.00',
        remaining: '1000000.00',
        usagePercent: 87.5,
        status: 'WARNING',
        estimatedExhaustionDate: '2026-11-06',
        exhaustionProjection: 'beyond_period',
        variance: '-1000000.00',
      },
      {
        ...base,
        id: 'b-3',
        name: 'Di chuyển',
        limitAmount: '4000000.00',
        spent: '2000000.00',
        remaining: '2000000.00',
        usagePercent: 50,
        status: 'ON_TRACK',
        estimatedExhaustionDate: null,
        exhaustionProjection: 'beyond_period',
        variance: '-1200000.00',
        pacePercent: 62.5,
      },
    ],
    ...overrides,
  };
}

function forecastSeries(kind: 'income' | 'expense', horizonTotal: string): ForecastSeriesDto {
  return {
    kind,
    status: 'ok',
    reason: null,
    model: 'historical_average',
    modelScores: [],
    selectedBecause: 'Mô hình có MAE thấp nhất trong backtest.',
    confidence: { level: 'high', score: 82, basis: ['3 tháng dữ liệu đầy đủ.'] },
    monthlyAverage: kind === 'income' ? '19000000.00' : '16000000.00',
    monthsWithData: 3,
    history: [
      {
        month: '2026-07',
        amount: kind === 'income' ? '19000000.00' : '17000000.00',
        hasTransactions: true,
      },
      {
        month: '2026-08',
        amount: kind === 'income' ? '19000000.00' : '17500000.00',
        hasTransactions: true,
      },
      {
        month: '2026-09',
        amount: kind === 'income' ? '18000000.00' : '15000000.00',
        hasTransactions: true,
      },
    ],
    months: [{ month: '2026-10', amount: horizonTotal, isPartial: true }],
    horizonTotal,
  };
}

export function forecastDto(overrides: Partial<AnalyticsForecastDto> = {}): AnalyticsForecastDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    horizon: 'current_month',
    horizonMonths: ['2026-10'],
    dataQuality: {
      completeMonthsConsidered: 3,
      monthsWithData: 3,
      missingMonths: [],
      transactionCount: 108,
      continuityPercent: 100,
      level: 'good',
    },
    assumptions: ['Dự báo dựa trên trung bình các tháng đã kết thúc.'],
    limitations: ['Không biết sự kiện bất thường trong tương lai.'],
    estimated: true,
    status: 'ok',
    reason: null,
    income: forecastSeries('income', '6000000.00'),
    expense: forecastSeries('expense', '5000000.00'),
    categoryForecasts: [],
    net: {
      status: 'ok',
      reason: null,
      model: 'historical_average',
      base: '1000000.00',
      best: '1500000.00',
      worst: '500000.00',
      bandMethod: 'mae',
    },
    monthEndBalance: {
      status: 'ok',
      reason: null,
      currentBalance: '8000000.00',
      remainingIncome: '6000000.00',
      remainingExpense: '5000000.00',
      projectedBalance: '9000000.00',
      accountsIncluded: 2,
      accountsArchived: 0,
      transfersNetted: true,
    },
    ...overrides,
  };
}

function healthGroup(overrides: Partial<HealthGroupDto>): HealthGroupDto {
  return {
    key: 'cash-flow',
    label: 'Dòng tiền',
    weight: 25,
    status: 'scored',
    score: 80,
    classification: 'GOOD',
    contribution: 20,
    explanation: 'Tỷ lệ tiết kiệm 20% trong kỳ.',
    evidence: [],
    missingData: [],
    limitations: [],
    ...overrides,
  };
}

export function healthDto(overrides: Partial<FinancialHealthDto> = {}): FinancialHealthDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    estimated: true,
    formula: 'Tổng = Σ(điểm nhóm × trọng số) ÷ trọng số khả dụng.',
    scoringRules: ['Nhóm thiếu dữ liệu không bị coi là 0 điểm.'],
    dataQuality: {
      level: 'good',
      monthsWithData: 3,
      completeMonthsConsidered: 3,
      transactionCount: 108,
      scoredGroups: 5,
      totalGroups: 5,
    },
    assumptions: ['Chỉ tính giao dịch đã ghi nhận.'],
    limitations: ['Điểm sức khỏe là chỉ báo tham khảo, không phải điểm tín dụng.'],
    overall: {
      status: 'scored',
      score: 71,
      classification: 'GOOD',
      availableWeight: 100,
      totalWeight: 100,
      weightedScore: 71,
      explanation: 'Điểm tổng trên toàn bộ trọng số.',
    },
    groups: [
      healthGroup({}),
      healthGroup({
        key: 'budget',
        label: 'Ngân sách',
        weight: 20,
        score: 60,
        contribution: 12,
        classification: 'FAIR',
      }),
      healthGroup({
        key: 'savings',
        label: 'Tiết kiệm',
        weight: 20,
        score: 70,
        contribution: 14,
        classification: 'GOOD',
      }),
      healthGroup({
        key: 'stability',
        label: 'Ổn định',
        weight: 20,
        score: 75,
        contribution: 15,
        classification: 'GOOD',
      }),
      healthGroup({
        key: 'forecast-risk',
        label: 'Rủi ro dự báo',
        weight: 15,
        score: 66,
        contribution: 9.9,
        classification: 'FAIR',
      }),
    ],
    recommendations: [
      {
        id: 'health-budget',
        group: 'budget',
        severity: 'high',
        title: 'Giữ chi tiêu trong hạn mức',
        detail: 'Một ngân sách đã vượt hạn mức trong tháng.',
        evidence: ['usagePercent'],
        impact: 'Có thể đưa nhóm Ngân sách lên mức tốt.',
        confidence: 'medium',
        limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
        module: 'budgets',
        requiresConfirmation: true,
      },
    ],
    historyAvailable: false,
    ...overrides,
  };
}

export function savingsDto(
  overrides: Partial<SavingsRecommendationsDto> = {},
): SavingsRecommendationsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    status: 'available',
    capacity: {
      status: 'available',
      reason: null,
      currency: 'VND',
      monthsAnalyzed: 3,
      analyzedMonths: ['2026-07', '2026-08', '2026-09'],
      averageMonthlyIncome: '19000000.00',
      averageMonthlyExpense: '16500000.00',
      averageNetCashFlow: '2500000.00',
      historicalSavingsRate: 13.16,
      safetyBufferPercent: 20,
      safetyBufferAmount: '500000.00',
      suggestedMonthlySaving: '2000000.00',
      isPositive: true,
      confidence: 'high',
    },
    monthlyBudget: '2000000.00',
    simulated: false,
    simulatedMonthlySaving: null,
    items: [
      {
        goalId: 'g1',
        goalName: 'Du lịch',
        currency: 'VND',
        displayStatus: 'ACTIVE',
        targetDate: '2027-06-30',
        monthsRemaining: 8,
        remainingAmount: '19000000.00',
        requiredMonthlySaving: '2375000.00',
        recommendedMonthlySaving: '1800000.00',
        estimatedCompletionDate: '2027-09-30',
        feasibility: 'AT_RISK',
        priority: 1,
        priorityReason: 'Hạn gần nhất.',
        explanation: 'Mức góp hiện tại chậm hơn kế hoạch.',
      },
    ],
    allocatedMonthly: '1800000.00',
    unallocatedMonthly: '200000.00',
    excluded: { paused: 0, completed: 0, archived: 0 },
    assumptions: ['Dùng dòng tiền trung bình 3 tháng.'],
    limitations: ['Không tính lạm phát.'],
    ...overrides,
  };
}
