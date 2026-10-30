import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ContributionMonthDto,
  GoalDto,
  GoalProgressDto,
  SavingsProgressDto,
  SavingsProgressStatus,
} from '@smart-finance/shared-types';
import type { GoalContribution, SavingsGoal } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { moneyString, toDecimal } from '../../common/utils/money';
import { isValidTimezone } from '../../common/utils/period';
import { toGoalDto } from '../goals/goal.mapper';
import type { ContributionHistoryQuery, SavingsProgressQuery } from './dto/savings.dto';
import {
  buildGoalProgress,
  progressLimitations,
  progressRules,
  summarizeProgress,
  toProgressInput,
  type ProgressOptions,
} from './savings-progress';

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';
const DEFAULT_HISTORY_MONTHS = 12;
/** One response never carries more than this many individual contributions. */
const MAX_HISTORY_ITEMS = 200;

/** Most urgent first, so the dashboard's at-risk goals are never buried. */
const PROGRESS_PRIORITY: Record<SavingsProgressStatus, number> = {
  OVERDUE: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
  INSUFFICIENT_DATA: 3,
  PAUSED: 4,
  COMPLETED: 5,
};

type GoalWithContributions = SavingsGoal & { contributions: GoalContribution[] };

export interface ProgressContext extends ProgressOptions {
  defaultCurrency: string;
}

/**
 * Reads the owner's goals and contributions and turns them into progress
 * figures. Read-only: no goal row is ever updated and no contribution is
 * written. The arithmetic lives in `savings-progress.ts`.
 */
