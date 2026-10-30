import type { SavingsRecommendationItemDto } from '@smart-finance/shared-types';
import { Prisma } from '@prisma/client';
import {
  baselineMonthlySaving,
  compareAllocations,
  planFigures,
  simulateSingleGoal,
  validateAdjustment,
  type SingleSimulationInput,
} from './savings-plan';

const TODAY = '2026-07-01';

function goal(overrides: Partial<SingleSimulationInput['goal']> = {}) {
  return {
    id: 'goal-1',
    name: 'Mua laptop',
    status: 'ACTIVE' as const,
    targetAmount: '12000000.00',
    savedAmount: '6000000.00',
    startDate: '2026-01-01',
    targetDate: '2027-01-01',
    averagePace: new Prisma.Decimal('1000000'),
    ...overrides,
  };
}

function simulation(overrides: Partial<SingleSimulationInput> = {}): SingleSimulationInput {
  return {
    scenario: 'MONTHLY_AMOUNT',
    today: TODAY,
    currency: 'VND',
    goal: goal(),
    capacity: { status: 'available', suggested: new Prisma.Decimal('2000000') },
    monthlyAmount: '2000000',
    ...overrides,
  };
}

function item(overrides: Partial<SavingsRecommendationItemDto> = {}): SavingsRecommendationItemDto {
  return {
    goalId: 'goal-1',
    goalName: 'Mua laptop',
    currency: 'VND',
    displayStatus: 'ACTIVE',
    targetDate: '2027-01-01',
    monthsRemaining: 6,
    remainingAmount: '6000000.00',
    requiredMonthlySaving: '1000000.00',
    recommendedMonthlySaving: '1000000.00',
    estimatedCompletionDate: '2027-01-01',
    feasibility: 'ON_TRACK',
    priority: 1,
    priorityReason: 'Hạn gần nhất',
    explanation: 'Đủ ngân sách cho mức cần thiết.',
    ...overrides,
  };
}

describe('planFigures', () => {
  it('marks a fully funded plan as complete on any date', () => {
    const figures = planFigures({
      status: 'ACTIVE',
      targetAmount: '12000000.00',
      savedAmount: '12000000.00',
      targetDate: null,
      today: TODAY,
      monthlySaving: null,
    });
    expect(figures.remainingAmount).toBe('0.00');
    expect(figures.monthsToComplete).toBe(0);
    expect(figures.estimatedCompletionDate).toBe(TODAY);
    expect(figures.deadlineMet).toBeNull();
  });

  it('projects completion from the assumed monthly amount', () => {
    const figures = planFigures({
      status: 'ACTIVE',
      targetAmount: '12000000.00',
      savedAmount: '6000000.00',
      targetDate: '2027-01-01',
      today: TODAY,
      monthlySaving: new Prisma.Decimal('1000000'),
    });
    expect(figures.monthsToComplete).toBe(6);
    expect(figures.estimatedCompletionDate).toBe('2027-01-01');
    expect(figures.deadlineMet).toBe(true);
    expect(figures.requiredMonthlySaving).toBe('1000000.00');
  });

  it('reports an unknown projection when no monthly amount is available', () => {
    const figures = planFigures({
      status: 'ACTIVE',
      targetAmount: '12000000.00',
      savedAmount: '6000000.00',
      targetDate: null,
      today: TODAY,
      monthlySaving: null,
    });
    expect(figures.monthsToComplete).toBeNull();
    expect(figures.estimatedCompletionDate).toBeNull();
    expect(figures.deadlineMet).toBeNull();
  });
});

describe('baselineMonthlySaving', () => {
  it('prefers the required monthly amount of the current plan', () => {
    expect(
      baselineMonthlySaving(
        'ACTIVE',
        '12000000.00',
        '6000000.00',
        TODAY,
        '2027-01-01',
        new Prisma.Decimal('500000'),
      )?.toFixed(2),
    ).toBe('1000000.00');
  });

  it('falls back to the observed pace when the plan has no deadline', () => {
    expect(
      baselineMonthlySaving(
        'ACTIVE',
        '12000000.00',
        '6000000.00',
        TODAY,
        null,
        new Prisma.Decimal('500000'),
      )?.toFixed(2),
    ).toBe('500000.00');
  });

  it('returns null when neither a plan nor a pace exists', () => {
    expect(baselineMonthlySaving('ACTIVE', '12000000.00', '0.00', TODAY, null, null)).toBeNull();
  });
});

