import type { HealthGroupDto } from '@smart-finance/shared-types';
import {
  HEALTH_WEIGHTS,
  TARGET_SAVINGS_RATE,
  buildHealthRecommendations,
  classifyHealth,
  combineHealthGroups,
  scoreBudget,
  scoreCashFlow,
  scoreForecastRisk,
  scoreSavings,
  scoreStability,
  toHealthGroup,
  type BudgetHealthInput,
  type CashFlowInput,
  type ForecastRiskInput,
  type SavingsHealthInput,
  type StabilityInput,
} from './financial-health-engine';

function month(index: number, income: number, expense: number, hasTransactions = true) {
  return {
    month: `2026-${String(index).padStart(2, '0')}`,
    income,
    expense,
    hasTransactions,
  };
}

function cashFlowMonths(income: number, expense: number, count = 6) {
  return Array.from({ length: count }, (_, index) => month(index + 1, income, expense));
}

function group(key: Parameters<typeof toHealthGroup>[0], score: number | null): HealthGroupDto {
  return toHealthGroup(key, {
    status: score === null ? 'insufficient_data' : 'scored',
    score,
    explanation: `Nhóm ${key}`,
    evidence: [],
    missingData: score === null ? [`Thiếu dữ liệu ${key}`] : [],
    limitations: [],
  });
}

function forecast(overrides: Partial<ForecastRiskInput> = {}): ForecastRiskInput {
  return {
    currency: 'VND',
    status: 'ok',
    reason: null,
    income: {
      confidenceScore: 80,
      confidenceLevel: 'high',
      model: 'historical_average',
      monthsWithData: 6,
    },
    expense: {
      confidenceScore: 80,
      confidenceLevel: 'high',
      model: 'historical_average',
      monthsWithData: 6,
    },
    net: { status: 'ok', base: 1_000_000, best: 1_200_000, worst: 800_000 },
    balance: { status: 'ok', currentBalance: 10_000_000, projectedBalance: 11_000_000 },
    ...overrides,
  };
}