@Injectable()
export class SavingsProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async contextFor(userId: string): Promise<ProgressContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE;
    return {
      timezone,
      today: DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd'),
      defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY,
    };
  }

  async progress(userId: string, query: SavingsProgressQuery): Promise<SavingsProgressDto> {
    const { timezone, today, defaultCurrency } = await this.contextFor(userId);
    const currency = (query.currency ?? defaultCurrency).toUpperCase();

    const goals = await this.prisma.savingsGoal.findMany({
      where: { userId, currency },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });

    let archived = 0;
    const progressGoals = goals
      .filter((goal) => {
        if (goal.status === 'ARCHIVED') {
          archived += 1;
          return false;
        }
        return true;
      })
      .map((goal) =>
        buildGoalProgress(toProgressInput(toGoalDto(goal, { timezone, today })), {
          timezone,
          today,
        }),
      )
      .sort(
        (left, right) =>
          PROGRESS_PRIORITY[left.progressStatus] - PROGRESS_PRIORITY[right.progressStatus] ||
          left.name.localeCompare(right.name, 'vi') ||
          left.goalId.localeCompare(right.goalId),
      );

    return {
      currency,
      timezone,
      today,
      generatedAt: new Date().toISOString(),
      asOf: new Date().toISOString(),
      summary: summarizeProgress(progressGoals, currency),
      goals: progressGoals,
      excluded: { archived },
      rules: progressRules(),
      limitations: progressLimitations(currency),
    };
  }

  async goalProgress(userId: string, goalId: string): Promise<GoalProgressDto> {
    const { progress } = await this.loadOwnedGoal(userId, goalId);
    return progress;
  }

  /** Ownership-checked goal plus its progress, built from the same mapper as M2b. */
  async loadOwnedGoal(
    userId: string,
    goalId: string,
  ): Promise<{ goal: GoalDto; progress: GoalProgressDto; context: ProgressContext }> {
    const context = await this.contextFor(userId);
    const dto = toGoalDto(await this.findGoal(userId, goalId), context);
    return { goal: dto, progress: buildGoalProgress(toProgressInput(dto), context), context };
  }

  /** The raw DTO too, for callers that need the goal's own fields. */
  async findOwnedGoal(userId: string, goalId: string): Promise<GoalDto> {
    const context = await this.contextFor(userId);
    return toGoalDto(await this.findGoal(userId, goalId), context);
  }

  async contributionHistory(userId: string, query: ContributionHistoryQuery) {
    const { timezone, defaultCurrency } = await this.contextFor(userId);
    const months = query.months ?? DEFAULT_HISTORY_MONTHS;

    let goalId: string | null = null;
    let currency: string;
    if (query.goalId) {
      const goal = await this.prisma.savingsGoal.findFirst({
        where: { id: query.goalId, userId },
        select: { id: true, currency: true },
      });
      if (!goal) throw new NotFoundException('Không tìm thấy mục tiêu tiết kiệm');
      goalId = goal.id;
      currency = goal.currency;
    } else {
      currency = (query.currency ?? defaultCurrency).toUpperCase();
    }

    const now = DateTime.now().setZone(timezone);
    const toMonth = now.toFormat('yyyy-MM');
    const fromMonth = now
      .startOf('month')
      .minus({ months: months - 1 })
      .toFormat('yyyy-MM');
    const windowStart = DateTime.fromFormat(fromMonth, 'yyyy-MM', { zone: timezone })
      .startOf('month')
      .toUTC()
      .toJSDate();

    const scope = {
      userId,
      ...(goalId ? { goalId } : {}),
      goal: { currency },
    };

    const [rows, opening] = await Promise.all([
      this.prisma.goalContribution.findMany({
        where: { ...scope, contributedAt: { gte: windowStart } },
        include: { goal: { select: { name: true } } },
        orderBy: { contributedAt: 'desc' },
      }),
      this.prisma.goalContribution.aggregate({
        where: { ...scope, contributedAt: { lt: windowStart } },
        _sum: { amount: true },
      }),
    ]);

    const byMonth = new Map<string, { amount: ReturnType<typeof toDecimal>; count: number }>();
    rows.forEach((row) => {
      const month = DateTime.fromJSDate(row.contributedAt, { zone: timezone }).toFormat('yyyy-MM');
      const entry = byMonth.get(month) ?? { amount: toDecimal(0), count: 0 };
      entry.amount = entry.amount.plus(row.amount);
      entry.count += 1;
      byMonth.set(month, entry);
    });

    let running = toDecimal(opening._sum.amount ?? 0);
    const monthPoints: ContributionMonthDto[] = [];
    let cursor = DateTime.fromFormat(fromMonth, 'yyyy-MM', { zone: timezone });
    for (let index = 0; index < months; index += 1) {
      const month = cursor.toFormat('yyyy-MM');
      const entry = byMonth.get(month);
      const amount = entry?.amount ?? toDecimal(0);
      running = running.plus(amount);
      monthPoints.push({
        month,
        amount: moneyString(amount),
        count: entry?.count ?? 0,
        cumulativeAmount: moneyString(running),
      });
      cursor = cursor.plus({ months: 1 });
    }

    const total = rows.reduce((sum, row) => sum.plus(row.amount), toDecimal(0));

    return {
      currency,
      timezone,
      monthCount: months,
      fromMonth,
      toMonth,
      goalId,
      openingAmount: moneyString(opening._sum.amount ?? 0),
      totalAmount: moneyString(total),
      totalCount: rows.length,
      months: monthPoints,
      items: rows.slice(0, MAX_HISTORY_ITEMS).map((row) => ({
        id: row.id,
        goalId: row.goalId,
        goalName: row.goal.name,
        amount: moneyString(row.amount),
        contributedAt: row.contributedAt.toISOString(),
        note: row.note,
      })),
      truncated: rows.length > MAX_HISTORY_ITEMS,
      limitations: [
        `Chỉ tổng hợp các khoản góp bằng ${currency} trong ${months} tháng gần nhất.`,
        'Khoản góp của mục tiêu đã lưu trữ vẫn được giữ trong lịch sử.',
        `Tối đa ${MAX_HISTORY_ITEMS} khoản góp được trả trong một lần; tổng theo tháng vẫn tính đủ cả cửa sổ.`,
      ],
    };
  }

  /** Progress input for a goal the caller already loaded (used by previews). */
  progressInput(dto: GoalDto) {
    return toProgressInput(dto);
  }

  private async findGoal(userId: string, goalId: string): Promise<GoalWithContributions> {
    const goal = await this.prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
    if (!goal) throw new NotFoundException('Không tìm thấy mục tiêu tiết kiệm');
    return goal;
  }
}