describe('simulateSingleGoal', () => {
  it('shows how a higher monthly amount shortens the completion date', () => {
    const result = simulateSingleGoal(simulation());
    expect(result.scenario).toBe('MONTHLY_AMOUNT');
    expect(result.current.monthsToComplete).toBe(6);
    expect(result.simulated.monthsToComplete).toBe(3);
    expect(result.simulated.estimatedCompletionDate).toBe('2026-10-01');
    expect(result.difference.monthlySaving).toBe('1000000.00');
    expect(result.difference.completionDateShiftMonths).toBe(-3);
    expect(result.feasibility).toBe('FEASIBLE');
    expect(result.current.savedAmount).toBe(result.simulated.savedAmount);
  });

  it('flags a monthly amount that misses the deadline', () => {
    const result = simulateSingleGoal(simulation({ monthlyAmount: '500000' }));
    expect(result.simulated.monthsToComplete).toBe(12);
    expect(result.simulated.deadlineMet).toBe(false);
    expect(result.feasibility).toBe('NOT_FEASIBLE');
    expect(result.warnings.join(' ')).toContain('sau hạn');
  });

  it('turns a new deadline into the monthly amount it requires', () => {
    const result = simulateSingleGoal(
      simulation({ scenario: 'DEADLINE', newTargetDate: '2026-10-01' }),
    );
    expect(result.current.targetDate).toBe('2027-01-01');
    expect(result.simulated.targetDate).toBe('2026-10-01');
    expect(result.simulated.monthlySaving).toBe('2000000.00');
    expect(result.simulated.monthsToComplete).toBe(3);
    expect(result.simulated.deadlineMet).toBe(true);
    expect(result.difference.requiredMonthlySaving).toBe('1000000.00');
  });

  it('marks a required amount above the measured capacity as not feasible', () => {
    const result = simulateSingleGoal(
      simulation({
        scenario: 'DEADLINE',
        newTargetDate: '2026-10-01',
        capacity: { status: 'available', suggested: new Prisma.Decimal('1000000') },
      }),
    );
    expect(result.capacity.requiredWithinCapacity).toBe(false);
    expect(result.feasibility).toBe('NOT_FEASIBLE');
    expect(result.warnings.join(' ')).toContain('vượt khả năng');
  });

  it('keeps the current pace when only the target amount changes', () => {
    const result = simulateSingleGoal(
      simulation({ scenario: 'TARGET_AMOUNT', newTargetAmount: '18000000' }),
    );
    expect(result.simulated.targetAmount).toBe('18000000.00');
    expect(result.simulated.remainingAmount).toBe('12000000.00');
    expect(result.simulated.monthlySaving).toBe('1000000.00');
    expect(result.difference.targetAmount).toBe('6000000.00');
    expect(result.difference.remainingAmount).toBe('6000000.00');
    expect(result.simulated.deadlineMet).toBe(false);
  });

  it('returns INSUFFICIENT_DATA for a deadline that already passed', () => {
    const result = simulateSingleGoal(
      simulation({ scenario: 'DEADLINE', newTargetDate: '2026-05-01' }),
    );
    expect(result.simulated.monthsRemaining).toBe(0);
    expect(result.simulated.monthlySaving).toBeNull();
    expect(result.simulated.deadlineMet).toBeNull();
    expect(result.feasibility).toBe('INSUFFICIENT_DATA');
  });

  it('warns when the goal has no contributions yet', () => {
    const result = simulateSingleGoal(
      simulation({ goal: goal({ savedAmount: '0.00', averagePace: null }) }),
    );
    expect(result.warnings.join(' ')).toContain('chưa có khoản góp');
  });

  it('warns when the capacity itself has insufficient data', () => {
    const result = simulateSingleGoal(
      simulation({ capacity: { status: 'insufficient_data', suggested: null } }),
    );
    expect(result.warnings.join(' ')).toContain('Chưa đủ dữ liệu thu nhập');
    expect(result.capacity.available).toBe(false);
    expect(result.capacity.requiredWithinCapacity).toBeNull();
  });

  it('never mixes currencies in its explanations', () => {
    const result = simulateSingleGoal(simulation({ currency: 'USD', monthlyAmount: '100' }));
    expect(result.currency).toBe('USD');
    expect(result.limitations.join(' ')).toContain('USD');
  });
});

