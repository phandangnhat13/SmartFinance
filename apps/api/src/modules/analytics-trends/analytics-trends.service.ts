import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnalyticsAmountPointDto,
  AnalyticsCategoryChangeDirection,
  AnalyticsCategoryChangeDto,
  AnalyticsChangeDto,
  AnalyticsExpenseDto,
  AnalyticsExtremeMonthDto,
  AnalyticsIncomeDto,
  AnalyticsIncomeSourceDto,
  AnalyticsOverviewDto,
  AnalyticsPeriodComparisonDto,
  AnalyticsPeriodDescriptorDto,
  AnalyticsPeriodStatus,
  AnalyticsTrendPointDto,
  AnalyticsTrendsDto,
  InsightMonthPointDto,
  InsightMonthStatus,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { changePercent, moneyString, percentage, toDecimal } from '../../common/utils/money';
import { isValidTimezone, MONTH_REGEX, resolveMonthPeriod } from '../../common/utils/period';
import { InsightsService } from '../insights/insights.service';
import {
  AnalyticsPeriodInput,
  InvalidPeriodError,
  resolveAnalyticsPeriod,
  type ResolvedPeriodRange,
} from './analytics-period';
import type { AnalyticsPeriodQuery, AnalyticsRangeQuery } from './dto/analytics-trends.query';

const FALLBACK_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';
const DEFAULT_TREND_MONTHS = 6;
const DEFAULT_ANALYSIS_MONTHS = 12;
const NOTABLE_CATEGORY_LIMIT = 10;

interface RangeTotals {
  income: Prisma.Decimal;
  expense: Prisma.Decimal;
  net: Prisma.Decimal;
  savingsRate: number | null;
  transactionCount: number;
}

interface AmountPoint {
  month: string;
  monthStatus: InsightMonthStatus;
  amount: Prisma.Decimal;
  hasTransactions: boolean;
}

interface CategorizedChange {
  categoryId: string | null;
  categoryName: string;
  currentTotal: Prisma.Decimal;
  previousTotal: Prisma.Decimal;
  change: Prisma.Decimal;
  direction: AnalyticsCategoryChangeDirection;
}

/**
 * Income & expense trend analytics (M3a).
 *
 * Read-only and rule-based. Every number comes from INCOME/EXPENSE rows of one
 * currency; TRANSFER rows are never counted. Monthly series are delegated to
 * `InsightsService.monthly()` so the calendar/timezone/currency rules stay in
 * one place, including the `hasTransactions` flag that distinguishes a month
 * with no data from a measured zero.
 */
