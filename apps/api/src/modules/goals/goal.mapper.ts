import type { GoalContribution, SavingsGoal } from '@prisma/client';
import type { GoalDto } from '@smart-finance/shared-types';
import { Prisma } from '@prisma/client';
import { moneyString, percentage } from '../../common/utils/money';

type GoalWithContributions = SavingsGoal & { contributions: GoalContribution[] };

export function toGoalDto(goal: GoalWithContributions): GoalDto {
  const saved = goal.contributions.reduce(
    (acc, contribution) => acc.plus(contribution.amount),
    new Prisma.Decimal(0),
  );
  const remaining = Prisma.Decimal.max(goal.targetAmount.minus(saved), new Prisma.Decimal(0));
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: moneyString(goal.targetAmount),
    savedAmount: moneyString(saved),
    remainingAmount: moneyString(remaining),
    percentage: percentage(saved, goal.targetAmount),
    targetDate: goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null,
    status: goal.status,
    contributions: goal.contributions
      .slice()
      .sort((a, b) => b.contributedAt.getTime() - a.contributedAt.getTime())
      .map((contribution) => ({
        id: contribution.id,
        amount: moneyString(contribution.amount),
        contributedAt: contribution.contributedAt.toISOString(),
        note: contribution.note,
      })),
  };
}