describe('financial health engine', () => {
  it('keeps the five configured weights summing to 100', () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('classifies scores at the documented thresholds', () => {
    expect(classifyHealth(null)).toBe('INSUFFICIENT_DATA');
    expect(classifyHealth(100)).toBe('EXCELLENT');
    expect(classifyHealth(85)).toBe('EXCELLENT');
    expect(classifyHealth(84)).toBe('GOOD');
    expect(classifyHealth(70)).toBe('GOOD');
    expect(classifyHealth(69)).toBe('FAIR');
    expect(classifyHealth(50)).toBe('FAIR');
    expect(classifyHealth(49)).toBe('NEEDS_ATTENTION');
    expect(classifyHealth(0)).toBe('NEEDS_ATTENTION');
  });

  describe('cash flow', () => {
    it('scores a stable 30% saving rate at full marks', () => {
      const result = scoreCashFlow({ months: cashFlowMonths(10_000_000, 7_000_000) }, 'VND');
      expect(result.status).toBe('scored');
      expect(result.score).toBe(100);
      expect(result.evidence.find((item) => item.key === 'savings_rate')?.value).toBe('30%');
      expect(result.explanation).toContain('6/6 tháng');
    });

    it('excludes months without transactions instead of treating them as zero', () => {
      const months = [
        month(1, 0, 0, false),
        month(2, 10_000_000, 7_000_000),
        month(3, 10_000_000, 7_000_000),
        month(4, 10_000_000, 7_000_000),
      ];
      const result = scoreCashFlow({ months }, 'VND');
      expect(result.status).toBe('scored');
      expect(result.score).toBe(100);
      expect(result.missingData.join(' ')).toContain('1 tháng');
    });

    it('withholds the score when there are no complete months', () => {
      const result = scoreCashFlow({ months: [month(1, 0, 0, false)] }, 'VND');
      expect(result.status).toBe('insufficient_data');
      expect(result.score).toBeNull();
      expect(result.missingData.length).toBeGreaterThan(0);
    });

    it('withholds the score when no month has income', () => {
      const result = scoreCashFlow({ months: cashFlowMonths(0, 2_000_000) }, 'VND');
      expect(result.status).toBe('insufficient_data');
      expect(result.score).toBeNull();
      expect(result.missingData.join(' ')).toContain('thu nhập');
    });

    it('gives a negative cash flow the lowest points but still scores it', () => {
      const result = scoreCashFlow({ months: cashFlowMonths(10_000_000, 12_000_000) }, 'VND');
      expect(result.status).toBe('scored');
      expect(result.score).toBe(20);
    });

    it('lowers the score when income is volatile', () => {
      const months = [month(1, 10_000_000, 0), month(2, 5_000_000, 0), month(3, 15_000_000, 0)];
      const result = scoreCashFlow({ months }, 'VND');
      expect(result.status).toBe('scored');
      expect(result.score).toBe(86);
      expect(result.evidence.find((item) => item.key === 'income_variation')?.value).toBe('40.8%');
    });
  });

  describe('budget', () => {
    const base: BudgetHealthInput = { month: '2026-10', currency: 'VND', items: [] };

    it('withholds the score when the month has no budgets', () => {
      const result = scoreBudget(base);
      expect(result.status).toBe('insufficient_data');
      expect(result.score).toBeNull();
      expect(result.missingData.join(' ')).toContain('ngân sách');
    });

    it('averages the per-budget state points', () => {
      const result = scoreBudget({
        ...base,
        items: [
          { id: '1', name: 'A', status: 'ON_TRACK', limit: 100, spent: 50, usagePercent: 50 },
          { id: '2', name: 'B', status: 'EXCEEDED', limit: 100, spent: 120, usagePercent: 120 },
          { id: '3', name: 'C', status: 'WARNING', limit: 100, spent: 90, usagePercent: 90 },
          { id: '4', name: 'D', status: 'COMPLETED', limit: 100, spent: 100, usagePercent: 100 },
        ],
      });
      // 100 + 0 + 50 + 100 = 250 / 4 = 62.5 → 63
      expect(result.status).toBe('scored');
      expect(result.score).toBe(63);
      expect(result.explanation).toContain('1 ngân sách vượt hạn mức');
    });

    it('treats not-started and completed budgets as healthy', () => {
      const result = scoreBudget({
        ...base,
        items: [
          { id: '1', name: 'A', status: 'NOT_STARTED', limit: 100, spent: 0, usagePercent: 0 },
          { id: '2', name: 'B', status: 'COMPLETED', limit: 100, spent: 80, usagePercent: 80 },
        ],
      });
      expect(result.score).toBe(100);
    });
  });

  describe('savings', () => {
    const input = (overrides: Partial<SavingsHealthInput> = {}): SavingsHealthInput => ({
      currency: 'VND',
      goals: [],
      archived: 0,
      ...overrides,
    });

    it('withholds the score when there is no goal in the currency', () => {
      const result = scoreSavings(input());
      expect(result.status).toBe('insufficient_data');
      expect(result.score).toBeNull();
    });

    it('excludes paused and insufficient goals from the average', () => {
      const result = scoreSavings(
        input({
          goals: [
            {
              goalId: '1',
              name: 'A',
              progressStatus: 'ON_TRACK',
              requiredMonthlySaving: 0,
              remainingAmount: 1_000_000,
            },
            {
              goalId: '2',
              name: 'B',
              progressStatus: 'OVERDUE',
              requiredMonthlySaving: 2_000_000,
              remainingAmount: 3_000_000,
            },
            {
              goalId: '3',
              name: 'C',
              progressStatus: 'PAUSED',
              requiredMonthlySaving: null,
              remainingAmount: 4_000_000,
            },
            {
              goalId: '4',
              name: 'D',
              progressStatus: 'INSUFFICIENT_DATA',
              requiredMonthlySaving: null,
              remainingAmount: 2_000_000,
            },
          ],
          archived: 1,
        }),
      );
      expect(result.score).toBe(50);
      expect(result.missingData.join(' ')).toContain('1 mục tiêu tạm dừng');
      expect(result.missingData.join(' ')).toContain('1 mục tiêu chưa đủ dữ liệu');
      expect(result.missingData.join(' ')).toContain('1 mục tiêu đã lưu trữ');
    });

    it('withholds the score when every goal lacks progress data', () => {
      const result = scoreSavings(
        input({
          goals: [
            {
              goalId: '1',
              name: 'A',
              progressStatus: 'INSUFFICIENT_DATA',
              requiredMonthlySaving: null,
              remainingAmount: 1_000_000,
            },
          ],
        }),
      );
      expect(result.status).toBe('insufficient_data');
      expect(result.score).toBeNull();
    });
  });

  describe('stability', () => {
    const expenseMonth = month(1, 0, 2_000_000);
    const stability = (currentBalance: number | null): StabilityInput => ({
      currency: 'VND',
      currentBalance,
      accountsIncluded: 2,
      months: [expenseMonth],
    });

    it('withholds the score without a balance or without expenses', () => {
      expect(scoreStability(stability(null)).score).toBeNull();
      expect(
        scoreStability({ ...stability(10_000_000), months: [month(1, 0, 0)] }).score,
      ).toBeNull();
    });

    it('maps emergency coverage to the documented points', () => {
      expect(scoreStability(stability(0)).score).toBe(0);
      expect(scoreStability(stability(-1_000_000)).score).toBe(0);
      expect(scoreStability(stability(1_000_000)).score).toBe(30);
      expect(scoreStability(stability(3_000_000)).score).toBe(55);
      expect(scoreStability(stability(6_000_000)).score).toBe(80);
      expect(scoreStability(stability(12_000_000)).score).toBe(100);
    });
  });

  describe('forecast risk', () => {
    it('withholds the score when the forecast is insufficient', () => {
      const result = scoreForecastRisk(
        forecast({
          status: 'insufficient_data',
          reason: 'too_few_months',
          net: { status: 'insufficient_data', base: null, best: null, worst: null },
          balance: { status: 'insufficient_data', currentBalance: null, projectedBalance: null },
        }),
      );
      expect(result.status).toBe('insufficient_data');
      expect(result.score).toBeNull();
      expect(result.missingData.length).toBeGreaterThan(0);
    });

    it('uses the average confidence and penalises a negative projection', () => {
      expect(scoreForecastRisk(forecast()).score).toBe(80);
      expect(
        scoreForecastRisk(
          forecast({ net: { status: 'ok', base: -1_000_000, best: null, worst: null } }),
        ).score,
      ).toBe(55);
      expect(
        scoreForecastRisk(
          forecast({
            balance: { status: 'ok', currentBalance: 1_000_000, projectedBalance: -1_000_000 },
          }),
        ).score,
      ).toBe(55);
      expect(
        scoreForecastRisk(
          forecast({
            net: { status: 'ok', base: -1_000_000, best: null, worst: null },
            balance: { status: 'ok', currentBalance: 1_000_000, projectedBalance: -1_000_000 },
          }),
        ).score,
      ).toBe(30);
    });
  });

  describe('overall score', () => {
    it('renormalises the weights over the scored groups', () => {
      const groups = [
        group('cash-flow', 100),
        group('budget', 80),
        group('savings', 60),
        group('stability', null),
        group('forecast-risk', null),
      ];
      const overall = combineHealthGroups(groups);
      expect(overall.status).toBe('scored');
      expect(overall.availableWeight).toBe(65);
      expect(overall.weightedScore).toBeCloseTo(81.54, 2);
      expect(overall.score).toBe(82);
      expect(overall.classification).toBe('GOOD');
    });

    it('withholds the total below three scored groups or 60% weight', () => {
      const tooFew = combineHealthGroups([
        group('cash-flow', 100),
        group('stability', 100),
        group('budget', null),
        group('savings', null),
        group('forecast-risk', null),
      ]);
      expect(tooFew.status).toBe('insufficient_data');
      expect(tooFew.score).toBeNull();
      expect(tooFew.classification).toBe('INSUFFICIENT_DATA');
      expect(tooFew.explanation).toContain('2 nhóm');

      const tooLight = combineHealthGroups([
        group('cash-flow', 100),
        group('budget', 100),
        group('savings', null),
        group('stability', null),
        group('forecast-risk', null),
      ]);
      expect(tooLight.status).toBe('insufficient_data');
      expect(tooLight.availableWeight).toBe(45);
    });

    it('never counts a missing group as zero in the weighted average', () => {
      const overall = combineHealthGroups([
        group('cash-flow', 100),
        group('budget', 100),
        group('savings', 100),
        group('stability', 100),
        group('forecast-risk', null),
      ]);
      expect(overall.availableWeight).toBe(85);
      expect(overall.score).toBe(100);
    });
  });

  describe('recommendations', () => {
    const cashFlow: CashFlowInput = { months: cashFlowMonths(10_000_000, 10_500_000, 3) };
    const budgets: BudgetHealthInput = {
      month: '2026-10',
      currency: 'VND',
      items: [
        {
          id: '1',
          name: 'Ăn uống',
          status: 'EXCEEDED',
          limit: 1_000_000,
          spent: 1_500_000,
          usagePercent: 150,
        },
      ],
    };
    const savings: SavingsHealthInput = {
      currency: 'VND',
      goals: [
        {
          goalId: '1',
          name: 'Du lịch',
          progressStatus: 'OVERDUE',
          requiredMonthlySaving: 1_000_000,
          remainingAmount: 3_000_000,
        },
      ],
      archived: 0,
    };
    const stability: StabilityInput = {
      currency: 'VND',
      currentBalance: 1_000_000,
      accountsIncluded: 1,
      months: [month(1, 0, 2_000_000)],
    };
    const risk = forecast({
      net: { status: 'ok', base: -1_000_000, best: null, worst: null },
      balance: { status: 'ok', currentBalance: 1_000_000, projectedBalance: -2_000_000 },
    });

    const groups = [
      toHealthGroup('cash-flow', scoreCashFlow(cashFlow, 'VND')),
      toHealthGroup('budget', scoreBudget(budgets)),
      toHealthGroup('savings', scoreSavings(savings)),
      toHealthGroup('stability', scoreStability(stability)),
      toHealthGroup('forecast-risk', scoreForecastRisk(risk)),
    ];

    it('derives every recommendation from real data and never applies it', () => {
      const recommendations = buildHealthRecommendations({
        currency: 'VND',
        groups,
        cashFlow,
        budgets,
        savings,
        stability,
        forecast: risk,
      });
      expect(recommendations.map((item) => item.id)).toEqual([
        'cash-flow-savings-rate',
        'budget-exceeded',
        'savings-overdue',
        'forecast-negative',
        'stability-emergency-fund',
      ]);
      expect(recommendations.map((item) => item.severity)).toEqual([
        'high',
        'high',
        'high',
        'high',
        'medium',
      ]);
      expect(recommendations.every((item) => item.requiresConfirmation)).toBe(true);
      expect(recommendations[0].impact).toContain(`${TARGET_SAVINGS_RATE}%`);
      expect(recommendations[0].impact).toContain('VND');
      expect(recommendations[1].impact).toContain('VND');
      expect(recommendations[4].impact).toContain('VND');
    });

    it('suggests enabling a missing group instead of scoring it zero', () => {
      const noGoals = { ...savings, goals: [] };
      const noBudgets = { ...budgets, items: [] };
      const recommendations = buildHealthRecommendations({
        currency: 'VND',
        groups: [
          toHealthGroup('cash-flow', scoreCashFlow(cashFlow, 'VND')),
          toHealthGroup('budget', scoreBudget(noBudgets)),
          toHealthGroup('savings', scoreSavings(noGoals)),
          toHealthGroup('stability', scoreStability(stability)),
          toHealthGroup('forecast-risk', scoreForecastRisk(risk)),
        ],
        cashFlow,
        budgets: noBudgets,
        savings: noGoals,
        stability,
        forecast: risk,
      });
      const ids = recommendations.map((item) => item.id);
      expect(ids).toContain('budget-not-configured');
      expect(ids).toContain('savings-no-goal');
    });
  });
});
