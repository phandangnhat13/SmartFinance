import { Prisma } from '@prisma/client';
import {
  buildRecommendations,
  computeCapacity,
  MAX_ANALYSIS_MONTHS,
  prioritizeGoals,
  SAFETY_BUFFER_PERCENT,
  sumRecommended,
  type MonthTotals,
  type RecommendationGoalInput,
} from './savings-recommendation';

const TODAY = '2026-10-30';

function month(overrides: Partial<MonthTotals> & { month: string }): MonthTotals {
  return {
    income: '0.00',
    expense: '0.00',
    hasTransactions: true,
    ...overrides,
  };
}

function goalInput(overrides: Partial<RecommendationGoalInput> = {}): RecommendationGoalInput {
  return {
    id: 'goal-1',
    name: 'Mua laptop',
    currency: 'VND',
    displayStatus: 'ACTIVE',
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    remaining: new Prisma.Decimal('24000000.00'),
    requiredMonthly: new Prisma.Decimal('3000000.00'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function budget(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('computeCapacity', () => {
  it('reports insufficient data when no completed month has transactions', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-09', hasTransactions: false }),
        month({ month: '2026-10', hasTransactions: false }),
      ],
      'VND',
    );

    expect(result).toMatchObject({
      status: 'insufficient_data',
      reason: 'no_complete_months',
      currency: 'VND',
      monthsAnalyzed: 0,
      analyzedMonths: [],
      averageMonthlyIncome: null,
      suggestedMonthlySaving: null,
      isPositive: false,
      confidence: 'low',
      safetyBufferPercent: SAFETY_BUFFER_PERCENT,
    });
  });

  it('does not treat a month without data as a zero-spend month', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-06' }),
        month({ month: '2026-07', hasTransactions: false }),
        month({ month: '2026-08', hasTransactions: false }),
        month({ month: '2026-09', hasTransactions: false }),
      ],
      'VND',
    );

    expect(result.status).toBe('insufficient_data');
    expect(result.monthsAnalyzed).toBe(1);
    expect(result.averageMonthlyExpense).toBeNull();
  });

  it('reports insufficient data when completed months have no recorded income', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-08', expense: '2000000.00' }),
        month({ month: '2026-09', expense: '1500000.00' }),
      ],
      'VND',
    );

    expect(result).toMatchObject({
      status: 'insufficient_data',
      reason: 'no_income',
      monthsAnalyzed: 2,
      averageMonthlyIncome: null,
      suggestedMonthlySaving: null,
    });
  });

  it('keeps a 20% safety buffer instead of suggesting the whole surplus', () => {
    const result = computeCapacity(
      [month({ month: '2026-09', income: '10000000.00', expense: '4000000.00' })],
      'VND',
    );

    expect(result).toMatchObject({
      status: 'available',
      reason: null,
      monthsAnalyzed: 1,
      analyzedMonths: ['2026-09'],
      averageMonthlyIncome: '10000000.00',
      averageMonthlyExpense: '4000000.00',
      averageNetCashFlow: '6000000.00',
      historicalSavingsRate: 60,
      safetyBufferPercent: SAFETY_BUFFER_PERCENT,
      safetyBufferAmount: '1200000.00',
      suggestedMonthlySaving: '4800000.00',
      isPositive: true,
      // A single month is not enough for high confidence.
      confidence: 'low',
    });
  });

  it('averages only the months that had transactions and keeps the list', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-07', income: '10000000.00', expense: '4000000.00' }),
        month({ month: '2026-08', hasTransactions: false }),
        month({ month: '2026-09', income: '8000000.00', expense: '2000000.00' }),
      ],
      'VND',
    );

    expect(result.monthsAnalyzed).toBe(2);
    expect(result.analyzedMonths).toEqual(['2026-07', '2026-09']);
    expect(result.averageMonthlyIncome).toBe('9000000.00');
    expect(result.averageMonthlyExpense).toBe('3000000.00');
    expect(result.averageNetCashFlow).toBe('6000000.00');
    expect(result.suggestedMonthlySaving).toBe('4800000.00');
    expect(result.confidence).toBe('medium');
  });

  it('counts a month with only one side of the ledger as a measured zero for the other side', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-08', income: '10000000.00' }),
        month({ month: '2026-09', expense: '2000000.00' }),
      ],
      'VND',
    );

    expect(result.averageMonthlyIncome).toBe('5000000.00');
    expect(result.averageMonthlyExpense).toBe('1000000.00');
    expect(result.averageNetCashFlow).toBe('4000000.00');
    expect(result.suggestedMonthlySaving).toBe('3200000.00');
  });

  it('reports no capacity when the average cash flow is not positive', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-08', income: '5000000.00', expense: '6000000.00' }),
        month({ month: '2026-09', income: '4000000.00', expense: '5000000.00' }),
      ],
      'VND',
    );

    expect(result).toMatchObject({
      status: 'no_capacity',
      reason: null,
      averageMonthlyIncome: '4500000.00',
      averageMonthlyExpense: '5500000.00',
      averageNetCashFlow: '-1000000.00',
      historicalSavingsRate: -22.22,
      suggestedMonthlySaving: '0.00',
      safetyBufferAmount: '0.00',
      isPositive: false,
      confidence: 'medium',
    });
  });

  it('reaches high confidence with three or more active months', () => {
    const result = computeCapacity(
      [
        month({ month: '2026-06', income: '10000000.00', expense: '5000000.00' }),
        month({ month: '2026-07', income: '10000000.00', expense: '5000000.00' }),
        month({ month: '2026-08', income: '10000000.00', expense: '5000000.00' }),
        month({ month: '2026-09', income: '10000000.00', expense: '5000000.00' }),
      ],
      'VND',
    );

    expect(result.monthsAnalyzed).toBe(4);
    expect(result.confidence).toBe('high');
    expect(result.suggestedMonthlySaving).toBe('4000000.00');
  });

  it('rounds the suggestion down so it never exceeds the measured surplus', () => {
    const result = computeCapacity([month({ month: '2026-09', income: '1000000.01' })], 'VND');

    expect(result.averageNetCashFlow).toBe('1000000.01');
    expect(result.suggestedMonthlySaving).toBe('800000.00');
    expect(result.safetyBufferAmount).toBe('200000.01');
  });

  it('analyses at most the months it is given, in a single currency', () => {
    const months = Array.from({ length: MAX_ANALYSIS_MONTHS }, (_, index) =>
      month({ month: `2026-0${index + 1}`, income: '1000000.00' }),
    );
    const result = computeCapacity(months, 'USD');

    expect(result.currency).toBe('USD');
    expect(result.monthsAnalyzed).toBe(MAX_ANALYSIS_MONTHS);
  });
});

