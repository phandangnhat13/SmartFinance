import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { changePercent, moneyString, percentage, toDecimal } from '../../common/utils/money';
import {
  isValidTimezone,
  MONTH_REGEX,
  MonthPeriod,
  resolveMonthPeriod,
} from '../../common/utils/period';
import { InsightsQuery, MonthlyInsightsQuery } from './dto/insights.query';

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';
const DEFAULT_MONTHS = 6;

/**
 * A category's spending is flagged when it grew by at least this much over the
 * previous month and there was a baseline to grow from. The threshold is a
 * product rule, not a statistical test, and it is returned with the response so
 * the UI can explain why a category is highlighted.
 */
export const NOTABLE_INCREASE_PERCENT = 25;

type Money = Prisma.Decimal | string | number;
type InsightMonthStatus = 'in_progress' | 'complete';

interface MonthlyRow {
  month: string;
  income: Money;
  expense: Money;
  transactionCount: number;
}

interface Totals {
  income: Prisma.Decimal;
  expense: Prisma.Decimal;
  transactionCount: number;
}

interface CategoryRow {
  categoryId: string | null;
  total: Prisma.Decimal;
  transactionCount: number;
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Overview of one calendar month in the user's timezone. Totals only include
   * INCOME/EXPENSE rows in a single requested currency; TRANSFER rows never
   * count as either income or spending.
   */
  async overview(userId: string, query: InsightsQuery) {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const period = this.resolveMonth(query.month, timezone);
    const previousPeriod = this.shiftMonth(period.month, -1, timezone);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);

    const [current, previous, currencyRows] = await Promise.all([
      this.typeTotals(userId, currency, period),
      this.typeTotals(userId, currency, previousPeriod),
      this.prisma.transaction.groupBy({
        by: ['currency'],
        where: { userId },
        orderBy: { currency: 'asc' },
      }),
    ]);

    const usedCurrencies = currencyRows.map((row) => row.currency);
    const availableCurrencies = [
      defaultCurrency,
      ...usedCurrencies.filter((code) => code !== defaultCurrency),
    ];

