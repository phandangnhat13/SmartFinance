import type {
  GoalProgressDto,
  SavingsProgressDto,
  SavingsRecommendationsDto,
} from '@smart-finance/shared-types';
import {
  buildSavingsAiContext,
  collectAllowedNumbers,
  evidenceCatalog,
  findInventedNumbers,
} from './savings-context';

function goalProgress(overrides: Partial<GoalProgressDto> = {}): GoalProgressDto {
  return {
    goalId: 'g1',
    name: 'Du lịch',
    currency: 'VND',
    status: 'ACTIVE',
    displayStatus: 'ACTIVE',
    targetAmount: '24000000.00',
    savedAmount: '5000000.00',
    remainingAmount: '19000000.00',
    completionPercentage: 21,
    startDate: '2026-01-01',
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    requiredMonthlySaving: '2375000.00',
    expectedAmount: '15000000.00',
    expectedPercentage: 62.5,
    actualVsExpected: '-10000000.00',
    atRisk: true,
    aheadOfSchedule: false,
    pace: {
      monthsObserved: 10,
      averageMonthlyContribution: '500000.00',
      monthsToComplete: 38,
      estimatedCompletionDate: '2028-12-31',
      projectedAmountAtDeadline: '9000000.00',
      projectedHitsDeadline: false,
    },
    progressStatus: 'AT_RISK',
    statusReason: 'Chậm hơn kế hoạch.',
    lastContributionAt: '2026-10-01T00:00:00.000Z',
    timeline: [],
    ...overrides,
  };
}

function progress(overrides: Partial<SavingsProgressDto> = {}): SavingsProgressDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    today: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    asOf: '2026-10-30',
    summary: {
      currency: 'VND',
      activeGoals: 1,
      onTrack: 0,
      atRisk: 1,
      overdue: 0,
      completed: 0,
      paused: 0,
      insufficientData: 0,
      totalTargetAmount: '24000000.00',
      totalSavedAmount: '5000000.00',
      totalRemainingAmount: '19000000.00',
      overallPercentage: 21,
    },
    goals: [goalProgress()],
    excluded: { archived: 0 },
    rules: ['Mục tiêu quá hạn được xếp trước.'],
    limitations: ['Chỉ tính một loại tiền tệ.'],
    ...overrides,
  };
}

function recommendations(
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
      monthsAnalyzed: 6,
      analyzedMonths: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
      averageMonthlyIncome: '20000000.00',
      averageMonthlyExpense: '15000000.00',
      averageNetCashFlow: '5000000.00',
      historicalSavingsRate: 25,
      safetyBufferPercent: 20,
      safetyBufferAmount: '1000000.00',
      suggestedMonthlySaving: '4000000.00',
      isPositive: true,
      confidence: 'high',
    },
    monthlyBudget: '4000000.00',
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
        recommendedMonthlySaving: '2375000.00',
        estimatedCompletionDate: '2027-06-30',
        feasibility: 'ON_TRACK',
        priority: 1,
        priorityReason: 'Hạn chót 2027-06-30.',
        explanation: 'Đề xuất 2.375.000 VND/tháng.',
      },
    ],
    allocatedMonthly: '2375000.00',
    unallocatedMonthly: '1625000.00',
    excluded: { paused: 0, completed: 0, archived: 0 },
    assumptions: ['Chỉ phân tích một loại tiền tệ.'],
    limitations: ['Chưa tính lạm phát.'],
    ...overrides,
  };
}

describe('savings-context', () => {
  it('merges the M2c allocation with the M2d progress per goal', () => {
    const context = buildSavingsAiContext(recommendations(), progress());
    expect(context.currency).toBe('VND');
    expect(context.capacity.suggestedMonthlySaving).toBe('4000000.00');
    expect(context.plan.allocatedMonthly).toBe('2375000.00');
    expect(context.goals).toHaveLength(1);
    expect(context.goals[0]).toMatchObject({
      goalId: 'g1',
      priority: 1,
      progressStatus: 'AT_RISK',
      recommendedMonthlySaving: '2375000.00',
      atRisk: true,
    });
  });

  it('builds evidence values only from the context', () => {
    const catalog = evidenceCatalog(buildSavingsAiContext(recommendations(), progress()));
    expect(catalog.capacity.value).toBe('4.000.000 VND');
    expect(catalog.safety_buffer.value).toBe('1.000.000 VND');
    expect(catalog['goal:g1'].value).toContain('19.000.000 VND');
    expect(catalog['progress:g1'].value).toContain('AT_RISK');
    expect(catalog.unknown).toBeUndefined();
  });

  it('accepts context numbers and rejects an invented amount', () => {
    const allowed = collectAllowedNumbers(buildSavingsAiContext(recommendations(), progress()));
    expect(findInventedNumbers('Thu nhập 20.000.000 VND, chi 15.000.000 VND', allowed)).toEqual([]);
    expect(findInventedNumbers('Bạn sẽ có 9.999.000 VND vào 30/06/2027', allowed)).toEqual([
      '9.999.000',
    ]);
    expect(findInventedNumbers('Giữ lại 20% trong 6 tháng', allowed)).toEqual([]);
  });

  it('does not invent a goal that is absent from the progress view', () => {
    const context = buildSavingsAiContext(
      recommendations({
        items: [
          {
            ...recommendations().items[0],
            goalId: 'g2',
            goalName: 'Xe máy',
            priority: 2,
          },
        ],
      }),
      progress(),
    );
    // Goals are ordered by allocation priority, so the allocated goal comes
    // first and the progress-only goal follows.
    expect(context.goals.map((goal) => goal.goalId)).toEqual(['g2', 'g1']);
    expect(context.goals.find((goal) => goal.goalId === 'g2')?.goalName).toBe('Xe máy');
  });
});
