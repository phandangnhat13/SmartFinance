import { Prisma } from '@prisma/client';
import {
  buildBudgetPace,
  classifyBudgetStatus,
  lowestWarningThreshold,
  resolveBudgetTimeframe,
} from './budget-analytics';

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('resolveBudgetTimeframe', () => {
  it('reports a period that has not started yet', () => {
    const frame = resolveBudgetTimeframe('2026-11-01', '2026-11-30', '2026-10-30');
    expect(frame.state).toBe('not_started');
    expect(frame.totalDays).toBe(30);
    expect(frame.daysElapsed).toBe(0);
    expect(frame.daysRemaining).toBe(30);
  });

  it('counts the start date as day one and the period as inclusive', () => {
    const frame = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-01');
    expect(frame.state).toBe('active');
    expect(frame.totalDays).toBe(31);
    expect(frame.daysElapsed).toBe(1);
    expect(frame.daysRemaining).toBe(30);
  });

  it('counts today in the middle of the month', () => {
    const frame = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-15');
    expect(frame.daysElapsed).toBe(15);
    expect(frame.daysRemaining).toBe(16);
  });

  it('treats the last day as active with no remaining days', () => {
    const frame = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-31');
    expect(frame.state).toBe('active');
    expect(frame.daysElapsed).toBe(31);
    expect(frame.daysRemaining).toBe(0);
  });

  it('marks a period as ended after its last day', () => {
    const frame = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-11-01');
    expect(frame.state).toBe('ended');
    expect(frame.daysElapsed).toBe(31);
    expect(frame.daysRemaining).toBe(0);
  });

  it('handles February in a leap year', () => {
    expect(resolveBudgetTimeframe('2028-02-01', '2028-02-29', '2028-02-10').totalDays).toBe(29);
    expect(resolveBudgetTimeframe('2026-02-01', '2026-02-28', '2026-02-10').totalDays).toBe(28);
  });
});

describe('lowestWarningThreshold', () => {
  it('ignores thresholds at or above 100 and non-positive values', () => {
    expect(lowestWarningThreshold([80, 100])).toBe(80);
    expect(lowestWarningThreshold([100, 120])).toBeNull();
    expect(lowestWarningThreshold([0, -5, 90])).toBe(90);
    expect(lowestWarningThreshold([])).toBeNull();
  });
});

describe('classifyBudgetStatus', () => {
  const base = { warningThresholds: [80, 100] };

  it('is NOT_STARTED before the period begins, even with spending', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('200000'),
        state: 'not_started',
      }),
    ).toBe('NOT_STARTED');
  });

  it('is ON_TRACK below the lowest warning threshold', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('790000'),
        state: 'active',
      }),
    ).toBe('ON_TRACK');
  });

  it('is WARNING from the configured threshold (not an invented number)', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('800000'),
        state: 'active',
      }),
    ).toBe('WARNING');
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('800000'),
        state: 'active',
        warningThresholds: [50],
      }),
    ).toBe('WARNING');
  });

  it('is WARNING only from the lowest configured threshold', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('600000'),
        state: 'active',
        warningThresholds: [70, 90],
      }),
    ).toBe('ON_TRACK');
  });

  it('is EXCEEDED at exactly 100%', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('1000000'),
        state: 'active',
      }),
    ).toBe('EXCEEDED');
  });

  it('is COMPLETED after the period ends within the limit', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('900000'),
        state: 'ended',
      }),
    ).toBe('COMPLETED');
  });

  it('stays EXCEEDED after the period ends when overspent', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('1000000'),
        spent: money('1100000'),
        state: 'ended',
      }),
    ).toBe('EXCEEDED');
  });

  it('handles a zero limit defensively', () => {
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('0'),
        spent: money('0'),
        state: 'active',
      }),
    ).toBe('ON_TRACK');
    expect(
      classifyBudgetStatus({
        ...base,
        limit: money('0'),
        spent: money('1'),
        state: 'active',
      }),
    ).toBe('EXCEEDED');
  });
});

describe('buildBudgetPace', () => {
  it('returns no pace before the period starts', () => {
    const timeframe = resolveBudgetTimeframe('2026-11-01', '2026-11-30', '2026-10-30');
    const pace = buildBudgetPace({
      limit: money('3000000'),
      spent: money('0'),
      timeframe,
    });
    expect(pace.expectedSpend).toBeNull();
    expect(pace.pacePercent).toBeNull();
    expect(pace.dailySpendingAverage).toBeNull();
    expect(pace.estimatedExhaustionDate).toBeNull();
    expect(pace.exhaustionProjection).toBe('not_started');
  });

  it('computes a linear allowance, variance and pace', () => {
    const timeframe = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-16');
    const pace = buildBudgetPace({
      limit: money('3100000'),
      spent: money('2000000'),
      timeframe,
    });
    // 3,100,000 × 16 / 31 = 1,600,000.00
    expect(pace.expectedSpend).toBe('1600000.00');
    expect(pace.variance).toBe('400000.00');
    expect(pace.pacePercent).toBe(125);
    expect(pace.dailySpendingAverage).toBe('125000.00');
    expect(pace.exhaustionProjection).toBe('within_period');
    // 1,100,000 remaining ÷ 125,000/day = 8.8 → 9 days from 2026-10-16.
    expect(pace.estimatedExhaustionDate).toBe('2026-10-25');
  });

  it('reports no projection when nothing has been spent', () => {
    const timeframe = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-16');
    const pace = buildBudgetPace({ limit: money('3100000'), spent: money('0'), timeframe });
    expect(pace.dailySpendingAverage).toBe('0.00');
    expect(pace.estimatedExhaustionDate).toBeNull();
    expect(pace.exhaustionProjection).toBe('no_spending');
  });

  it('does not promise a date once the limit is already used up', () => {
    const timeframe = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-16');
    const pace = buildBudgetPace({
      limit: money('1000000'),
      spent: money('1200000'),
      timeframe,
    });
    expect(pace.estimatedExhaustionDate).toBeNull();
    expect(pace.exhaustionProjection).toBe('already_exceeded');
    expect(Number(pace.variance)).toBeGreaterThan(0);
  });

  it('reports a finished period instead of projecting a past date', () => {
    const timeframe = resolveBudgetTimeframe('2024-03-01', '2024-03-31', '2026-10-30');
    const pace = buildBudgetPace({
      limit: money('2000000'),
      spent: money('1000000'),
      timeframe,
    });
    expect(pace.exhaustionProjection).toBe('period_ended');
    expect(pace.estimatedExhaustionDate).toBeNull();
    expect(pace.expectedSpend).toBe('2000000.00');
  });

  it('says the projection lands beyond the period instead of inventing a date', () => {
    const timeframe = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-16');
    const pace = buildBudgetPace({
      limit: money('10000000'),
      spent: money('100000'),
      timeframe,
    });
    expect(pace.exhaustionProjection).toBe('beyond_period');
    expect(pace.estimatedExhaustionDate).toBeNull();
  });

  it('projects the last possible day when the remaining budget runs out on the end date', () => {
    const timeframe = resolveBudgetTimeframe('2026-10-01', '2026-10-31', '2026-10-16');
    const pace = buildBudgetPace({
      limit: money('3100000'),
      spent: money('1550000'),
      timeframe,
    });
    // Remaining 1,550,000 ÷ 96,875/day = 16 days → 2026-11-01 (beyond period).
    expect(pace.exhaustionProjection).toBe('beyond_period');
  });
});
