import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { InsightsService } from '../insights/insights.service';
import { AnalyticsTrendsService } from './analytics-trends.service';

function createPrismaMock() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        defaultCurrency: 'VND',
      }),
    },
    transaction: { groupBy: jest.fn() },
    category: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createInsightsMock() {
  return { monthly: jest.fn() };
}

type InsightsMock = ReturnType<typeof createInsightsMock>;

function createService(prisma: PrismaMock, insights: InsightsMock): AnalyticsTrendsService {
  return new AnalyticsTrendsService(
    prisma as unknown as PrismaService,
    insights as unknown as InsightsService,
  );
}

function typeRow(type: 'INCOME' | 'EXPENSE', amount: string, count: number) {
  return {
    type,
    _sum: { amount: new Prisma.Decimal(amount) },
    _count: { _all: count },
  };
}

function categoryRow(categoryId: string | null, amount: string) {
  return {
    categoryId,
    _sum: { amount: new Prisma.Decimal(amount) },
    _count: { _all: 1 },
  };
}

function monthlyPoint(input: {
  month: string;
  income: string;
  expense: string;
  hasTransactions?: boolean;
}) {
  const income = new Prisma.Decimal(input.income);
  const expense = new Prisma.Decimal(input.expense);
  return {
    month: input.month,
    monthStatus: 'complete' as const,
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    net: income.minus(expense).toFixed(2),
    savingsRate: income.isZero()
      ? null
      : Number(income.minus(expense).dividedBy(income).times(100).toFixed(2)),
    transactionCount: 1,
    hasTransactions: input.hasTransactions ?? true,
  };
}

function monthlyResult(months: ReturnType<typeof monthlyPoint>[]) {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    estimated: false as const,
    months,
  };
}

