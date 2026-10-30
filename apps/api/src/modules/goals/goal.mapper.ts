import type { GoalContribution, GoalStatus, SavingsGoal } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { GoalDisplayStatus, GoalDto } from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { moneyString, percentage } from '../../common/utils/money';

type GoalWithContributions = SavingsGoal & { contributions: GoalContribution[] };

export interface GoalContext {
  timezone: string;
  /** Today's calendar date in the user's timezone, `YYYY-MM-DD`. */
  today: string;
}

export function sumContributions(contributions: GoalContribution[]): Prisma.Decimal {
  return contributions.reduce(
    (acc, contribution) => acc.plus(contribution.amount),
    new Prisma.Decimal(0),
  );
}

/** `@db.Date` columns are date-only; read them in UTC so no timezone shifts the day. */
function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDate(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: timezone }).toFormat('yyyy-MM-dd');
}

export function goalStartDate(goal: SavingsGoal, context: GoalContext): string {
  return goal.startDate ? dateOnly(goal.startDate) : localDate(goal.createdAt, context.timezone);
}

export function goalTargetDate(goal: SavingsGoal): string | null {
  return goal.targetDate ? dateOnly(goal.targetDate) : null;
}

/**
 * Whole calendar months from today to the target date, rounded up so a target
 * later this month still counts as one month. Returns 0 once the date passes.
 */
export function monthsRemaining(today: string, targetDate: string | null): number | null {
  if (!targetDate) return null;
  if (targetDate <= today) return 0;
  const months = DateTime.fromISO(targetDate, { zone: 'utc' }).diff(
    DateTime.fromISO(today, { zone: 'utc' }),
    'months',
  ).months;
  return Math.max(1, Math.ceil(months));
}

export function goalIsOverdue(
  status: GoalStatus,
  targetDate: string | null,
  today: string,
): boolean {
  return status === 'ACTIVE' && targetDate !== null && targetDate < today;
}

export function goalDisplayStatus(status: GoalStatus, isOverdue: boolean): GoalDisplayStatus {
  if (status === 'ACTIVE' && isOverdue) return 'OVERDUE';
  return status;
}

/**
 * The remaining amount spread over the months left. There is nothing to plan
 * for when the goal is paused/archived, has no deadline, or is already late:
 * those return null instead of dividing by zero. A funded or completed goal
 * asks for zero.
 */
export function requiredMonthlySaving(
  status: GoalStatus,
  remaining: Prisma.Decimal,
  months: number | null,
): string | null {
  if (status === 'PAUSED' || status === 'ARCHIVED') return null;
  if (status === 'COMPLETED' || remaining.isZero()) return moneyString(0);
  if (months === null || months <= 0) return null;
  return moneyString(remaining.dividedBy(months));
}

export function toGoalDto(goal: GoalWithContributions, context: GoalContext): GoalDto {
  const saved = sumContributions(goal.contributions);
  const remaining = Prisma.Decimal.max(goal.targetAmount.minus(saved), new Prisma.Decimal(0));
  const startDate = goalStartDate(goal, context);
  const targetDate = goalTargetDate(goal);
  const months = monthsRemaining(context.today, targetDate);
  const isOverdue = goalIsOverdue(goal.status, targetDate, context.today);

  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    targetAmount: moneyString(goal.targetAmount),
    savedAmount: moneyString(saved),
    remainingAmount: moneyString(remaining),
    percentage: percentage(saved, goal.targetAmount),
    currency: goal.currency,
    startDate,
    targetDate,
    status: goal.status,
    displayStatus: goalDisplayStatus(goal.status, isOverdue),
    isOverdue,
    monthsRemaining: months,
    requiredMonthlySaving: requiredMonthlySaving(goal.status, remaining, months),
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
