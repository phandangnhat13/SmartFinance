import type { GoalProgressDto } from '@smart-finance/shared-types';
import { Prisma } from '@prisma/client';
import {
  buildGoalProgress,
  expectedAmountAt,
  progressLimitations,
  progressRules,
  summarizeProgress,
  type ProgressGoalInput,
  type ProgressOptions,
} from './savings-progress';

const OPTIONS: ProgressOptions = { today: '2026-07-01', timezone: 'Asia/Ho_Chi_Minh' };

function createOptions(overrides: Partial<ProgressOptions> = {}): ProgressOptions {
  return { today: '2026-07-01', timezone: 'Asia/Ho_Chi_Minh', ...overrides };
}

function createInput(overrides: Partial<ProgressGoalInput> = {}): ProgressGoalInput {
  return {
    id: 'goal-1',
    name: 'Mua laptop',
    currency: 'VND',
    status: 'ACTIVE',
    targetAmount: '12000000.00',
    savedAmount: '6000000.00',
    startDate: '2026-01-01',
    targetDate: '2027-01-01',
    contributions: [{ amount: '6000000.00', contributedAt: '2026-03-01T00:00:00.000Z' }],
    ...overrides,
  };
}

function progress(overrides: Partial<ProgressGoalInput> = {}, options = createOptions()) {
  return buildGoalProgress(createInput(overrides), options);
}

describe('expectedAmountAt', () => {
  const target = new Prisma.Decimal('12000000');

  it('moves linearly from zero at the start to the target at the deadline', () => {
    expect(expectedAmountAt(target, '2026-01-01', '2027-01-01', '2026-01-01').toFixed(2)).toBe(
      '0.00',
    );
    expect(expectedAmountAt(target, '2026-01-01', '2027-01-01', '2027-01-01').toFixed(2)).toBe(
      '12000000.00',
    );
  });

  it('clamps dates before the start and after the deadline', () => {
    expect(expectedAmountAt(target, '2026-01-01', '2027-01-01', '2025-12-01').toFixed(2)).toBe(
      '0.00',
    );
    expect(expectedAmountAt(target, '2026-01-01', '2027-01-01', '2027-02-01').toFixed(2)).toBe(
      '12000000.00',
    );
  });

  it('returns the whole target for a zero-length plan instead of dividing by zero', () => {
    expect(expectedAmountAt(target, '2026-01-01', '2026-01-01', '2026-03-01').toFixed(2)).toBe(
      '12000000.00',
    );
  });

  it('matches the straight-line share at the midpoint', () => {
    // 364 days between 2026-01-01 and 2026-12-31, so 2026-07-02 is exactly half.
    const expected = expectedAmountAt(target, '2026-01-01', '2026-12-31', '2026-07-02');
    expect(expected.toFixed(2)).toBe('6000000.00');
  });
});