describe('AnalyticsTrendsService.overview', () => {
  it('computes totals and calendar comparison for a month, scoped to one user and currency', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([
        typeRow('INCOME', '10000000.00', 2),
        typeRow('EXPENSE', '4000000.00', 3),
      ])
      .mockResolvedValueOnce([
        typeRow('INCOME', '8000000.00', 1),
        typeRow('EXPENSE', '5000000.00', 2),
      ])
      .mockResolvedValueOnce([{ currency: 'VND' }, { currency: 'USD' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'month',
      month: '2024-03',
    });

    expect(result).toMatchObject({
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      period: {
        kind: 'month',
        label: '2024-03',
        from: '2024-03-01',
        to: '2024-03-31',
        status: 'complete',
      },
      income: '10000000.00',
      expense: '4000000.00',
      net: '6000000.00',
      savingsRate: 60,
      transactionCount: 5,
      hasTransactions: true,
      estimated: false,
      previous: {
        period: { label: '2024-02', from: '2024-02-01', to: '2024-02-29' },
        income: '8000000.00',
        expense: '5000000.00',
        net: '3000000.00',
        savingsRate: 37.5,
        transactionCount: 3,
        hasTransactions: true,
      },
      changes: {
        income: { amount: '2000000.00', percent: 25 },
        expense: { amount: '-1000000.00', percent: -20 },
        net: { amount: '3000000.00', percent: 100 },
        savingsRatePoints: 22.5,
      },
      availableCurrencies: ['VND', 'USD'],
    });

    for (const call of prisma.transaction.groupBy.mock.calls.slice(0, 2)) {
      expect(call[0].where.userId).toBe('user-1');
      expect(call[0].where.currency).toBe('VND');
      expect(call[0].where.type).toEqual({ in: ['INCOME', 'EXPENSE'] });
    }
    // 2024-03-01 00:00 in Asia/Ho_Chi_Minh is 2024-02-29T17:00Z.
    expect(prisma.transaction.groupBy.mock.calls[0][0].where.occurredAt).toEqual({
      gte: new Date('2024-02-29T17:00:00.000Z'),
      lt: new Date('2024-03-31T17:00:00.000Z'),
    });
    // The previous month is February, which ends on the 29th in 2024.
    expect(prisma.transaction.groupBy.mock.calls[1][0].where.occurredAt).toEqual({
      gte: new Date('2024-01-31T17:00:00.000Z'),
      lt: new Date('2024-02-29T17:00:00.000Z'),
    });
  });

  it('uses calendar quarter boundaries and compares with the previous quarter', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([typeRow('INCOME', '9000000.00', 3)])
      .mockResolvedValueOnce([typeRow('INCOME', '6000000.00', 2)])
      .mockResolvedValueOnce([{ currency: 'VND' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'quarter',
      quarter: '2024-Q1',
    });

    expect(result.period).toMatchObject({
      kind: 'quarter',
      label: '2024-Q1',
      from: '2024-01-01',
      to: '2024-03-31',
    });
    expect(result.previous.period).toMatchObject({ label: '2023-Q4' });
    expect(prisma.transaction.groupBy.mock.calls[0][0].where.occurredAt).toEqual({
      gte: new Date('2023-12-31T17:00:00.000Z'),
      lt: new Date('2024-03-31T17:00:00.000Z'),
    });
    expect(prisma.transaction.groupBy.mock.calls[1][0].where.occurredAt).toEqual({
      gte: new Date('2023-09-30T17:00:00.000Z'),
      lt: new Date('2023-12-31T17:00:00.000Z'),
    });
  });

  it('uses calendar year boundaries and compares with the previous year', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'VND' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'year',
      year: '2024',
    });

    expect(result.period).toMatchObject({
      kind: 'year',
      label: '2024',
      from: '2024-01-01',
      to: '2024-12-31',
    });
    expect(result.previous.period).toMatchObject({ label: '2023' });
    expect(prisma.transaction.groupBy.mock.calls[0][0].where.occurredAt).toEqual({
      gte: new Date('2023-12-31T17:00:00.000Z'),
      lt: new Date('2024-12-31T17:00:00.000Z'),
    });
  });

  it('never divides by zero when the previous period has no data', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([typeRow('EXPENSE', '200000.00', 2)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'VND' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'month',
      month: '2024-03',
    });

    expect(result.income).toBe('0.00');
    expect(result.savingsRate).toBeNull();
    expect(result.changes.income).toEqual({ amount: '0.00', percent: null });
    expect(result.changes.expense).toEqual({ amount: '200000.00', percent: null });
    expect(result.changes.net).toEqual({ amount: '-200000.00', percent: null });
    expect(result.changes.savingsRatePoints).toBeNull();
    expect(result.previous.hasTransactions).toBe(false);
  });

  it('reports no data instead of inventing figures', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'VND' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'month',
      month: '2024-03',
    });

    expect(result).toMatchObject({
      income: '0.00',
      expense: '0.00',
      net: '0.00',
      savingsRate: null,
      transactionCount: 0,
      hasTransactions: false,
    });
  });

  it('marks the current month as in progress', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T00:00:00.000Z'));
    try {
      const prisma = createPrismaMock();
      prisma.transaction.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ currency: 'VND' }]);

      const result = await createService(prisma, createInsightsMock()).overview('user-1', {
        period: 'month',
        month: '2025-06',
      });

      expect(result.period).toMatchObject({
        label: '2025-06',
        status: 'in_progress',
        from: '2025-06-01',
        to: '2025-06-30',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('compares a custom range with the preceding range of equal length', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'VND' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'custom',
      from: '2024-03-01',
      to: '2024-03-31',
    });

    expect(result.period).toMatchObject({
      kind: 'custom',
      from: '2024-03-01',
      to: '2024-03-31',
    });
    expect(result.previous.period).toMatchObject({
      from: '2024-01-30',
      to: '2024-02-29',
    });
  });

  it('uppercases the requested currency and keeps the default currency first', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'EUR' }, { currency: 'USD' }, { currency: 'VND' }]);

    const result = await createService(prisma, createInsightsMock()).overview('user-1', {
      period: 'month',
      month: '2024-03',
      currency: 'usd',
    });

    expect(result.currency).toBe('USD');
    expect(result.availableCurrencies).toEqual(['VND', 'EUR', 'USD']);
    expect(prisma.transaction.groupBy.mock.calls[0][0].where.currency).toBe('USD');
    expect(prisma.transaction.groupBy.mock.calls[1][0].where.currency).toBe('USD');
  });
});

