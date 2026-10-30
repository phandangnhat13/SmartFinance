import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  AdjustmentAppliedDto,
  AdjustmentPreviewDto,
  MultiGoalSimulationDto,
  SavingsSimulationDto,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import { isPositiveMoney, moneyString, toDecimal } from '../../common/utils/money';
import { SavingsRecommendationService } from '../insights/savings-recommendation.service';
import { GoalsService } from '../goals/goals.service';
import type { SavingsAdjustmentInput, SavingsSimulationInput } from './dto/savings.dto';
import { buildGoalProgress, toProgressInput } from './savings-progress';
import { SavingsProgressService } from './savings-progress.service';
import { compareAllocations, simulateSingleGoal, validateAdjustment } from './savings-plan';

/**
 * Read-only plan simulations and the explicit adjustment that may follow them.
 *
 * Nothing here is written except `applyAdjustment`, which delegates to the M2b
 * `GoalsService.update` — the exact same validation the normal edit form uses.
 * No contribution is created from a plan change.
 */
@Injectable()
export class SavingsPlanService {
  constructor(
    private readonly progress: SavingsProgressService,
    private readonly recommendations: SavingsRecommendationService,
    private readonly goals: GoalsService,
  ) {}

  async simulate(userId: string, dto: SavingsSimulationInput): Promise<SavingsSimulationDto> {
    this.assertScenario(dto);
    const { scenario } = dto;
    if (scenario === 'MULTI_GOAL_BUDGET') return this.simulateBudget(userId, dto);
    return this.simulateGoal(userId, dto, scenario);
  }

  async previewAdjustment(
    userId: string,
    dto: SavingsAdjustmentInput,
  ): Promise<AdjustmentPreviewDto> {
    const { goal, progress, context } = await this.progress.loadOwnedGoal(userId, dto.goalId);
    const validation = validateAdjustment({
      status: goal.status,
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      startDate: goal.startDate,
      targetDate: goal.targetDate,
      today: context.today,
      newTargetAmount: dto.targetAmount,
      newTargetDate: dto.targetDate,
    });

    // The preview measures the very same function the tracker uses, with the
    // proposed plan substituted. Saved amounts stay untouched.
    const projected = buildGoalProgress(
      {
        ...toProgressInput(goal),
        ...(dto.targetAmount !== undefined ? { targetAmount: dto.targetAmount } : {}),
        ...(dto.targetDate !== undefined ? { targetDate: dto.targetDate } : {}),
      },
      context,
    );

    return {
      goalId: goal.id,
      goalName: goal.name,
      currency: goal.currency,
      timezone: context.timezone,
      changes: validation.changes,
      problems: validation.problems,
      warnings: validation.warnings,
      current: progress,
      projected,
      canApply: validation.problems.length === 0,
    };
  }

  async applyAdjustment(
    userId: string,
    dto: SavingsAdjustmentInput,
  ): Promise<AdjustmentAppliedDto> {
    const { goal, context } = await this.progress.loadOwnedGoal(userId, dto.goalId);
    const validation = validateAdjustment({
      status: goal.status,
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      startDate: goal.startDate,
      targetDate: goal.targetDate,
      today: context.today,
      newTargetAmount: dto.targetAmount,
      newTargetDate: dto.targetDate,
    });
    if (validation.problems.length > 0) {
      throw new BadRequestException(validation.problems.join(' '));
    }

    // M2b remains the authority: archived goals, the saved floor, the start
    // date rule and status transitions all run inside this update.
    const updated = await this.goals.update(userId, dto.goalId, {
      ...(dto.targetAmount !== undefined ? { targetAmount: dto.targetAmount } : {}),
      ...(dto.targetDate !== undefined ? { targetDate: dto.targetDate } : {}),
    });

    return {
      goal: updated,
      progress: buildGoalProgress(toProgressInput(updated), context),
    };
  }

  private async simulateGoal(
    userId: string,
    dto: SavingsSimulationInput,
    scenario: Exclude<SavingsSimulationInput['scenario'], 'MULTI_GOAL_BUDGET'>,
  ): Promise<SingleGoalSimulationDto> {
    const { goal, progress, context } = await this.progress.loadOwnedGoal(userId, dto.goalId!);
    if (goal.status === 'ARCHIVED') {
      throw new BadRequestException('Mục tiêu đã lưu trữ, không thể mô phỏng kế hoạch');
    }

    if (dto.scenario === 'TARGET_AMOUNT' && dto.targetAmount !== undefined) {
      if (toDecimal(dto.targetAmount).lessThan(toDecimal(goal.savedAmount))) {
        throw new BadRequestException('Số tiền mục tiêu không được thấp hơn số tiền đã tiết kiệm');
      }
    }
    if (dto.scenario === 'DEADLINE' && dto.targetDate !== undefined) {
      if (dto.targetDate <= goal.startDate) {
        throw new BadRequestException('Ngày đích phải sau ngày bắt đầu');
      }
    }

    const capacity = await this.recommendations.capacityFor(userId, goal.currency);
    const result = simulateSingleGoal({
      scenario,
      today: context.today,
      currency: goal.currency,
      goal: {
        id: goal.id,
        name: goal.name,
        status: goal.status,
        targetAmount: goal.targetAmount,
        savedAmount: goal.savedAmount,
        startDate: goal.startDate,
        targetDate: goal.targetDate,
        averagePace:
          progress.pace.averageMonthlyContribution === null
            ? null
            : toDecimal(progress.pace.averageMonthlyContribution),
      },
      capacity: {
        status: capacity.capacity.status,
        suggested:
          capacity.capacity.suggestedMonthlySaving === null
            ? null
            : toDecimal(capacity.capacity.suggestedMonthlySaving),
      },
      monthlyAmount: dto.monthlyAmount,
      newTargetDate: dto.targetDate,
      newTargetAmount: dto.targetAmount,
    });

    return {
      ...result,
      timezone: context.timezone,
      generatedAt: new Date().toISOString(),
    };
  }

