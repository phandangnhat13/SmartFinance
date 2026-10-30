import {
  bucketByMonth,
  forecastSeries,
  horizonMonths,
  monthOf,
  monthsAfter,
  monthsEndingBefore,
  type MonthActual,
} from './forecast-engine';

function month(monthKey: string, income: number, expense: number): MonthActual {
  return { month: monthKey, income, expense, hasTransactions: true };
}

function empty(monthKey: string): MonthActual {
  return { month: monthKey, income: 0, expense: 0, hasTransactions: false };
}

describe('forecast engine — calendar helpers', () => {
  it('buckets an instant into the local month, not the UTC month', () => {
    // 18:00 UTC on 31 Jan is 01:00 on 1 Feb in Ho Chi Minh City (UTC+7).
    expect(monthOf(new Date('2025-01-31T18:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe('2025-02');
    expect(monthOf(new Date('2025-01-31T16:59:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe('2025-01');
    expect(monthOf('2025-01-31T18:00:00.000Z', 'UTC')).toBe('2025-01');
  });

  it('returns the complete months immediately before the current month', () => {
    expect(monthsEndingBefore('2025-03', 3)).toEqual(['2024-12', '2025-01', '2025-02']);
    expect(monthsEndingBefore('2025-01', 2)).toEqual(['2024-11', '2024-12']);
  });

  it('returns the months after a month across a year boundary', () => {
    expect(monthsAfter('2024-11', 3)).toEqual(['2024-12', '2025-01', '2025-02']);
  });

  it('resolves every horizon relative to the current month', () => {
    expect(horizonMonths('2025-06', 'current_month')).toEqual(['2025-06']);
    expect(horizonMonths('2025-06', '1m')).toEqual(['2025-07']);
    expect(horizonMonths('2025-06', '3m')).toEqual(['2025-07', '2025-08', '2025-09']);
    expect(horizonMonths('2025-11', '6m')).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });
});

describe('forecast engine — bucketing', () => {
  const months = ['2025-01', '2025-02', '2025-03'];

  it('sums income and expense per local month and records whether data exists', () => {
    const result = bucketByMonth(
      [
        { occurredAt: '2025-01-05T00:00:00.000Z', type: 'INCOME', amount: '100.10' },
        { occurredAt: '2025-01-20T00:00:00.000Z', type: 'EXPENSE', amount: '40.20' },
        { occurredAt: '2025-01-21T00:00:00.000Z', type: 'EXPENSE', amount: '9.70' },
        { occurredAt: '2025-02-01T00:00:00.000Z', type: 'INCOME', amount: '50' },
      ],
      'Asia/Ho_Chi_Minh',
      months,
    );

    expect(result).toEqual([
      { month: '2025-01', income: 100.1, expense: 49.9, hasTransactions: true },
      { month: '2025-02', income: 50, expense: 0, hasTransactions: true },
      { month: '2025-03', income: 0, expense: 0, hasTransactions: false },
    ]);
  });

  it('drops rows outside the window and non-finite amounts', () => {
    const result = bucketByMonth(
      [
        { occurredAt: '2024-12-31T00:00:00.000Z', type: 'EXPENSE', amount: '99' },
        { occurredAt: '2025-01-10T00:00:00.000Z', type: 'EXPENSE', amount: 'not-a-number' },
      ],
      'Asia/Ho_Chi_Minh',
      months,
    );
    expect(result.every((entry) => entry.income === 0 && entry.expense === 0)).toBe(true);
    // Both rows are unusable: one outside the window, one with a non-finite amount.
    expect(result.every((entry) => !entry.hasTransactions)).toBe(true);
  });
});

describe('forecast engine — history rules', () => {
  it('withholds a forecast when there are no complete months', () => {
    const result = forecastSeries([empty('2025-01')], 'expense', ['2025-02']);
    expect(result.status).toBe('insufficient_data');
    expect(result.reason).toBe('no_complete_months');
    expect(result.months).toEqual([]);
    expect(result.model).toBeNull();
  });

  it('withholds a forecast when fewer than three months have data', () => {
    const result = forecastSeries(
      [month('2025-01', 1_000, 500), month('2025-02', 1_000, 500), empty('2025-03')],
      'expense',
      ['2025-04'],
    );
    expect(result.status).toBe('insufficient_data');
    expect(result.reason).toBe('too_few_months');
    expect(result.monthsWithData).toBe(2);
    expect(result.months).toEqual([]);
  });

  it('withholds an income forecast when every recorded month has no income', () => {
    const result = forecastSeries(
      [month('2025-01', 0, 100), month('2025-02', 0, 100), month('2025-03', 0, 100)],
      'income',
      ['2025-04'],
    );
    expect(result.status).toBe('insufficient_data');
    expect(result.reason).toBe('no_income');
    expect(result.months).toEqual([]);
    expect(result.monthlyAverage).toBe(0);
  });

  it('ignores months without any transaction instead of treating them as zero', () => {
    const actuals = [
      month('2025-01', 1_000, 300),
      month('2025-02', 1_000, 300),
      month('2025-03', 1_000, 300),
      empty('2025-04'),
      empty('2025-05'),
      empty('2025-06'),
    ];
    const result = forecastSeries(actuals, 'expense', ['2025-07'], actuals.length);

    expect(result.status).toBe('ok');
    expect(result.monthsWithData).toBe(3);
    expect(result.monthlyAverage).toBe(300);
    expect(result.months).toEqual([{ month: '2025-07', amount: 300 }]);
    // Continuity 3/6 = 50% caps confidence even though the sample is clean.
    expect(result.confidence.level).not.toBe('high');
  });
});

describe('forecast engine — backtesting and model selection', () => {
  it('computes MAE and WAPE on rolling origins without using the target month', () => {
    const actuals = [
      month('2025-01', 1_000, 100),
      month('2025-02', 1_000, 100),
      month('2025-03', 1_000, 100),
      month('2025-04', 1_000, 200),
    ];
    const result = forecastSeries(actuals, 'expense', ['2025-05']);
    const average = result.scores.find((score) => score.model === 'historical_average');

    expect(average).toBeDefined();
    expect(average?.origins).toBe(1);
    expect(average?.mae).toBe(100);
    // MAE ÷ mean actual (200) × 100
    expect(average?.wapePercent).toBe(50);
    expect(result.model).toBe('historical_average');
  });

  it('selects the model with the lowest backtest MAE', () => {
    const actuals = [
      month('2025-01', 6_000, 100),
      month('2025-02', 6_000, 200),
      month('2025-03', 6_000, 300),
      month('2025-04', 6_000, 400),
      month('2025-05', 6_000, 500),
      month('2025-06', 6_000, 600),
    ];
    const result = forecastSeries(actuals, 'expense', ['2025-07']);

    expect(result.status).toBe('ok');
    expect(result.model).toBe('linear_trend');
    expect(result.scores.find((score) => score.model === 'linear_trend')?.mae).toBe(0);
    expect(result.months).toEqual([{ month: '2025-07', amount: 700 }]);
    expect(result.selectedBecause).toContain('thấp nhất');
    expect(result.confidence.level).toBe('high');
  });

  it('prefers the simplest model on an exact tie', () => {
    const actuals = [
      month('2025-01', 1_000, 100),
      month('2025-02', 1_000, 100),
      month('2025-03', 1_000, 100),
      month('2025-04', 1_000, 100),
    ];
    const result = forecastSeries(actuals, 'expense', ['2025-05']);
    expect(result.model).toBe('historical_average');
    expect(result.months).toEqual([{ month: '2025-05', amount: 100 }]);
  });

  it('falls back to the historical average when no model has two backtest origins', () => {
    const actuals = [
      month('2025-01', 1_000, 100),
      month('2025-02', 1_000, 100),
      month('2025-03', 1_000, 120),
    ];
    const result = forecastSeries(actuals, 'expense', ['2025-04']);
    expect(result.model).toBe('historical_average');
    expect(result.selectedBecause).toContain('Chưa đủ tháng');
    expect(result.scores.every((score) => score.origins === 0)).toBe(true);
  });

  it('never forecasts a negative amount', () => {
    const actuals = [
      month('2025-01', 1_000, 500),
      month('2025-02', 1_000, 400),
      month('2025-03', 1_000, 300),
      month('2025-04', 1_000, 200),
      month('2025-05', 1_000, 100),
      month('2025-06', 1_000, 50),
    ];
    const result = forecastSeries(actuals, 'expense', ['2025-07', '2025-12']);
    expect(result.status).toBe('ok');
    expect(result.months.every((entry) => entry.amount >= 0)).toBe(true);
  });

  it('handles volatile months and reports a lower confidence than stable data', () => {
    const stable = forecastSeries(
      [
        month('2025-01', 0, 1_000),
        month('2025-02', 0, 1_000),
        month('2025-03', 0, 1_000),
        month('2025-04', 0, 1_000),
        month('2025-05', 0, 1_000),
        month('2025-06', 0, 1_000),
      ],
      'expense',
      ['2025-07'],
    );
    const volatile = forecastSeries(
      [
        month('2025-01', 0, 100),
        month('2025-02', 0, 9_000),
        month('2025-03', 0, 200),
        month('2025-04', 0, 8_000),
        month('2025-05', 0, 300),
        month('2025-06', 0, 7_000),
      ],
      'expense',
      ['2025-07'],
    );

    expect(volatile.status).toBe('ok');
    expect(volatile.confidence.score).toBeLessThan(stable.confidence.score);
    expect(volatile.confidence.basis.length).toBeGreaterThan(0);
  });
});
