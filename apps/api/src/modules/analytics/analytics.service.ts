import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { moneyString, percentage } from '../../common/utils/money';
import { DateRange, previousRange, resolveDateRange } from '../../common/utils/period';

interface TrendRow {
  period: string;
  income: Prisma.Decimal | string | number;
  expense: Prisma.Decimal | string | number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string, from?: string, to?: string) {
    const { range, timezone } = await this.getRange(userId, from, to);
    return this.buildSummary(userId, range, timezone);
  }

  async byCategory(userId: string, from?: string, to?: string) {
    const { range } = await this.getRange(userId, from, to);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: 'EXPENSE',
        occurredAt: { gte: range.start, lt: range.endExclusive },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    const categoryIds = grouped
      .map((row) => row.categoryId)
      .filter((id): id is string => Boolean(id));
    const categories = categoryIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(categories.map((category) => [category.id, category.name]));

    const total = grouped.reduce(
      (acc, row) => acc.plus(row._sum.amount ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

    return {
      from: range.from,
      to: range.to,
      total: moneyString(total),
      items: grouped.map((row) => {
        const amount = row._sum.amount ?? new Prisma.Decimal(0);
        return {
          categoryId: row.categoryId,
          categoryName: row.categoryId
            ? (names.get(row.categoryId) ?? 'Không xác định')
            : 'Chưa phân loại',
          total: moneyString(amount),
          percentage: percentage(amount, total),
        };
      }),
    };
  }

  async trend(userId: string, from?: string, to?: string, interval: 'day' | 'month' = 'day') {
    const { range, timezone } = await this.getRange(userId, from, to);
    const rows = await this.prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      SELECT to_char(
               date_trunc(${interval}::text, t."occurredAt" AT TIME ZONE ${timezone}::text),
               'YYYY-MM-DD'
             ) AS period,
             COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0 END), 0)::numeric AS income,
             COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END), 0)::numeric AS expense
      FROM transactions t
      WHERE t."userId" = ${userId}::uuid
        AND t."occurredAt" >= ${range.start}
        AND t."occurredAt" < ${range.endExclusive}
      GROUP BY 1
      ORDER BY 1
    `);

    const points = rows.map((row) => ({
      period: row.period,
      income: moneyString(row.income),
      expense: moneyString(row.expense),
    }));

    return {
      from: range.from,
      to: range.to,
      interval,
      points: this.fillGaps(points, range, interval, timezone),
    };
  }

  async comparison(userId: string, from?: string, to?: string) {
    const { range, timezone } = await this.getRange(userId, from, to);
    const previous = previousRange(range, timezone);
    const [currentSummary, previousSummary] = await Promise.all([
      this.buildSummary(userId, range, timezone),
      this.buildSummary(userId, previous, timezone),
    ]);

    return {
      current: currentSummary,
      previous: previousSummary,
      incomeChangePercent: this.changePercent(currentSummary.income, previousSummary.income),
      expenseChangePercent: this.changePercent(currentSummary.expense, previousSummary.expense),
    };
  }

  private async buildSummary(userId: string, range: DateRange, timezone: string) {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        userId,
        type: { in: ['INCOME', 'EXPENSE'] },
        occurredAt: { gte: range.start, lt: range.endExclusive },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    let income = new Prisma.Decimal(0);
    let expense = new Prisma.Decimal(0);
    let count = 0;
    for (const row of grouped) {
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      count += row._count._all;
      if (row.type === 'INCOME') income = income.plus(amount);
      if (row.type === 'EXPENSE') expense = expense.plus(amount);
    }

    return {
      from: range.from,
      to: range.to,
      income: moneyString(income),
      expense: moneyString(expense),
      net: moneyString(income.minus(expense)),
      transactionCount: count,
      timezone,
    };
  }

  private fillGaps(
    points: { period: string; income: string; expense: string }[],
    range: DateRange,
    interval: 'day' | 'month',
    timezone: string,
  ) {
    const map = new Map(points.map((point) => [point.period, point]));
    const result: { period: string; income: string; expense: string }[] = [];
    let cursor =
      interval === 'day'
        ? DateTime.fromISO(range.from, { zone: timezone }).startOf('day')
        : DateTime.fromISO(range.from, { zone: timezone }).startOf('month');
    const end =
      interval === 'day'
        ? DateTime.fromISO(range.to, { zone: timezone }).startOf('day')
        : DateTime.fromISO(range.to, { zone: timezone }).startOf('month');

    // Guard against pathological loops; ranges are already capped at 731 days.
    while (cursor <= end) {
      const key = cursor.toISODate()!;
      result.push(
        map.get(key) ?? {
          period: key,
          income: '0.00',
          expense: '0.00',
        },
      );
      cursor = cursor.plus(interval === 'day' ? { days: 1 } : { months: 1 });
    }
    return result;
  }

  private changePercent(current: string, previous: string): number | null {
    const prev = new Prisma.Decimal(previous);
    if (prev.isZero()) return null;
    return Number(new Prisma.Decimal(current).minus(prev).dividedBy(prev).times(100).toFixed(2));
  }

  private async getRange(userId: string, from?: string, to?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
    try {
      return { range: resolveDateRange(from, to, timezone), timezone };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Khoảng thời gian không hợp lệ',
      );
    }
  }
}
