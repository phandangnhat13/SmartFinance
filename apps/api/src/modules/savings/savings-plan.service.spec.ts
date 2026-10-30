import { BadRequestException } from '@nestjs/common';
import type {
  GoalDto,
  MultiGoalSimulationDto,
  SavingsCapacityDto,
  SavingsRecommendationsDto,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import type { GoalsService } from '../goals/goals.service';
import type { SavingsRecommendationService } from '../insights/savings-recommendation.service';
import type { SavingsProgressService } from './savings-progress.service';
import { SavingsPlanService } from './savings-plan.service';

function goalDto(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Mua laptop',
    description: null,
    targetAmount: '12000000.00',
    savedAmount: '6000000.00',
    remainingAmount: '6000000.00',
    percentage: 50,
    currency: 'VND',
    startDate: '2026-01-01',
    targetDate: '2027-01-01',
    status: 'ACTIVE',
    displayStatus: 'ACTIVE',
    isOverdue: false,
    monthsRemaining: 6,
    requiredMonthlySaving: '1000000.00',
    contributions: [],
    ...overrides,
  };
}

function goalProgress(overrides: Partial<GoalDto> = {}) {
  const goal = goalDto(overrides);
  return {
    goalId: goal.id,
    name: goal.name,
    currency: goal.currency,
    status: goal.status,
    displayStatus: goal.displayStatus,
    targetAmount: goal.targetAmount,
    savedAmount: goal.savedAmount,
    remainingAmount: goal.remainingAmount,
    completionPercentage: goal.percentage,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    monthsRemaining: goal.monthsRemaining,
    requiredMonthlySaving: goal.requiredMonthlySaving,
    expectedAmount: '9000000.00',
    expectedPercentage: 75,
    actualVsExpected: '-3000000.00',
    atRisk: true,
    aheadOfSchedule: false,
    pace: {
      monthsObserved: 6,
      averageMonthlyContribution: '1000000.00',
      monthsToComplete: 6,
      estimatedCompletionDate: '2027-01-01',
      projectedAmountAtDeadline: '12000000.00',
      projectedHitsDeadline: true,
    },
    progressStatus: 'AT_RISK' as const,
    statusReason: 'Chậm hơn kế hoạch.',
    lastContributionAt: '2026-03-01T00:00:00.000Z',
    timeline: [],
  };
}

function capacity(overrides: Partial<SavingsCapacityDto> = {}): SavingsCapacityDto {
  return {
    status: 'available',
    reason: 'enough_months',
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
    ...overrides,
  } as SavingsCapacityDto;
}

function recommendation(
  overrides: Partial<SavingsRecommendationsDto> = {},
): SavingsRecommendationsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    status: 'available',
    capacity: capacity(),
    monthlyBudget: '4000000.00',
    simulated: false,
    simulatedMonthlySaving: null,
    items: [],
    allocatedMonthly: '0.00',
    unallocatedMonthly: '4000000.00',
    excluded: { paused: 0, completed: 0, archived: 0 },
    assumptions: ['assumption'],
    limitations: ['limitation'],
    ...overrides,
  };
}

function item(goalId: string, recommended: string | null) {
  return {
    goalId,
    goalName: `Mục tiêu ${goalId}`,
    currency: 'VND',
    displayStatus: 'ACTIVE' as const,
    targetDate: '2027-01-01',
    monthsRemaining: 6,
    remainingAmount: '6000000.00',
    requiredMonthlySaving: '1000000.00',
    recommendedMonthlySaving: recommended,
    estimatedCompletionDate: '2027-01-01',
    feasibility: 'ON_TRACK' as const,
    priority: 1,
    priorityReason: 'Hạn gần nhất',
    explanation: 'Giải thích',
  };
}

