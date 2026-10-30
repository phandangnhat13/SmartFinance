import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnalyticsBudgetPaceDto,
  AnalyticsBudgetsDto,
  AnalyticsCategoriesDto,
  AnalyticsCategoryChangeDirection,
  AnalyticsCategoryRowDto,
  AnalyticsCategoryTrendDto,
  AnalyticsCategoryView,
  BudgetAnalyticsItemDto,
  BudgetAnalyticsStatus,
  BudgetPaceItemDto,
  InsightMonthStatus,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { changePercent, moneyString, percentage, toDecimal } from '../../common/utils/money';
import { isValidTimezone, resolveMonthPeriod } from '../../common/utils/period';
import {
  buildBudgetPace,
  classifyBudgetStatus,
  lowestWarningThreshold,
  resolveBudgetTimeframe,
} from './budget-analytics';
import type { AnalyticsPeriodInput } from '../analytics-trends/analytics-period';
import { InvalidPeriodError, resolveAnalyticsPeriod } from '../analytics-trends/analytics-period';
import type { BudgetAnalyticsQuery, CategoryAnalyticsQuery } from './dto/category-budget.query';

const FALLBACK_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';
const DEFAULT_TREND_MONTHS = 6;
/** Product rule shared with insights: a rise of at least this much is notable. */
export const NOTABLE_INCREASE_PERCENT = 25;

interface CategoryTotals {
  amount: Prisma.Decimal;
  transactionCount: number;
}

/**
 * Category & budget analytics (M3b). Read-only.
 *
 * Category rows are grouped by `categoryId` (never by name), scoped to one
 * currency and one period resolved with the M3a period resolver. Budgets are
 * month-scoped by the model itself; the Budget table has no currency column, so
 * the requested currency is the one the limit is read in and the only currency
 * whose spending counts.
 */