  private async simulateBudget(
    userId: string,
    dto: SavingsSimulationInput,
  ): Promise<MultiGoalSimulationDto> {
    const { defaultCurrency } = await this.progress.contextFor(userId);
    const currency = (dto.currency ?? defaultCurrency).toUpperCase();

    // Scenario D is the M2c allocation itself: the same ordering and the same
    // budget cap, run once for the current capacity and once for the typed
    // budget. Nothing is recomputed or re-prioritised here.
    const [baseline, simulated] = await Promise.all([
      this.recommendations.recommend(userId, { currency }),
      this.recommendations.recommend(userId, {
        currency,
        assumedMonthlySaving: dto.budget,
      }),
    ]);

    return {
      scenario: 'MULTI_GOAL_BUDGET',
      currency,
      timezone: simulated.timezone,
      generatedAt: new Date().toISOString(),
      budget: moneyString(toDecimal(dto.budget!)),
      capacityMonthlySaving: baseline.capacity.suggestedMonthlySaving,
      baseline: {
        budget: baseline.monthlyBudget,
        status: baseline.status,
        allocatedMonthly: baseline.allocatedMonthly,
        unallocatedMonthly: baseline.unallocatedMonthly,
        items: baseline.items,
      },
      simulated: {
        allocatedMonthly: simulated.allocatedMonthly,
        unallocatedMonthly: simulated.unallocatedMonthly,
        items: simulated.items,
        infeasibleGoalIds: simulated.items
          .filter((item) => item.feasibility === 'NOT_FEASIBLE')
          .map((item) => item.goalId),
      },
      differences: compareAllocations(baseline.items, simulated.items),
      assumptions: simulated.assumptions,
      limitations: [
        ...simulated.limitations,
        'Mô phỏng ngân sách chỉ đọc: không có khoản góp hay thay đổi mục tiêu nào được ghi lại.',
      ],
    };
  }

  /**
   * Rejects ambiguous bodies early: each scenario accepts exactly the fields it
   * needs, so a typo cannot silently be ignored by the whitelist.
   */
  private assertScenario(dto: SavingsSimulationInput): void {
    const { scenario } = dto;
    const allowed: Record<
      SavingsSimulationInput['scenario'],
      { goalId: boolean; fields: string[]; requires: string[] }
    > = {
      MONTHLY_AMOUNT: { goalId: true, fields: ['monthlyAmount'], requires: ['monthlyAmount'] },
      DEADLINE: { goalId: true, fields: ['targetDate'], requires: ['targetDate'] },
      TARGET_AMOUNT: { goalId: true, fields: ['targetAmount'], requires: ['targetAmount'] },
      MULTI_GOAL_BUDGET: { goalId: false, fields: ['budget', 'currency'], requires: ['budget'] },
    };
    const rule = allowed[scenario];

    if (rule.goalId && !dto.goalId) {
      throw new BadRequestException('Cần chọn mục tiêu để mô phỏng');
    }
    if (!rule.goalId && dto.goalId) {
      throw new BadRequestException('Kịch bản ngân sách không nhận goalId');
    }
    rule.requires.forEach((field) => {
      const value = dto[field as keyof SavingsSimulationInput];
      if (value === undefined) {
        throw new BadRequestException(`Kịch bản ${scenario} cần trường ${field}`);
      }
    });

    const fieldValues: Record<string, string | undefined> = {
      monthlyAmount: dto.monthlyAmount,
      targetAmount: dto.targetAmount,
      targetDate: dto.targetDate,
      budget: dto.budget,
    };
    Object.entries(fieldValues).forEach(([field, value]) => {
      if (value !== undefined && !rule.fields.includes(field)) {
        throw new BadRequestException(`Kịch bản ${scenario} không dùng trường ${field}`);
      }
    });

    (['monthlyAmount', 'targetAmount', 'budget'] as const).forEach((field) => {
      const value = dto[field];
      if (value !== undefined && !isPositiveMoney(value)) {
        throw new BadRequestException('Số tiền mô phỏng phải lớn hơn 0');
      }
    });
  }
}