describe('buildGoalProgress', () => {
  it('reports ON_TRACK when actual is within one planned instalment of expected', () => {
    const result = progress();
    expect(result.progressStatus).toBe('ON_TRACK');
    expect(result.atRisk).toBe(false);
    expect(result.aheadOfSchedule).toBe(true);
    expect(result.expectedAmount).not.toBeNull();
    expect(result.expectedPercentage).not.toBeNull();
  });

  it('uses recorded contributions as the only source of actual progress', () => {
    const result = progress();
    expect(result.savedAmount).toBe('6000000.00');
    expect(result.remainingAmount).toBe('6000000.00');
    expect(result.completionPercentage).toBe(50);
  });

  it('reports AT_RISK when the shortfall exceeds one planned instalment', () => {
    const result = progress({ savedAmount: '3000000.00' });
    expect(result.progressStatus).toBe('AT_RISK');
    expect(result.atRisk).toBe(true);
    expect(result.aheadOfSchedule).toBe(false);
  });

  it('reports OVERDUE when the deadline passed with money left to save', () => {
    const result = progress({ targetDate: '2026-06-01', savedAmount: '3000000.00' });
    expect(result.progressStatus).toBe('OVERDUE');
    expect(result.displayStatus).toBe('OVERDUE');
    expect(result.statusReason).toContain('quá hạn');
  });

  it('treats a fully funded goal as COMPLETED even when the stored status lags', () => {
    const result = progress({ savedAmount: '12000000.00' });
    expect(result.progressStatus).toBe('COMPLETED');
    expect(result.remainingAmount).toBe('0.00');
    expect(result.requiredMonthlySaving).toBe('0.00');
  });

  it('prioritises COMPLETED and PAUSED over OVERDUE', () => {
    expect(progress({ status: 'COMPLETED', targetDate: '2026-06-01' }).progressStatus).toBe(
      'COMPLETED',
    );
    expect(progress({ status: 'PAUSED', targetDate: '2026-06-01' }).progressStatus).toBe('PAUSED');
  });

  it('returns INSUFFICIENT_DATA without a deadline instead of guessing', () => {
    const result = progress({ targetDate: null });
    expect(result.progressStatus).toBe('INSUFFICIENT_DATA');
    expect(result.expectedAmount).toBeNull();
    expect(result.expectedPercentage).toBeNull();
    expect(result.actualVsExpected).toBeNull();
    expect(result.atRisk).toBeNull();
    expect(result.aheadOfSchedule).toBeNull();
    expect(result.requiredMonthlySaving).toBeNull();
  });

  it('reports no pace before the first contribution', () => {
    const result = progress({ savedAmount: '0.00', contributions: [] });
    expect(result.pace.averageMonthlyContribution).toBeNull();
    expect(result.pace.monthsToComplete).toBeNull();
    expect(result.pace.estimatedCompletionDate).toBeNull();
    expect(result.pace.projectedAmountAtDeadline).toBeNull();
    expect(result.pace.projectedHitsDeadline).toBeNull();
    expect(result.lastContributionAt).toBeNull();
    expect(result.progressStatus).toBe('AT_RISK');
  });

  it('projects completion from the observed pace', () => {
    const result = progress();
    // Six months observed, 6,000,000 saved: 1,000,000/month, 6,000,000 left.
    expect(result.pace.monthsObserved).toBe(6);
    expect(result.pace.averageMonthlyContribution).toBe('1000000.00');
    expect(result.pace.monthsToComplete).toBe(6);
    expect(result.pace.estimatedCompletionDate).toBe('2027-01-01');
    expect(result.pace.projectedHitsDeadline).toBe(true);
    expect(result.pace.projectedAmountAtDeadline).toBe('12000000.00');
  });

  it('extrapolates a single contribution without inventing extra history', () => {
    const result = progress({
      savedAmount: '2000000.00',
      contributions: [{ amount: '2000000.00', contributedAt: '2026-06-15T00:00:00.000Z' }],
    });
    expect(result.pace.monthsObserved).toBe(6);
    expect(result.pace.averageMonthlyContribution).toBe('333333.33');
    expect(result.pace.monthsToComplete).toBe(31);
    expect(result.lastContributionAt).toBe('2026-06-15T00:00:00.000Z');
  });

  it('keeps saved money unchanged when projecting a hypothetical deadline', () => {
    const result = progress({ targetDate: '2026-12-01' });
    expect(result.savedAmount).toBe('6000000.00');
    expect(result.targetDate).toBe('2026-12-01');
    expect(result.pace.estimatedCompletionDate).toBe('2027-01-01');
    expect(result.pace.projectedHitsDeadline).toBe(false);
  });

  it('builds a monthly timeline with cumulative actual and expected values', () => {
    const result = progress();
    expect(result.timeline).toHaveLength(7);
    expect(result.timeline[0].month).toBe('2026-01');
    expect(result.timeline[0].actualSaved).toBe('0.00');
    expect(result.timeline[2].month).toBe('2026-03');
    expect(result.timeline[2].actualSaved).toBe('6000000.00');
    expect(result.timeline[6].month).toBe('2026-07');
    expect(result.timeline[6].actualSaved).toBe('6000000.00');
    expect(result.timeline.every((point) => point.expectedSaved !== null)).toBe(true);
  });

  it('groups contributions by the owner timezone, not by UTC', () => {
    // 2026-02-28T18:00Z is 2026-03-01 01:00 in Asia/Ho_Chi_Minh.
    const result = progress({
      savedAmount: '1000000.00',
      contributions: [{ amount: '1000000.00', contributedAt: '2026-02-28T18:00:00.000Z' }],
    });
    const march = result.timeline.find((point) => point.month === '2026-03');
    expect(march?.actualSaved).toBe('1000000.00');
  });

  it('carries contributions from before the chart window into the opening balance', () => {
    const result = buildGoalProgress(
      createInput({
        startDate: '2020-01-01',
        contributions: [
          { amount: '1000000.00', contributedAt: '2020-02-01T00:00:00.000Z' },
          { amount: '500000.00', contributedAt: '2026-06-01T00:00:00.000Z' },
        ],
        savedAmount: '1500000.00',
      }),
      OPTIONS,
    );
    expect(result.timeline).toHaveLength(60);
    expect(result.timeline[result.timeline.length - 1].actualSaved).toBe('1500000.00');
  });

  it('never mixes currencies', () => {
    const result = progress({ currency: 'USD', targetAmount: '1000.00', savedAmount: '250.00' });
    expect(result.currency).toBe('USD');
    expect(result.savedAmount).toBe('250.00');
    expect(result.statusReason).toContain('USD');
  });
});

describe('summarizeProgress', () => {
  const goals: GoalProgressDto[] = [
    progress(),
    progress({ id: 'goal-2', name: 'Du lịch', savedAmount: '0.00', contributions: [] }),
  ];

  it('counts every status and sums per-currency totals', () => {
    const summary = summarizeProgress(goals, 'VND');
    expect(summary.currency).toBe('VND');
    expect(summary.activeGoals).toBe(2);
    expect(summary.onTrack).toBe(1);
    expect(summary.atRisk).toBe(1);
    expect(summary.overdue).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.totalTargetAmount).toBe('24000000.00');
    expect(summary.totalSavedAmount).toBe('6000000.00');
    expect(summary.totalRemainingAmount).toBe('18000000.00');
    expect(summary.overallPercentage).toBe(25);
  });

  it('returns zeroed totals for an empty dashboard', () => {
    const summary = summarizeProgress([], 'VND');
    expect(summary.activeGoals).toBe(0);
    expect(summary.totalTargetAmount).toBe('0.00');
    expect(summary.overallPercentage).toBe(0);
  });
});

describe('progress documentation', () => {
  it('explains every rule and limitation returned by the API', () => {
    expect(progressRules().length).toBeGreaterThanOrEqual(5);
    expect(progressLimitations('VND').join(' ')).toContain('VND');
    expect(progressLimitations('VND').join(' ')).toContain('lịch sử thay đổi');
  });
});