describe('compareAllocations', () => {
  it('reports the per-goal difference between two budgets', () => {
    const differences = compareAllocations(
      [
        item(),
        item({ goalId: 'goal-2', goalName: 'Du lịch', recommendedMonthlySaving: '500000.00' }),
      ],
      [
        item({ recommendedMonthlySaving: '1500000.00' }),
        item({ goalId: 'goal-3', goalName: 'Xe' }),
      ],
    );
    expect(differences).toHaveLength(2);
    expect(differences[0].goalId).toBe('goal-1');
    expect(differences[0].deltaMonthlySaving).toBe('500000.00');
    expect(differences[1].baselineMonthlySaving).toBeNull();
    expect(differences[1].deltaMonthlySaving).toBeNull();
  });
});

describe('validateAdjustment', () => {
  const base = {
    status: 'ACTIVE' as const,
    targetAmount: '12000000.00',
    savedAmount: '6000000.00',
    startDate: '2026-01-01',
    targetDate: '2027-01-01',
    today: TODAY,
  };

  it('accepts a valid target amount change', () => {
    const result = validateAdjustment({ ...base, newTargetAmount: '15000000' });
    expect(result.problems).toEqual([]);
    expect(result.changes).toEqual([
      { field: 'targetAmount', oldValue: '12000000.00', newValue: '15000000.00' },
    ]);
  });

  it('accepts a valid deadline change', () => {
    const result = validateAdjustment({ ...base, newTargetDate: '2027-06-30' });
    expect(result.problems).toEqual([]);
    expect(result.changes).toEqual([
      { field: 'targetDate', oldValue: '2027-01-01', newValue: '2027-06-30' },
    ]);
  });

  it('rejects a target below what has already been saved', () => {
    const result = validateAdjustment({ ...base, newTargetAmount: '5000000' });
    expect(result.problems.join(' ')).toContain('thấp hơn số tiền đã tiết kiệm');
    expect(result.changes).toEqual([]);
  });

  it('rejects a target of zero', () => {
    expect(validateAdjustment({ ...base, newTargetAmount: '0' }).problems.join(' ')).toContain(
      'lớn hơn 0',
    );
  });

  it('rejects a deadline on or before the start date', () => {
    expect(
      validateAdjustment({ ...base, newTargetDate: '2025-12-31' }).problems.join(' '),
    ).toContain('sau ngày bắt đầu');
  });

  it('rejects values that do not change anything', () => {
    const result = validateAdjustment({
      ...base,
      newTargetAmount: '12000000',
      newTargetDate: '2027-01-01',
    });
    expect(result.problems.join(' ')).toContain('trùng');
    expect(result.changes).toEqual([]);
  });

  it('rejects an empty request', () => {
    expect(validateAdjustment(base).problems.join(' ')).toContain('Không có thay đổi');
  });

  it('rejects an archived goal', () => {
    const result = validateAdjustment({
      ...base,
      status: 'ARCHIVED',
      newTargetAmount: '15000000',
    });
    expect(result.problems.join(' ')).toContain('lưu trữ');
    // The preview can still show what would change, but canApply is false
    // because of the problem above.
    expect(result.changes).toHaveLength(1);
  });

  it('warns when the new deadline is already in the past', () => {
    const result = validateAdjustment({ ...base, newTargetDate: '2026-06-01' });
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(' ')).toContain('quá khứ');
  });

  it('warns when the new target equals the saved amount', () => {
    const result = validateAdjustment({ ...base, newTargetAmount: '6000000' });
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(' ')).toContain('hoàn thành');
  });
});