    return {
      currency,
      timezone,
      month: period.month,
      monthStatus: this.monthStatus(period),
      periodStart: this.isoDate(period.periodStart),
      periodEnd: this.isoDate(period.periodEnd),
      income: moneyString(current.income),
      expense: moneyString(current.expense),
      net: moneyString(current.income.minus(current.expense)),
      savingsRate: this.savingsRate(current.income, current.expense),
      transactionCount: current.transactionCount,
      estimated: false as const,
      previous: {
        month: previousPeriod.month,
        income: moneyString(previous.income),
        expense: moneyString(previous.expense),
        net: moneyString(previous.income.minus(previous.expense)),
        savingsRate: this.savingsRate(previous.income, previous.expense),
        incomeChangePercent: changePercent(current.income, previous.income),
        expenseChangePercent: changePercent(current.expense, previous.expense),
      },
      availableCurrencies,
    };
  }

  /**
   * Income/expense series for consecutive calendar months, oldest first.
   * Months without transactions are present with zeros so a gap in the chart
   * is a measured zero, not a missing point.
   */
  async monthly(userId: string, query: MonthlyInsightsQuery) {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const count = query.months ?? DEFAULT_MONTHS;
    const endMonth = query.month ?? this.currentMonth(timezone);
    const endPeriod = this.resolveMonth(endMonth, timezone);
    const months = this.monthSequence(endMonth, count, timezone);
    const firstPeriod = this.resolveMonth(months[0], timezone);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);

    // Group in the user's timezone so a late-evening transaction lands in the
    // local calendar month, and exclude TRANSFER rows from both totals.
    const rows = await this.prisma.$queryRaw<MonthlyRow[]>(Prisma.sql`
      SELECT to_char(
               date_trunc('month', t."occurredAt" AT TIME ZONE ${timezone}::text),
               'YYYY-MM'
             ) AS "month",
             COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0 END), 0)::numeric AS income,
             COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END), 0)::numeric AS expense,
             COUNT(*)::int AS "transactionCount"
      FROM transactions t
      WHERE t."userId" = ${userId}::uuid
        AND t.currency = ${currency}
        AND t.type IN ('INCOME', 'EXPENSE')
        AND t."occurredAt" >= ${firstPeriod.start}
        AND t."occurredAt" < ${endPeriod.endExclusive}
      GROUP BY 1
      ORDER BY 1
    `);

    const byMonth = new Map(rows.map((row) => [row.month, row]));
    const points = months.map((month) => {
      const row = byMonth.get(month);
      const income = toDecimal(row?.income ?? 0);
      const expense = toDecimal(row?.expense ?? 0);
      const transactionCount = row?.transactionCount ?? 0;
      const period = this.resolveMonth(month, timezone);
      return {
        month,
        monthStatus: this.monthStatus(period),
        income: moneyString(income),
        expense: moneyString(expense),
        net: moneyString(income.minus(expense)),
        savingsRate: this.savingsRate(income, expense),
        transactionCount,
        hasTransactions: transactionCount > 0,
      };
    });

    return {
      currency,
      timezone,
      estimated: false as const,
      months: points,
    };
  }

  /**
   * Spending by category for one month, compared with the month before.
   * Categories that only had spending the previous month stay in the list with
   * a zero current total so the decrease is visible instead of disappearing.
   */
  async categories(userId: string, query: InsightsQuery) {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const period = this.resolveMonth(query.month, timezone);
    const previousPeriod = this.shiftMonth(period.month, -1, timezone);
    const currency = this.resolveCurrency(query.currency, defaultCurrency);

    const [currentRows, previousRows] = await Promise.all([
      this.categoryTotals(userId, currency, period),
      this.categoryTotals(userId, currency, previousPeriod),
    ]);

    const current = new Map(currentRows.map((row) => [row.categoryId, row]));
    const previous = new Map(previousRows.map((row) => [row.categoryId, row]));
    const categoryIds = [...new Set([...current.keys(), ...previous.keys()])].filter(
      (id): id is string => Boolean(id),
    );
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

    const total = this.sum(currentRows);
    const previousTotal = this.sum(previousRows);

    const items = [...new Set([...current.keys(), ...previous.keys()])]
      .map((categoryId) => {
        const currentRow = current.get(categoryId);
        const previousRow = previous.get(categoryId);
        const amount = currentRow?.total ?? new Prisma.Decimal(0);
        const previousAmount = previousRow?.total ?? new Prisma.Decimal(0);
        const movement = changePercent(amount, previousAmount);
        return {
          categoryId,
          categoryName: categoryId ? (names.get(categoryId) ?? 'Không xác định') : 'Chưa phân loại',
          total: moneyString(amount),
          sharePercent: percentage(amount, total),
          transactionCount: currentRow?.transactionCount ?? 0,
          previousTotal: moneyString(previousAmount),
          changeAmount: moneyString(amount.minus(previousAmount)),
          changePercent: movement,
          notableIncrease:
            previousAmount.greaterThan(0) &&
            movement !== null &&
            movement >= NOTABLE_INCREASE_PERCENT &&
            amount.greaterThan(previousAmount),
          isNewSpending: previousAmount.isZero() && amount.greaterThan(0),
          sortAmount: amount,
          sortPrevious: previousAmount,
        };
      })
      .sort(
        (left, right) =>
          right.sortAmount.comparedTo(left.sortAmount) ||
          right.sortPrevious.comparedTo(left.sortPrevious) ||
          left.categoryName.localeCompare(right.categoryName),
      )
      .map(({ sortAmount: _sortAmount, sortPrevious: _sortPrevious, ...item }) => item);

    return {
      currency,
      timezone,
      month: period.month,
      previousMonth: previousPeriod.month,
      monthStatus: this.monthStatus(period),
      total: moneyString(total),
      previousTotal: moneyString(previousTotal),
      changePercent: changePercent(total, previousTotal),
      estimated: false as const,
      thresholds: { notableIncreasePercent: NOTABLE_INCREASE_PERCENT },
      items,
    };
  }

  private async getContext(userId: string): Promise<{ timezone: string; defaultCurrency: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    // A profile field can hold any string; fall back instead of failing every
    // query when the stored timezone is not a valid IANA zone.
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE;
    return { timezone, defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY };
  }

  private resolveCurrency(requested: string | undefined, defaultCurrency: string): string {
    return (requested ?? defaultCurrency).toUpperCase();
  }

  private async typeTotals(userId: string, currency: string, period: MonthPeriod): Promise<Totals> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        userId,
        currency,
        type: { in: ['INCOME', 'EXPENSE'] },
        occurredAt: { gte: period.start, lt: period.endExclusive },
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
    return { income, expense, transactionCount };
  }

  private async categoryTotals(
    userId: string,
    currency: string,
    period: MonthPeriod,
  ): Promise<CategoryRow[]> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        currency,
        type: 'EXPENSE',
        occurredAt: { gte: period.start, lt: period.endExclusive },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return grouped.map((row) => ({
      categoryId: row.categoryId,
      total: row._sum.amount ?? new Prisma.Decimal(0),
      transactionCount: row._count._all,
    }));
  }

  private sum(rows: CategoryRow[]): Prisma.Decimal {
    return rows.reduce((acc, row) => acc.plus(row.total), new Prisma.Decimal(0));
  }

  /** net / income × 100. Null when the month has no income to save from. */
  private savingsRate(income: Prisma.Decimal, expense: Prisma.Decimal): number | null {
    if (income.lessThanOrEqualTo(0)) return null;
    return Number(income.minus(expense).dividedBy(income).times(100).toFixed(2));
  }

  private resolveMonth(month: string | undefined, timezone: string): MonthPeriod {
    const value = month ?? this.currentMonth(timezone);
    if (!MONTH_REGEX.test(value)) {
      throw new BadRequestException('month phải có định dạng YYYY-MM');
    }
    try {
      return resolveMonthPeriod(value, timezone);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Tháng không hợp lệ');
    }
  }

  private shiftMonth(month: string, offset: number, timezone: string): MonthPeriod {
    const shifted = DateTime.fromFormat(month, 'yyyy-MM', { zone: timezone })
      .plus({ months: offset })
      .toFormat('yyyy-MM');
    return this.resolveMonth(shifted, timezone);
  }

  private monthSequence(endMonth: string, count: number, timezone: string): string[] {
    const end = DateTime.fromFormat(endMonth, 'yyyy-MM', { zone: timezone });
    return Array.from({ length: count }, (_, index) =>
      end.minus({ months: count - 1 - index }).toFormat('yyyy-MM'),
    );
  }

  private currentMonth(timezone: string): string {
    return DateTime.now().setZone(timezone).toFormat('yyyy-MM');
  }

  private monthStatus(period: MonthPeriod): InsightMonthStatus {
    return period.endExclusive.getTime() > Date.now() ? 'in_progress' : 'complete';
  }

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