describe('AnalyticsTrendsService period validation', () => {
  const service = () => createService(createPrismaMock(), createInsightsMock());

  it('rejects a custom period without both dates', async () => {
    await expect(
      service().overview('user-1', { period: 'custom', from: '2024-03-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a custom range whose start is after its end', async () => {
    await expect(
      service().overview('user-1', {
        period: 'custom',
        from: '2024-04-01',
        to: '2024-03-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a future period', async () => {
    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const futureMonth = now.plus({ months: 1 }).toFormat('yyyy-MM');
    await expect(
      service().overview('user-1', { period: 'month', month: futureMonth }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects trend months outside 3/6/12/24', async () => {
    await expect(
      service().trends('user-1', { months: 5 as unknown as number }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a future trend anchor before querying', async () => {
    const insights = createInsightsMock();
    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    await expect(
      createService(createPrismaMock(), insights).trends('user-1', {
        months: 6,
        month: now.plus({ months: 1 }).toFormat('yyyy-MM'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(insights.monthly).not.toHaveBeenCalled();
  });
});

describe('AnalyticsTrendsService.trends', () => {
  it('passes validated filters to the shared monthly series and preserves no-data months', async () => {
    const prisma = createPrismaMock();
    const insights = createInsightsMock();
    insights.monthly.mockResolvedValue(
      monthlyResult([
        monthlyPoint({ month: '2024-01', income: '1000', expense: '0', hasTransactions: false }),
        monthlyPoint({ month: '2024-02', income: '0', expense: '500' }),
      ]),
    );

    const result = await createService(prisma, insights).trends('user-1', {
      months: 6,
      month: '2024-02',
      currency: 'VND',
    });

    expect(insights.monthly).toHaveBeenCalledWith('user-1', {
      months: 6,
      month: '2024-02',
      currency: 'VND',
    });
    expect(result.rangeMonths).toBe(6);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({
      month: '2024-01',
      hasTransactions: false,
      income: '1000.00',
    });
    expect(result.points[1]).toMatchObject({
      month: '2024-02',
      hasTransactions: true,
      expense: '500.00',
    });
  });
});

describe('AnalyticsTrendsService.income', () => {
  it('computes totals, growth, extremes and category-backed sources', async () => {
    const prisma = createPrismaMock();
    const insights = createInsightsMock();
    insights.monthly.mockResolvedValue(
      monthlyResult([
        monthlyPoint({ month: '2024-01', income: '3000000', expense: '0' }),
        monthlyPoint({ month: '2024-02', income: '5000000', expense: '0' }),
        monthlyPoint({ month: '2024-03', income: '0', expense: '100000', hasTransactions: true }),
      ]),
    );
    prisma.transaction.groupBy.mockResolvedValue([
      categoryRow('salary', '8000000.00'),
      categoryRow(null, '0.00'),
    ]);
    prisma.category.findMany.mockResolvedValue([{ id: 'salary', name: 'Lương' }]);

    const result = await createService(prisma, insights).income('user-1', {
      months: 3,
      month: '2024-03',
    });

    expect(result).toMatchObject({
      currency: 'VND',
      rangeMonths: 3,
      total: '8000000.00',
      averageMonthly: '4000000.00',
      monthsWithIncome: 2,
      highest: { month: '2024-02', amount: '5000000.00' },
      lowest: { month: '2024-01', amount: '3000000.00' },
    });
    expect(result.points[1].changePercent).toBe(66.67);
    expect(result.points[2].changePercent).toBe(-100);
    expect(result.sources).toEqual([
      {
        categoryId: 'salary',
        categoryName: 'Lương',
        total: '8000000.00',
        sharePercent: 100,
        transactionCount: 1,
      },
      {
        categoryId: null,
        categoryName: 'Chưa phân loại',
        total: '0.00',
        sharePercent: 0,
        transactionCount: 1,
      },
    ]);
    // The source query stays inside the same user/currency and uses INCOME only.
    expect(prisma.transaction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['categoryId'],
        where: expect.objectContaining({
          userId: 'user-1',
          currency: 'VND',
          type: 'INCOME',
        }),
      }),
    );
  });

  it('returns no averages, extremes or sources when there is no income', async () => {
    const prisma = createPrismaMock();
    const insights = createInsightsMock();
    insights.monthly.mockResolvedValue(
      monthlyResult([monthlyPoint({ month: '2024-03', income: '0', expense: '1000' })]),
    );

    const result = await createService(prisma, insights).income('user-1', {
      months: 3,
      month: '2024-03',
    });

    expect(result.total).toBe('0.00');
    expect(result.averageMonthly).toBeNull();
    expect(result.monthsWithIncome).toBe(0);
    expect(result.highest).toBeNull();
    expect(result.lowest).toBeNull();
    expect(result.sources).toEqual([]);
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
  });
});

describe('AnalyticsTrendsService.expenses', () => {
  it('computes averages, volatility and consecutive increases without judging spending', async () => {
    const prisma = createPrismaMock();
    const insights = createInsightsMock();
    insights.monthly.mockResolvedValue(
      monthlyResult([
        monthlyPoint({ month: '2024-01', income: '0', expense: '100000' }),
        monthlyPoint({ month: '2024-02', income: '0', expense: '200000' }),
        monthlyPoint({ month: '2024-03', income: '0', expense: '400000' }),
        monthlyPoint({ month: '2024-04', income: '0', expense: '300000' }),
      ]),
    );

    const result = await createService(prisma, insights).expenses('user-1', {
      months: 6,
      month: '2024-04',
    });

    expect(result).toMatchObject({
      total: '1000000.00',
      averageMonthly: '250000.00',
      monthsWithExpense: 4,
      highest: { month: '2024-03', amount: '400000.00' },
      lowest: { month: '2024-01', amount: '100000.00' },
      longestIncreasingStreak: 2,
      currentIncreasingStreak: 0,
    });
    expect(result.volatilityPercent).toBeCloseTo(44.72, 2);
    expect(result.points.map((point) => point.changePercent)).toEqual([null, 100, 100, -25]);
  });

  it('breaks an increasing run at a month with no transactions', async () => {
    const insights = createInsightsMock();
    insights.monthly.mockResolvedValue(
      monthlyResult([
        monthlyPoint({ month: '2024-01', income: '0', expense: '100000' }),
        monthlyPoint({
          month: '2024-02',
          income: '0',
          expense: '0',
          hasTransactions: false,
        }),
        monthlyPoint({ month: '2024-03', income: '0', expense: '200000' }),
        monthlyPoint({ month: '2024-04', income: '0', expense: '300000' }),
      ]),
    );

    const result = await createService(createPrismaMock(), insights).expenses('user-1', {
      months: 6,
      month: '2024-04',
    });

    expect(result.longestIncreasingStreak).toBe(1);
    expect(result.currentIncreasingStreak).toBe(1);
    expect(result.points[1]).toMatchObject({ amount: '0.00', hasTransactions: false });
  });
});

describe('AnalyticsTrendsService.comparison', () => {
  it('compares calendar periods and lists notable category changes', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      // current totals
      .mockResolvedValueOnce([
        typeRow('INCOME', '9000000.00', 2),
        typeRow('EXPENSE', '5000000.00', 3),
      ])
      // previous totals
      .mockResolvedValueOnce([
        typeRow('INCOME', '6000000.00', 1),
        typeRow('EXPENSE', '3000000.00', 2),
      ])
      // current category totals
      .mockResolvedValueOnce([
        categoryRow('food', '3200000.00'),
        categoryRow('transport', '800000.00'),
        categoryRow('new-cat', '1000000.00'),
      ])
      // previous category totals
      .mockResolvedValueOnce([
        categoryRow('food', '1700000.00'),
        categoryRow('transport', '800000.00'),
        categoryRow('old-cat', '500000.00'),
      ]);
    prisma.category.findMany.mockResolvedValue([
      { id: 'food', name: 'Ăn uống' },
      { id: 'transport', name: 'Đi lại' },
      { id: 'new-cat', name: 'Danh mục mới' },
      { id: 'old-cat', name: 'Danh mục cũ' },
    ]);

    const result = await createService(prisma, createInsightsMock()).comparison('user-1', {
      period: 'quarter',
      quarter: '2024-Q1',
    });

    expect(result).toMatchObject({
      currency: 'VND',
      current: {
        period: { label: '2024-Q1' },
        income: '9000000.00',
        expense: '5000000.00',
        net: '4000000.00',
        savingsRate: 44.44,
        transactionCount: 5,
      },
      previous: {
        period: { label: '2023-Q4' },
        income: '6000000.00',
        expense: '3000000.00',
        transactionCount: 3,
      },
      changes: {
        income: { amount: '3000000.00', percent: 50 },
        expense: { amount: '2000000.00', percent: 66.67 },
        net: { amount: '1000000.00', percent: 33.33 },
        savingsRatePoints: -5.56,
      },
    });

    expect(result.notableCategoryChanges[0]).toMatchObject({
      categoryId: 'food',
      categoryName: 'Ăn uống',
      currentTotal: '3200000.00',
      previousTotal: '1700000.00',
      changeAmount: '1500000.00',
      changePercent: 88.24,
      direction: 'increase',
    });
    expect(result.notableCategoryChanges.map((item) => item.direction).sort()).toEqual([
      'increase',
      'new',
      'removed',
    ]);
    expect(
      result.notableCategoryChanges.find((item) => item.categoryId === 'old-cat'),
    ).toMatchObject({ direction: 'removed', changePercent: -100 });
  });

  it('returns null changes when the previous period had no data', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([typeRow('INCOME', '1000000.00', 1)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await createService(prisma, createInsightsMock()).comparison('user-1', {
      period: 'month',
      month: '2024-03',
    });

    expect(result.changes).toEqual({
      income: { amount: '1000000.00', percent: null },
      expense: { amount: '0.00', percent: null },
      net: { amount: '1000000.00', percent: null },
      savingsRatePoints: null,
    });
    expect(result.notableCategoryChanges).toEqual([]);
    expect(result.previous.hasTransactions).toBe(false);
  });
});