describe('prioritizeGoals', () => {
  it('puts overdue goals first, then the nearest deadline, and undated goals last', () => {
    const ordered = prioritizeGoals([
      goalInput({ id: 'undated', name: 'Không hạn', targetDate: null, monthsRemaining: null }),
      goalInput({ id: 'later', name: 'Hạn xa', targetDate: '2028-01-01' }),
      goalInput({ id: 'sooner', name: 'Hạn gần', targetDate: '2027-01-01' }),
      goalInput({
        id: 'overdue',
        name: 'Quá hạn',
        targetDate: '2026-09-01',
        displayStatus: 'OVERDUE',
      }),
    ]);

    expect(ordered.map((goal) => goal.id)).toEqual(['overdue', 'sooner', 'later', 'undated']);
  });

  it('never ranks by amount: a large goal does not overtake an earlier deadline', () => {
    const ordered = prioritizeGoals([
      goalInput({
        id: 'big-later',
        targetDate: '2028-01-01',
        remaining: new Prisma.Decimal('500000000.00'),
      }),
      goalInput({
        id: 'small-sooner',
        targetDate: '2027-01-01',
        remaining: new Prisma.Decimal('1000000.00'),
      }),
    ]);

    expect(ordered.map((goal) => goal.id)).toEqual(['small-sooner', 'big-later']);
  });

  it('uses creation time and then the id as deterministic tie-breakers', () => {
    const ordered = prioritizeGoals([
      goalInput({ id: 'b', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      goalInput({ id: 'a', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      goalInput({ id: 'newer', createdAt: new Date('2026-06-01T00:00:00.000Z') }),
    ]);

    expect(ordered.map((goal) => goal.id)).toEqual(['a', 'b', 'newer']);
  });
});

describe('buildRecommendations', () => {
  it('allocates the required amount when the budget covers it', () => {
    const [item] = buildRecommendations([goalInput()], {
      budget: budget('5000000.00'),
      today: TODAY,
    });

    expect(item).toMatchObject({
      goalId: 'goal-1',
      priority: 1,
      remainingAmount: '24000000.00',
      requiredMonthlySaving: '3000000.00',
      recommendedMonthlySaving: '3000000.00',
      estimatedCompletionDate: '2027-06-30',
      feasibility: 'ON_TRACK',
    });
    expect(item.explanation).toContain('3.000.000 VND');
    expect(item.priorityReason).toContain('2027-06-30');
  });

  it('keeps the total allocation within the budget and leaves the rest unallocated', () => {
    const items = buildRecommendations(
      [
        goalInput({ id: 'first', name: 'Trước', requiredMonthly: budget('3000000.00') }),
        goalInput({
          id: 'second',
          name: 'Sau',
          targetDate: '2027-08-01',
          remaining: budget('20000000.00'),
          requiredMonthly: budget('5000000.00'),
        }),
      ],
      { budget: budget('5000000.00'), today: TODAY },
    );

    expect(items.map((item) => item.recommendedMonthlySaving)).toEqual([
      '3000000.00',
      '2000000.00',
    ]);
    expect(items[1].feasibility).toBe('AT_RISK');
    expect(items[1].estimatedCompletionDate).toBe('2027-08-30');
    expect(sumRecommended(items).toFixed(2)).toBe('5000000.00');
  });

  it('gives nothing to later goals once the budget is exhausted', () => {
    const items = buildRecommendations(
      [
        goalInput({ id: 'first', requiredMonthly: budget('4000000.00') }),
        goalInput({
          id: 'second',
          name: 'Sau',
          targetDate: '2027-08-01',
          remaining: budget('10000000.00'),
          requiredMonthly: budget('5000000.00'),
        }),
      ],
      { budget: budget('4000000.00'), today: TODAY },
    );

    expect(items[1]).toMatchObject({
      recommendedMonthlySaving: '0.00',
      estimatedCompletionDate: null,
      feasibility: 'NOT_FEASIBLE',
    });
    expect(items[1].explanation).toContain('đã được phân bổ hết');
    expect(sumRecommended(items).toFixed(2)).toBe('4000000.00');
  });

  it('marks an overdue goal as not feasible even when it receives money', () => {
    const [item] = buildRecommendations(
      [
        goalInput({
          id: 'overdue',
          displayStatus: 'OVERDUE',
          targetDate: '2026-09-01',
          monthsRemaining: 0,
          requiredMonthly: null,
          remaining: budget('6000000.00'),
        }),
      ],
      { budget: budget('2000000.00'), today: TODAY },
    );

    expect(item).toMatchObject({
      feasibility: 'NOT_FEASIBLE',
      recommendedMonthlySaving: '2000000.00',
      estimatedCompletionDate: '2027-01-30',
    });
    expect(item.explanation).toContain('Đã quá hạn từ 2026-09-01');
  });

  it('treats a goal without a deadline as on track and sized by the budget', () => {
    const [item] = buildRecommendations(
      [
        goalInput({
          targetDate: null,
          monthsRemaining: null,
          requiredMonthly: null,
          remaining: budget('12000000.00'),
        }),
      ],
      { budget: budget('3000000.00'), today: TODAY },
    );

    expect(item).toMatchObject({
      feasibility: 'ON_TRACK',
      recommendedMonthlySaving: '3000000.00',
      estimatedCompletionDate: '2027-02-28',
    });
    expect(item.explanation).toContain('Không đặt hạn chót');
  });

  it('marks every goal as insufficient data when there is no budget', () => {
    const items = buildRecommendations([goalInput()], { budget: null, today: TODAY });

    expect(items[0]).toMatchObject({
      feasibility: 'INSUFFICIENT_DATA',
      recommendedMonthlySaving: null,
      estimatedCompletionDate: null,
    });
    expect(sumRecommended(items).toFixed(2)).toBe('0.00');
  });

  it('keeps every goal not feasible when the capacity is zero', () => {
    const items = buildRecommendations([goalInput()], {
      budget: budget('0.00'),
      today: TODAY,
    });

    expect(items[0]).toMatchObject({
      feasibility: 'NOT_FEASIBLE',
      recommendedMonthlySaving: '0.00',
    });
  });

  it('does not allocate to a goal that is already fully funded', () => {
    const items = buildRecommendations(
      [
        goalInput({ id: 'full', remaining: budget('0.00'), requiredMonthly: budget('0.00') }),
        goalInput({ id: 'next', name: 'Tiếp theo', targetDate: '2027-01-01' }),
      ],
      { budget: budget('3000000.00'), today: TODAY },
    );

    expect(items[0]).toMatchObject({
      goalId: 'next',
      recommendedMonthlySaving: '3000000.00',
    });
    expect(items[1]).toMatchObject({
      goalId: 'full',
      recommendedMonthlySaving: '0.00',
      estimatedCompletionDate: TODAY,
      feasibility: 'ON_TRACK',
    });
  });

  it('sorts the returned items by priority', () => {
    const items = buildRecommendations(
      [
        goalInput({
          id: 'undated',
          targetDate: null,
          monthsRemaining: null,
          requiredMonthly: null,
        }),
        goalInput({ id: 'soon', name: 'Sớm', targetDate: '2027-01-01' }),
      ],
      { budget: budget('9000000.00'), today: TODAY },
    );

    expect(items.map((item) => [item.goalId, item.priority])).toEqual([
      ['soon', 1],
      ['undated', 2],
    ]);
  });
});