@Injectable()
export class CategoryBudgetAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async categories(userId: string, query: CategoryAnalyticsQuery): Promise<AnalyticsCategoriesDto> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);
    const type: AnalyticsCategoryView = query.type ?? 'EXPENSE';
    const { current, previous } = this.resolvePeriod(query, timezone);

    const [currentMap, previousMap, names] = await Promise.all([
      this.categoryTotals(userId, currency, type, current.start, current.endExclusive),
      this.categoryTotals(userId, currency, type, previous.start, previous.endExclusive),
      this.categoryNames(userId),
    ]);

    const total = [...currentMap.values()].reduce(
      (sum, row) => sum.plus(row.amount),
      new Prisma.Decimal(0),
    );
    const previousTotal = [...previousMap.values()].reduce(
      (sum, row) => sum.plus(row.amount),
      new Prisma.Decimal(0),
    );

    const todayISO = DateTime.now().setZone(timezone).toISODate()!;
    const monthsInPeriod = this.monthsInPeriod(current.from, current.to, todayISO);

    const rows: AnalyticsCategoryRowDto[] = [
      ...new Set([...currentMap.keys(), ...previousMap.keys()]),
    ]
      .map((categoryId) => {
        const currentRow = currentMap.get(categoryId);
        const previousRow = previousMap.get(categoryId);
        const currentAmount = currentRow?.amount ?? new Prisma.Decimal(0);
        const previousAmount = previousRow?.amount ?? new Prisma.Decimal(0);
        const change = currentAmount.minus(previousAmount);
        const direction: AnalyticsCategoryChangeDirection = previousAmount.isZero()
          ? 'new'
          : currentAmount.isZero()
            ? 'removed'
            : change.greaterThan(0)
              ? 'increase'
              : 'decrease';
        const percent = changePercent(currentAmount, previousAmount);
        const meta = categoryId === null ? null : names.get(categoryId);

        return {
          categoryId,
          categoryName: categoryId === null ? 'Chưa phân loại' : (meta?.name ?? 'Không xác định'),
          isArchived: meta?.isArchived ?? false,
          total: moneyString(currentAmount),
          transactionCount: currentRow?.transactionCount ?? 0,
          sharePercent: percentage(currentAmount, total),
          averageMonthly:
            monthsInPeriod > 0 ? moneyString(currentAmount.dividedBy(monthsInPeriod)) : null,
          previousTotal: moneyString(previousAmount),
          changeAmount: moneyString(change),
          changePercent: percent,
          direction,
          notableIncrease:
            direction === 'increase' && percent !== null && percent >= NOTABLE_INCREASE_PERCENT,
          isNew: direction === 'new',
          isRemoved: direction === 'removed',
          rank: null,
        };
      })
      .sort((left, right) => {
        const compared = toDecimal(right.total).comparedTo(toDecimal(left.total));
        return compared !== 0 ? compared : left.categoryName.localeCompare(right.categoryName);
      });

    let rank = 0;
    for (const row of rows) {
      if (Number(row.total) > 0) {
        rank += 1;
        row.rank = rank;
      }
    }

    const trend = query.categoryId
      ? await this.categoryTrend(userId, query, currency, type, timezone, current)
      : null;

    return {
      currency,
      timezone,
      type,
      estimated: false,
      period: this.descriptor(current),
      previousPeriod: this.descriptor(previous),
      total: moneyString(total),
      previousTotal: moneyString(previousTotal),
      hasTransactions: [...currentMap.values()].some((row) => row.transactionCount > 0),
      monthsInPeriod,
      notableIncreasePercent: NOTABLE_INCREASE_PERCENT,
      categories: rows,
      trend,
    };
  }

  async budgets(userId: string, query: BudgetAnalyticsQuery): Promise<AnalyticsBudgetsDto> {
    const { currency, timezone, month, asOf } = await this.resolveBudgetContext(userId, query);
    const monthPeriod = resolveMonthPeriod(month, timezone);
    const items = await this.buildBudgetItems(userId, currency, month, timezone, asOf);

    const summary = {
      budgetCount: items.length,
      exceededCount: items.filter((item) => item.status === 'EXCEEDED').length,
      warningCount: items.filter((item) => item.status === 'WARNING').length,
      onTrackCount: items.filter((item) => item.status === 'ON_TRACK').length,
      notStartedCount: items.filter((item) => item.status === 'NOT_STARTED').length,
      completedCount: items.filter((item) => item.status === 'COMPLETED').length,
    };

    return {
      currency,
      timezone,
      month,
      estimated: false,
      asOf,
      monthStatus: monthPeriod.endExclusive.getTime() > Date.now() ? 'in_progress' : 'complete',
      assumesLimitCurrency: currency,
      summary,
      items,
    };
  }

  async budgetPace(userId: string, query: BudgetAnalyticsQuery): Promise<AnalyticsBudgetPaceDto> {
    const { currency, timezone, month, asOf } = await this.resolveBudgetContext(userId, query);
    const items = await this.buildBudgetItems(userId, currency, month, timezone, asOf);

    return {
      currency,
      timezone,
      month,
      estimated: false,
      asOf,
      items: items.map((item): BudgetPaceItemDto => ({
        budgetId: item.id,
        name: item.name,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        status: item.status,
        limitAmount: item.limitAmount,
        spent: item.spent,
        expectedSpend: item.expectedSpend,
        variance: item.variance,
        pacePercent: item.pacePercent,
        dailySpendingAverage: item.dailySpendingAverage,
        daysElapsed: item.daysElapsed,
        daysRemaining: item.daysRemaining,
        estimatedExhaustionDate: item.estimatedExhaustionDate,
        exhaustionProjection: item.exhaustionProjection,
      })),
    };
  }

  /* --------------------------- internals --------------------------- */

  private async buildBudgetItems(
    userId: string,
    currency: string,
    month: string,
    timezone: string,
    asOf: string,
  ): Promise<BudgetAnalyticsItemDto[]> {
    const monthPeriod = resolveMonthPeriod(month, timezone);
    const budgets = await this.prisma.budget.findMany({
      where: { userId, periodStart: monthPeriod.periodStart },
      include: { category: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    });
    if (budgets.length === 0) return [];

    // One aggregate for every budget of the month; category budgets read their
    // own bucket and the ALL-scope budget reads the total.
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        currency,
        type: 'EXPENSE',
        occurredAt: { gte: monthPeriod.start, lt: monthPeriod.endExclusive },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    let totalSpent = new Prisma.Decimal(0);
    let totalCount = 0;
    const byCategory = new Map<string, { amount: Prisma.Decimal; transactionCount: number }>();
    for (const row of grouped) {
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      totalSpent = totalSpent.plus(amount);
      totalCount += row._count._all;
      if (row.categoryId !== null) {
        byCategory.set(row.categoryId, { amount, transactionCount: row._count._all });
      }
    }

    return budgets.map((budget) => {
      const bucket = budget.categoryId ? byCategory.get(budget.categoryId) : undefined;
      const spent = budget.categoryId ? (bucket?.amount ?? new Prisma.Decimal(0)) : totalSpent;
      const transactionCount = budget.categoryId ? (bucket?.transactionCount ?? 0) : totalCount;
      const limit = toDecimal(budget.limitAmount);
      const startDate = budget.periodStart.toISOString().slice(0, 10);
      const endDate = budget.periodEnd.toISOString().slice(0, 10);
      const timeframe = resolveBudgetTimeframe(startDate, endDate, asOf);
      const status = classifyBudgetStatus({
        limit,
        spent,
        warningThresholds: budget.warningThresholds,
        state: timeframe.state,
      });
      const pace = buildBudgetPace({ limit, spent, timeframe });

      return {
        id: budget.id,
        name: budget.name,
        categoryId: budget.categoryId,
        categoryName: budget.category?.name ?? null,
        limitAmount: moneyString(limit),
        spent: moneyString(spent),
        remaining: moneyString(limit.minus(spent)),
        usagePercent: limit.lessThanOrEqualTo(0)
          ? null
          : Number(spent.dividedBy(limit).times(100).toFixed(2)),
        status,
        warningThreshold: lowestWarningThreshold(budget.warningThresholds),
        periodStart: startDate,
        periodEnd: endDate,
        totalDays: timeframe.totalDays,
        daysElapsed: timeframe.daysElapsed,
        daysRemaining: timeframe.daysRemaining,
        dailySpendingAverage: pace.dailySpendingAverage,
        expectedSpend: pace.expectedSpend,
        variance: pace.variance,
        pacePercent: pace.pacePercent,
        estimatedExhaustionDate: pace.estimatedExhaustionDate,
        exhaustionProjection: pace.exhaustionProjection,
        transactionCount,
      };
    });
  }

  private async resolveBudgetContext(userId: string, query: BudgetAnalyticsQuery) {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);
    const asOf = DateTime.now().setZone(timezone).toISODate()!;
    const month = query.month ?? asOf.slice(0, 7);
    // `resolveMonthPeriod` validates the YYYY-MM shape and the timezone.
    try {
      resolveMonthPeriod(month, timezone);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Tháng không hợp lệ');
    }
    return { currency, timezone, month, asOf };
  }

  private async getContext(userId: string): Promise<{ timezone: string; defaultCurrency: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : FALLBACK_TIMEZONE;
    return { timezone, defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY };
  }

  private resolveCurrency(requested: string | undefined, defaultCurrency: string): string {
    return (requested ?? defaultCurrency).toUpperCase() || DEFAULT_CURRENCY;
  }

  private resolvePeriod(query: AnalyticsPeriodInput, timezone: string) {
    try {
      return resolveAnalyticsPeriod(query, timezone);
    } catch (error) {
      if (error instanceof InvalidPeriodError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private descriptor(range: {
    kind: string;
    label: string;
    from: string;
    to: string;
    endExclusive: Date;
  }) {
    return {
      kind: range.kind as 'month' | 'quarter' | 'year' | 'custom',
      label: range.label,
      from: range.from,
      to: range.to,
      status:
        range.endExclusive.getTime() > Date.now()
          ? ('in_progress' as const)
          : ('complete' as const),
    };
  }

  private monthsInPeriod(from: string, to: string, todayISO: string): number {
    const last = (to < todayISO ? to : todayISO).slice(0, 7);
    const first = from.slice(0, 7);
    const start = DateTime.fromFormat(first, 'yyyy-MM', { zone: 'utc' });
    const end = DateTime.fromFormat(last, 'yyyy-MM', { zone: 'utc' });
    return Math.max(1, Math.round(end.diff(start, 'months').months) + 1);
  }

  private async categoryTotals(
    userId: string,
    currency: string,
    type: AnalyticsCategoryView,
    start: Date,
    endExclusive: Date,
  ): Promise<Map<string | null, CategoryTotals>> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, currency, type, occurredAt: { gte: start, lt: endExclusive } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return new Map(
      grouped.map(
        (row) =>
          [
            row.categoryId,
            {
              amount: row._sum.amount ?? new Prisma.Decimal(0),
              transactionCount: row._count._all,
            },
          ] as const,
      ),
    );
  }

  private async categoryNames(
    userId: string,
  ): Promise<Map<string, { name: string; isArchived: boolean }>> {
    const categories = await this.prisma.category.findMany({
      where: {
        OR: [{ userId }, { isSystem: true }],
      },
      select: { id: true, name: true, isArchived: true },
    });
    return new Map(
      categories.map((category) => [
        category.id,
        { name: category.name, isArchived: category.isArchived },
      ]),
    );
  }

  private async categoryTrend(
    userId: string,
    query: CategoryAnalyticsQuery,
    currency: string,
    type: AnalyticsCategoryView,
    timezone: string,
    period: { from: string; to: string },
  ): Promise<AnalyticsCategoryTrendDto> {
    const now = DateTime.now().setZone(timezone);
    const currentMonth = now.toFormat('yyyy-MM');
    const requestedMonths = query.months ?? DEFAULT_TREND_MONTHS;
    if (![3, 6, 12, 24].includes(requestedMonths)) {
      throw new BadRequestException('months phải là 3, 6, 12 hoặc 24');
    }

    const defaultAnchor = (period.to < now.toISODate()! ? period.to : now.toISODate()!).slice(0, 7);
    const anchor = query.month ?? defaultAnchor;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(anchor)) {
      throw new BadRequestException('month phải có định dạng yyyy-MM');
    }
    if (anchor > currentMonth) {
      throw new BadRequestException('Không thể phân tích tháng trong tương lai');
    }

    const anchorDate = DateTime.fromFormat(anchor, 'yyyy-MM', { zone: timezone });
    const firstMonth = anchorDate.minus({ months: requestedMonths - 1 }).toFormat('yyyy-MM');
    const first = resolveMonthPeriod(firstMonth, timezone);
    const last = resolveMonthPeriod(anchor, timezone);

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        currency,
        type,
        categoryId: query.categoryId!,
        occurredAt: { gte: first.start, lt: last.endExclusive },
      },
      select: { amount: true, occurredAt: true },
    });

    const byMonth = new Map<string, { amount: Prisma.Decimal; hasTransactions: boolean }>();
    for (const row of rows) {
      const month = DateTime.fromJSDate(row.occurredAt).setZone(timezone).toFormat('yyyy-MM');
      const bucket = byMonth.get(month) ?? {
        amount: new Prisma.Decimal(0),
        hasTransactions: false,
      };
      bucket.amount = bucket.amount.plus(row.amount);
      bucket.hasTransactions = true;
      byMonth.set(month, bucket);
    }

    const months: string[] = [];
    for (let index = 0; index < requestedMonths; index += 1) {
      months.push(anchorDate.minus({ months: requestedMonths - 1 - index }).toFormat('yyyy-MM'));
    }

    const points = months.map((month, index) => {
      const bucket = byMonth.get(month);
      const amount = bucket?.amount ?? new Prisma.Decimal(0);
      const previousBucket = index > 0 ? byMonth.get(months[index - 1]) : undefined;
      const monthStatus: InsightMonthStatus = month === currentMonth ? 'in_progress' : 'complete';
      return {
        month,
        monthStatus,
        amount: moneyString(amount),
        hasTransactions: bucket?.hasTransactions ?? false,
        changePercent: previousBucket ? changePercent(amount, previousBucket.amount) : null,
      };
    });

    const category = await this.prisma.category.findUnique({
      where: { id: query.categoryId },
      select: { id: true, name: true, userId: true, isSystem: true },
    });
    const accessible = category && (category.isSystem || category.userId === userId);

    return {
      categoryId: query.categoryId!,
      categoryName: accessible ? category.name : 'Không xác định',
      rangeMonths: requestedMonths,
      points,
    };
  }
}

// A defensive export so status unions remain in sync with the shared contract.
export type { BudgetAnalyticsStatus };