function createMocks(goal: GoalDto = goalDto()) {
  const progress = {
    contextFor: jest.fn().mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
      today: '2026-07-01',
      defaultCurrency: 'VND',
    }),
    loadOwnedGoal: jest.fn().mockResolvedValue({
      goal,
      progress: goalProgress({ ...goal }),
      context: {
        timezone: 'Asia/Ho_Chi_Minh',
        today: '2026-07-01',
        defaultCurrency: 'VND',
      },
    }),
    progressInput: jest.fn(),
  };
  const recommendations = {
    capacityFor: jest.fn().mockResolvedValue({
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      today: '2026-07-01',
      capacity: capacity({ suggestedMonthlySaving: '2000000.00' }),
    }),
    recommend: jest.fn().mockResolvedValue(recommendation()),
  };
  const goals = {
    update: jest
      .fn()
      .mockImplementation((_userId: string, _id: string, dto: GoalDto) =>
        Promise.resolve(goalDto({ ...goal, ...dto })),
      ),
  };
  const service = new SavingsPlanService(
    progress as unknown as SavingsProgressService,
    recommendations as unknown as SavingsRecommendationService,
    goals as unknown as GoalsService,
  );
  return { service, progress, recommendations, goals };
}

describe('SavingsPlanService', () => {
  describe('simulate', () => {
    it('returns one goal scenario with the owner timezone', async () => {
      const { service, recommendations } = createMocks();
      const result = (await service.simulate('user-1', {
        scenario: 'MONTHLY_AMOUNT',
        goalId: '11111111-1111-1111-1111-111111111111',
        monthlyAmount: '2000000',
      })) as SingleGoalSimulationDto;

      expect(result.scenario).toBe('MONTHLY_AMOUNT');
      expect(result.timezone).toBe('Asia/Ho_Chi_Minh');
      expect(result.generatedAt).toBeTruthy();
      expect(result.simulated.monthlySaving).toBe('2000000.00');
      expect(recommendations.capacityFor).toHaveBeenCalledWith('user-1', 'VND');
    });

    it('rejects a scenario without its required field', async () => {
      const { service } = createMocks();
      await expect(
        service.simulate('user-1', {
          scenario: 'MONTHLY_AMOUNT',
          goalId: '11111111-1111-1111-1111-111111111111',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects fields the chosen scenario does not use', async () => {
      const { service } = createMocks();
      await expect(
        service.simulate('user-1', {
          scenario: 'MONTHLY_AMOUNT',
          goalId: '11111111-1111-1111-1111-111111111111',
          monthlyAmount: '2000000',
          targetDate: '2027-01-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a budget scenario that carries a goal id', async () => {
      const { service } = createMocks();
      await expect(
        service.simulate('user-1', {
          scenario: 'MULTI_GOAL_BUDGET',
          goalId: '11111111-1111-1111-1111-111111111111',
          budget: '5000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-positive amount before touching the data', async () => {
      const { service, progress } = createMocks();
      await expect(
        service.simulate('user-1', {
          scenario: 'MONTHLY_AMOUNT',
          goalId: '11111111-1111-1111-1111-111111111111',
          monthlyAmount: '0',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(progress.loadOwnedGoal).not.toHaveBeenCalled();
    });

    it('rejects an archived goal', async () => {
      const { service } = createMocks(goalDto({ status: 'ARCHIVED', displayStatus: 'ARCHIVED' }));
      await expect(
        service.simulate('user-1', {
          scenario: 'MONTHLY_AMOUNT',
          goalId: '11111111-1111-1111-1111-111111111111',
          monthlyAmount: '2000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a target below what has already been saved', async () => {
      const { service } = createMocks();
      await expect(
        service.simulate('user-1', {
          scenario: 'TARGET_AMOUNT',
          goalId: '11111111-1111-1111-1111-111111111111',
          targetAmount: '1000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a deadline before the start date', async () => {
      const { service } = createMocks();
      await expect(
        service.simulate('user-1', {
          scenario: 'DEADLINE',
          goalId: '11111111-1111-1111-1111-111111111111',
          targetDate: '2025-12-31',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('runs the multi-goal scenario through the M2c allocation twice', async () => {
      const { service, recommendations } = createMocks();
      recommendations.recommend
        .mockResolvedValueOnce(
          recommendation({ items: [item('goal-1', '1000000.00')], allocatedMonthly: '1000000.00' }),
        )
        .mockResolvedValueOnce(
          recommendation({
            simulated: true,
            simulatedMonthlySaving: '5000000.00',
            monthlyBudget: '5000000.00',
            items: [
              item('goal-1', '2000000.00'),
              { ...item('goal-2', '3000000.00'), feasibility: 'NOT_FEASIBLE' as const },
            ],
            allocatedMonthly: '5000000.00',
            unallocatedMonthly: '0.00',
          }),
        );

      const result = (await service.simulate('user-1', {
        scenario: 'MULTI_GOAL_BUDGET',
        budget: '5000000',
      })) as MultiGoalSimulationDto;

      expect(recommendations.recommend).toHaveBeenCalledTimes(2);
      expect(result.scenario).toBe('MULTI_GOAL_BUDGET');
      expect(result.budget).toBe('5000000.00');
      expect(result.baseline.allocatedMonthly).toBe('1000000.00');
      expect(result.simulated.infeasibleGoalIds).toEqual(['goal-2']);
      expect(result.differences).toEqual([
        {
          goalId: 'goal-1',
          goalName: 'Mục tiêu goal-1',
          baselineMonthlySaving: '1000000.00',
          simulatedMonthlySaving: '2000000.00',
          deltaMonthlySaving: '1000000.00',
        },
        {
          goalId: 'goal-2',
          goalName: 'Mục tiêu goal-2',
          baselineMonthlySaving: null,
          simulatedMonthlySaving: '3000000.00',
          deltaMonthlySaving: null,
        },
      ]);
    });
  });

  describe('previewAdjustment', () => {
    it('returns the change and the projected figures without writing', async () => {
      const { service, goals } = createMocks();
      const result = await service.previewAdjustment('user-1', {
        goalId: '11111111-1111-1111-1111-111111111111',
        targetAmount: '15000000',
      });

      expect(result.changes).toEqual([
        { field: 'targetAmount', oldValue: '12000000.00', newValue: '15000000.00' },
      ]);
      expect(result.problems).toEqual([]);
      expect(result.canApply).toBe(true);
      expect(result.current.savedAmount).toBe('6000000.00');
      expect(result.projected.savedAmount).toBe('6000000.00');
      expect(result.projected.remainingAmount).toBe('9000000.00');
      expect(goals.update).not.toHaveBeenCalled();
    });

    it('marks an invalid change as not applicable', async () => {
      const { service, goals } = createMocks();
      const result = await service.previewAdjustment('user-1', {
        goalId: '11111111-1111-1111-1111-111111111111',
        targetAmount: '1000000',
      });
      expect(result.canApply).toBe(false);
      expect(result.problems.join(' ')).toContain('thấp hơn số tiền đã tiết kiệm');
      expect(goals.update).not.toHaveBeenCalled();
    });

    it('never invents a currency or timezone', async () => {
      const { service } = createMocks(goalDto({ currency: 'USD' }));
      const result = await service.previewAdjustment('user-1', {
        goalId: '11111111-1111-1111-1111-111111111111',
        targetDate: '2027-06-30',
      });
      expect(result.currency).toBe('USD');
      expect(result.timezone).toBe('Asia/Ho_Chi_Minh');
    });
  });

  describe('applyAdjustment', () => {
    it('delegates only the confirmed fields to the goals service', async () => {
      const { service, goals } = createMocks();
      const result = await service.applyAdjustment('user-1', {
        goalId: '11111111-1111-1111-1111-111111111111',
        targetAmount: '15000000',
        targetDate: '2027-06-30',
      });

      expect(goals.update).toHaveBeenCalledWith('user-1', '11111111-1111-1111-1111-111111111111', {
        targetAmount: '15000000',
        targetDate: '2027-06-30',
      });
      expect(result.goal.targetAmount).toBe('15000000');
      expect(result.progress.goalId).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('refuses to apply an invalid change and does not write', async () => {
      const { service, goals } = createMocks();
      await expect(
        service.applyAdjustment('user-1', {
          goalId: '11111111-1111-1111-1111-111111111111',
          targetAmount: '1000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(goals.update).not.toHaveBeenCalled();
    });

    it('does not send fields the user did not confirm', async () => {
      const { service, goals } = createMocks();
      await service.applyAdjustment('user-1', {
        goalId: '11111111-1111-1111-1111-111111111111',
        targetDate: '2027-06-30',
      });
      expect(goals.update).toHaveBeenCalledWith('user-1', '11111111-1111-1111-1111-111111111111', {
        targetDate: '2027-06-30',
      });
    });
  });
});