@Injectable()
export class AnalyticsTrendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
  ) {}

  async overview(userId: string, query: AnalyticsPeriodQuery): Promise<AnalyticsOverviewDto> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);
    const { current, previous } = this.resolvePeriod(query, timezone);

    const [currentTotals, previousTotals, availableCurrencies] = await Promise.all([
      this.rangeTotals(userId, currency, current),
      this.rangeTotals(userId, currency, previous),
      this.availableCurrencies(userId, defaultCurrency),
    ]);

    return {
      currency,
      timezone,
      period: this.descriptor(current),
      income: moneyString(currentTotals.income),
      expense: moneyString(currentTotals.expense),
      net: moneyString(currentTotals.net),
      savingsRate: currentTotals.savingsRate,
      transactionCount: currentTotals.transactionCount,
      hasTransactions: currentTotals.transactionCount > 0,
      estimated: false,
      previous: {
        period: this.descriptor(previous),
        income: moneyString(previousTotals.income),
        expense: moneyString(previousTotals.expense),
        net: moneyString(previousTotals.net),
        savingsRate: previousTotals.savingsRate,
        transactionCount: previousTotals.transactionCount,
        hasTransactions: previousTotals.transactionCount > 0,
      },
      changes: this.buildChanges(currentTotals, previousTotals),
      availableCurrencies,
    };
  }

  async trends(userId: string, query: AnalyticsRangeQuery): Promise<AnalyticsTrendsDto> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const months = this.resolveMonths(query.months, DEFAULT_TREND_MONTHS);
    const month = this.resolveAnchor(query.month, timezone);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);

    const monthly = await this.insights.monthly(userId, { months, month, currency });
    const points: AnalyticsTrendPointDto[] = monthly.months.map((point) => ({ ...point }));

    return {
      currency: monthly.currency,
      timezone: monthly.timezone,
      rangeMonths: months,
      estimated: false,
      points,
    };
  }

  async income(userId: string, query: AnalyticsRangeQuery): Promise<AnalyticsIncomeDto> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const months = this.resolveMonths(query.months, DEFAULT_ANALYSIS_MONTHS);
    const month = this.resolveAnchor(query.month, timezone);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);

    const monthly = await this.insights.monthly(userId, { months, month, currency });
    const points = this.amountPoints(monthly.months, 'income');
    const total = points.reduce((sum, point) => sum.plus(point.amount), new Prisma.Decimal(0));
    const withIncome = points.filter((point) => point.amount.greaterThan(0));
    const [highest, lowest] = this.extremes(withIncome);
    const sources = await this.incomeSources(
      userId,
      monthly.currency,
      monthly.months,
      total,
      timezone,
    );

    return {
      currency: monthly.currency,
      timezone: monthly.timezone,
      rangeMonths: months,
      estimated: false,
      points: this.serializeAmountPoints(points),
      total: moneyString(total),
      averageMonthly:
        withIncome.length === 0 ? null : moneyString(total.dividedBy(withIncome.length)),
      monthsWithIncome: withIncome.length,
      highest,
      lowest,
      sources,
    };
  }

  async expenses(userId: string, query: AnalyticsRangeQuery): Promise<AnalyticsExpenseDto> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const months = this.resolveMonths(query.months, DEFAULT_ANALYSIS_MONTHS);
    const month = this.resolveAnchor(query.month, timezone);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);

    const monthly = await this.insights.monthly(userId, { months, month, currency });
    const points = this.amountPoints(monthly.months, 'expense');
    const total = points.reduce((sum, point) => sum.plus(point.amount), new Prisma.Decimal(0));
    const withExpense = points.filter((point) => point.amount.greaterThan(0));
    const [highest, lowest] = this.extremes(withExpense);
    const streaks = this.increasingStreaks(points);

    return {
      currency: monthly.currency,
      timezone: monthly.timezone,
      rangeMonths: months,
      estimated: false,
      points: this.serializeAmountPoints(points),
      total: moneyString(total),
      averageMonthly:
        withExpense.length === 0 ? null : moneyString(total.dividedBy(withExpense.length)),
      monthsWithExpense: withExpense.length,
      highest,
      lowest,
      volatilityPercent: this.volatilityPercent(withExpense),
      longestIncreasingStreak: streaks.longest,
      currentIncreasingStreak: streaks.current,
    };
  }

  async comparison(
    userId: string,
    query: AnalyticsPeriodQuery,
  ): Promise<AnalyticsPeriodComparisonDto> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);
    const { current, previous } = this.resolvePeriod(query, timezone);

    const [currentTotals, previousTotals, currentCategories, previousCategories] =
      await Promise.all([
        this.rangeTotals(userId, currency, current),
        this.rangeTotals(userId, currency, previous),
        this.categoryTotals(userId, currency, current),
        this.categoryTotals(userId, currency, previous),
      ]);

    const notableCategoryChanges = await this.buildCategoryChanges(
      currentCategories,
      previousCategories,
    );

    return {
      currency,
      timezone,
      estimated: false,
      current: {
        period: this.descriptor(current),
        income: moneyString(currentTotals.income),
        expense: moneyString(currentTotals.expense),
        net: moneyString(currentTotals.net),
        savingsRate: currentTotals.savingsRate,
        transactionCount: currentTotals.transactionCount,
        hasTransactions: currentTotals.transactionCount > 0,
      },
      previous: {
        period: this.descriptor(previous),
        income: moneyString(previousTotals.income),
        expense: moneyString(previousTotals.expense),
        net: moneyString(previousTotals.net),
        savingsRate: previousTotals.savingsRate,
        transactionCount: previousTotals.transactionCount,
        hasTransactions: previousTotals.transactionCount > 0,
      },
      changes: this.buildChanges(currentTotals, previousTotals),
      notableCategoryChanges,
    };
  }

  /* --------------------------- internals --------------------------- */

  private async getContext(userId: string): Promise<{ timezone: string; defaultCurrency: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    // A stored profile value can be any string; fall back instead of failing
    // every request when it is not a valid IANA zone.
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

  private resolveMonths(requested: number | undefined, fallback: number): number {
    const months = requested ?? fallback;
    if (![3, 6, 12, 24].includes(months)) {
      throw new BadRequestException('months phải là 3, 6, 12 hoặc 24');
    }
    return months;
  }

  private resolveAnchor(requested: string | undefined, timezone: string): string {
    const now = DateTime.now().setZone(timezone);
    const anchor = requested ?? now.toFormat('yyyy-MM');
    if (!MONTH_REGEX.test(anchor)) {
      throw new BadRequestException('month phải có định dạng yyyy-MM');
    }
    if (anchor > now.toFormat('yyyy-MM')) {
      throw new BadRequestException('Không thể phân tích tháng trong tương lai');
    }
    return anchor;
  }

  private async rangeTotals(
    userId: string,
    currency: string,
    range: Pick<ResolvedPeriodRange, 'start' | 'endExclusive'>,
  ): Promise<RangeTotals> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        userId,
        currency,
        type: { in: ['INCOME', 'EXPENSE'] },
        occurredAt: { gte: range.start, lt: range.endExclusive },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    let income = new Prisma.Decimal(0);
    let expense = new Prisma.Decimal(0);
    let transactionCount = 0;
    for (const row of grouped) {
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      transactionCount += row._count._all;
      if (row.type === 'INCOME') income = income.plus(amount);
      if (row.type === 'EXPENSE') expense = expense.plus(amount);
    }

    const net = income.minus(expense);
    return {
      income,
      expense,
      net,
      savingsRate: income.lessThanOrEqualTo(0)
        ? null
        : Number(net.dividedBy(income).times(100).toFixed(2)),
      transactionCount,
    };
  }

  private buildChanges(current: RangeTotals, previous: RangeTotals) {
    return {
      income: this.change(current.income, previous.income),
      expense: this.change(current.expense, previous.expense),
      net: this.change(current.net, previous.net),
      savingsRatePoints:
        current.savingsRate === null || previous.savingsRate === null
          ? null
          : Number((current.savingsRate - previous.savingsRate).toFixed(2)),
    };
  }

  private change(current: Prisma.Decimal, previous: Prisma.Decimal): AnalyticsChangeDto {
    return {
      amount: moneyString(current.minus(previous)),
      percent: changePercent(current, previous),
    };
  }

  private descriptor(range: ResolvedPeriodRange): AnalyticsPeriodDescriptorDto {
    return {
      kind: range.kind,
      label: range.label,
      from: range.from,
      to: range.to,
      status: this.periodStatus(range),
    };
  }

  private periodStatus(range: ResolvedPeriodRange): AnalyticsPeriodStatus {
    return range.endExclusive.getTime() > Date.now() ? 'in_progress' : 'complete';
  }

  private async availableCurrencies(userId: string, defaultCurrency: string): Promise<string[]> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['currency'],
      where: { userId },
      orderBy: { currency: 'asc' },
    });
    return [
      defaultCurrency,
      ...rows.map((row) => row.currency).filter((code) => code !== defaultCurrency),
    ];
  }

  private amountPoints(months: InsightMonthPointDto[], field: 'income' | 'expense'): AmountPoint[] {
    return months.map((point) => ({
      month: point.month,
      monthStatus: point.monthStatus,
      amount: toDecimal(point[field]),
      hasTransactions: point.hasTransactions,
    }));
  }

  private serializeAmountPoints(points: AmountPoint[]): AnalyticsAmountPointDto[] {
    return points.map((point, index) => {
      const previousAmount = index > 0 ? points[index - 1].amount : null;
      return {
        month: point.month,
        monthStatus: point.monthStatus,
        amount: moneyString(point.amount),
        hasTransactions: point.hasTransactions,
        changePercent: previousAmount === null ? null : changePercent(point.amount, previousAmount),
      };
    });
  }

  private extremes(
    points: AmountPoint[],
  ): [AnalyticsExtremeMonthDto | null, AnalyticsExtremeMonthDto | null] {
    if (points.length === 0) return [null, null];

    let highest = points[0];
    let lowest = points[0];
    for (const point of points) {
      if (point.amount.greaterThan(highest.amount)) highest = point;
      if (point.amount.lessThan(lowest.amount)) lowest = point;
    }
    return [
      { month: highest.month, amount: moneyString(highest.amount) },
      { month: lowest.month, amount: moneyString(lowest.amount) },
    ];
  }

  private async incomeSources(
    userId: string,
    currency: string,
    months: InsightMonthPointDto[],
    total: Prisma.Decimal,
    timezone: string,
  ): Promise<AnalyticsIncomeSourceDto[]> {
    if (months.length === 0 || total.isZero()) return [];

    const first = resolveMonthPeriod(months[0].month, timezone);
    const last = resolveMonthPeriod(months[months.length - 1].month, timezone);

    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        currency,
        type: 'INCOME',
        occurredAt: { gte: first.start, lt: last.endExclusive },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const categoryIds = grouped
      .map((row) => row.categoryId)
      .filter((id): id is string => id !== null);
    const names = new Map<string, string>(
      categoryIds.length
        ? (
            await this.prisma.category.findMany({
              where: { id: { in: categoryIds } },
              select: { id: true, name: true },
            })
          ).map((category) => [category.id, category.name] as const)
        : [],
    );

    return grouped
      .map((row) => {
        const amount = row._sum.amount ?? new Prisma.Decimal(0);
        return {
          categoryId: row.categoryId,
          categoryName:
            row.categoryId === null
              ? 'Chưa phân loại'
              : (names.get(row.categoryId) ?? 'Không xác định'),
          total: moneyString(amount),
          sharePercent: percentage(amount, total),
          transactionCount: row._count._all,
          sortAmount: amount,
        };
      })
      .sort(
        (left, right) =>
          right.sortAmount.comparedTo(left.sortAmount) ||
          left.categoryName.localeCompare(right.categoryName),
      )
      .map(({ sortAmount: _sortAmount, ...item }) => item);
  }

  private volatilityPercent(points: AmountPoint[]): number | null {
    const values = points.map((point) => Number(point.amount));
    if (values.length < 2) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0) return null;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Number(((Math.sqrt(variance) / mean) * 100).toFixed(2));
  }

  /**
   * Counts month-over-month increases. A month with no transactions breaks the
   * run; a month with transactions but zero expense is a measured zero and can
   * end a run but never starts one.
   */
  private increasingStreaks(points: AmountPoint[]): { longest: number; current: number } {
    let longest = 0;
    let streak = 0;
    let previous: number | null = null;

    for (const point of points) {
      if (!point.hasTransactions) {
        previous = null;
        streak = 0;
        continue;
      }
      const value = Number(point.amount);
      if (previous !== null && previous > 0 && value > previous) {
        streak += 1;
      } else {
        streak = 0;
      }
      if (streak > longest) longest = streak;
      previous = value;
    }

    return { longest, current: streak };
  }

  private async categoryTotals(
    userId: string,
    currency: string,
    range: Pick<ResolvedPeriodRange, 'start' | 'endExclusive'>,
  ): Promise<Map<string | null, Prisma.Decimal>> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        currency,
        type: 'EXPENSE',
        occurredAt: { gte: range.start, lt: range.endExclusive },
      },
      _sum: { amount: true },
    });

    return new Map(
      grouped.map((row) => [row.categoryId, row._sum.amount ?? new Prisma.Decimal(0)] as const),
    );
  }

  private async buildCategoryChanges(
    current: Map<string | null, Prisma.Decimal>,
    previous: Map<string | null, Prisma.Decimal>,
  ): Promise<AnalyticsCategoryChangeDto[]> {
    const categoryIds = [...new Set([...current.keys(), ...previous.keys()])];
    const namedIds = categoryIds.filter((id): id is string => id !== null);
    const names = new Map<string, string>(
      namedIds.length
        ? (
            await this.prisma.category.findMany({
              where: { id: { in: namedIds } },
              select: { id: true, name: true },
            })
          ).map((category) => [category.id, category.name] as const)
        : [],
    );

    const changes: CategorizedChange[] = categoryIds
      .map((categoryId) => {
        const currentTotal = current.get(categoryId) ?? new Prisma.Decimal(0);
        const previousTotal = previous.get(categoryId) ?? new Prisma.Decimal(0);
        const change = currentTotal.minus(previousTotal);
        const direction: AnalyticsCategoryChangeDirection = previousTotal.isZero()
          ? 'new'
          : currentTotal.isZero()
            ? 'removed'
            : change.greaterThan(0)
              ? 'increase'
              : 'decrease';
        return {
          categoryId,
          categoryName:
            categoryId === null ? 'Chưa phân loại' : (names.get(categoryId) ?? 'Không xác định'),
          currentTotal,
          previousTotal,
          change,
          direction,
        };
      })
      .filter((item) => !item.change.isZero())
      .sort(
        (left, right) =>
          right.change.abs().comparedTo(left.change.abs()) ||
          left.categoryName.localeCompare(right.categoryName),
      )
      .slice(0, NOTABLE_CATEGORY_LIMIT);

    return changes.map((item) => ({
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      currentTotal: moneyString(item.currentTotal),
      previousTotal: moneyString(item.previousTotal),
      changeAmount: moneyString(item.change),
      changePercent: changePercent(item.currentTotal, item.previousTotal),
      direction: item.direction,
    }));
  }
}
