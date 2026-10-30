import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { InsightsService, NOTABLE_INCREASE_PERCENT } from './insights.service';

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
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createService(prisma: PrismaMock): InsightsService {
  return new InsightsService(prisma as unknown as PrismaService);
}

function typeRow(type: 'INCOME' | 'EXPENSE', amount: string, count: number) {
  return {
    type,
    _sum: { amount: new Prisma.Decimal(amount) },
    _count: { _all: count },
  };
}

function categoryRow(categoryId: string | null, amount: string, count = 1) {
  return {
    categoryId,
    _sum: { amount: new Prisma.Decimal(amount) },
    _count: { _all: count },
  };
}

describe('InsightsService.overview', () => {
  it('computes income, expense, net, savings rate and the previous-month deltas', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([
        typeRow('INCOME', '10000000.00', 5),
        typeRow('EXPENSE', '4000000.00', 2),
      ])
      .mockResolvedValueOnce([
        typeRow('INCOME', '8000000.00', 4),
        typeRow('EXPENSE', '5000000.00', 1),
      ])
      .mockResolvedValueOnce([{ currency: 'VND' }, { currency: 'USD' }]);

    const result = await createService(prisma).overview('user-1', { month: '2024-03' });

    expect(result).toMatchObject({
      currency: 'VND',
      month: '2024-03',
      monthStatus: 'complete',
      periodStart: '2024-03-01',
      periodEnd: '2024-03-31',
      income: '10000000.00',
      expense: '4000000.00',
      net: '6000000.00',
      savingsRate: 60,
      transactionCount: 7,
      estimated: false,
      previous: {
        month: '2024-02',
        income: '8000000.00',
        expense: '5000000.00',
        net: '3000000.00',
        savingsRate: 37.5,
        incomeChangePercent: 25,
        expenseChangePercent: -20,
      },
      availableCurrencies: ['VND', 'USD'],
    });
    // Every aggregate is scoped to the signed-in user and one currency only.
    for (const call of prisma.transaction.groupBy.mock.calls.slice(0, 2)) {
      expect(call[0].where.userId).toBe('user-1');
      expect(call[0].where.currency).toBe('VND');
      expect(call[0].where.type).toEqual({ in: ['INCOME', 'EXPENSE'] });
    }
  });

  it('filters by the requested currency and keeps the default currency first', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'EUR' }, { currency: 'USD' }, { currency: 'VND' }]);

    const result = await createService(prisma).overview('user-1', {
      month: '2024-03',
      currency: 'usd',
    });

    expect(result.currency).toBe('USD');
    expect(result.availableCurrencies).toEqual(['VND', 'EUR', 'USD']);
    expect(prisma.transaction.groupBy.mock.calls[0][0].where.currency).toBe('USD');
    expect(prisma.transaction.groupBy.mock.calls[1][0].where.currency).toBe('USD');
  });

  it('returns a null savings rate and zero totals for a month without income', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([typeRow('EXPENSE', '200000.00', 2)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'VND' }]);

    const result = await createService(prisma).overview('user-1', { month: '2024-03' });

    expect(result.income).toBe('0.00');
    expect(result.expense).toBe('200000.00');
    expect(result.net).toBe('-200000.00');
    expect(result.savingsRate).toBeNull();
    expect(result.transactionCount).toBe(2);
    expect(result.previous.incomeChangePercent).toBeNull();
    expect(result.previous.expenseChangePercent).toBeNull();
  });

  it('falls back to the default timezone when the stored one is invalid', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Not/AZone',
      defaultCurrency: 'VND',
    });
    prisma.transaction.groupBy.mockResolvedValue([]);

    const result = await createService(prisma).overview('user-1', { month: '2024-03' });

    expect(result.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('rejects a month that is not YYYY-MM', async () => {
    const prisma = createPrismaMock();
    await expect(
      createService(prisma).overview('user-1', { month: '2024-13' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
  });
});

describe('InsightsService.monthly', () => {
  it('fills months without transactions and computes per-month savings rates', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      {
        month: '2024-01',
        income: '1000000.00',
        expense: '400000.00',
        transactionCount: 3,
      },
    ]);

    const result = await createService(prisma).monthly('user-1', {
      month: '2024-02',
      months: 2,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.currency).toBe('VND');
    expect(result.estimated).toBe(false);
    expect(result.months).toEqual([
      {
        month: '2024-01',
        monthStatus: 'complete',
        income: '1000000.00',
        expense: '400000.00',
        net: '600000.00',
        savingsRate: 60,
        transactionCount: 3,
        hasTransactions: true,
      },
      {
        month: '2024-02',
        monthStatus: 'complete',
        income: '0.00',
        expense: '0.00',
        net: '0.00',
        savingsRate: null,
        transactionCount: 0,
        hasTransactions: false,
      },
    ]);
  });

  it('returns exactly the requested number of months, oldest first', async () => {
    const prisma = createPrismaMock();
    const result = await createService(prisma).monthly('user-1', {
      month: '2024-06',
      months: 4,
      currency: 'EUR',
    });

    expect(result.months.map((point) => point.month)).toEqual([
      '2024-03',
      '2024-04',
      '2024-05',
      '2024-06',
    ]);
    expect(result.currency).toBe('EUR');
  });

  it('rejects an invalid end month', async () => {
    const prisma = createPrismaMock();
    await expect(
      createService(prisma).monthly('user-1', { month: '2024-00', months: 6 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('InsightsService.categories', () => {
  it('merges current and previous spending, flags notable increases and new spending', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([
        categoryRow('food', '3000000.00', 3),
        categoryRow('transport', '1000000.00', 1),
      ])
      .mockResolvedValueOnce([
        categoryRow('food', '1000000.00', 2),
        categoryRow('shopping', '500000.00', 1),
      ]);
    prisma.category.findMany.mockResolvedValue([
      { id: 'food', name: 'Ăn uống' },
      { id: 'transport', name: 'Đi lại' },
      { id: 'shopping', name: 'Mua sắm' },
    ]);

    const result = await createService(prisma).categories('user-1', { month: '2024-03' });

    expect(result.total).toBe('4000000.00');
    expect(result.previousTotal).toBe('1500000.00');
    expect(result.changePercent).toBe(166.67);
    expect(result.thresholds).toEqual({ notableIncreasePercent: NOTABLE_INCREASE_PERCENT });
    expect(result.items.map((item) => [item.categoryId, item.total])).toEqual([
      ['food', '3000000.00'],
      ['transport', '1000000.00'],
      ['shopping', '0.00'],
    ]);

    const food = result.items[0];
    expect(food).toMatchObject({
      categoryName: 'Ăn uống',
      sharePercent: 75,
      transactionCount: 3,
      previousTotal: '1000000.00',
      changeAmount: '2000000.00',
      changePercent: 200,
      notableIncrease: true,
      isNewSpending: false,
    });
    const transport = result.items[1];
    expect(transport).toMatchObject({
      changePercent: null,
      notableIncrease: false,
      isNewSpending: true,
    });
    const shopping = result.items[2];
    expect(shopping).toMatchObject({
      categoryName: 'Mua sắm',
      sharePercent: 0,
      changeAmount: '-500000.00',
      changePercent: -100,
      notableIncrease: false,
      isNewSpending: false,
    });
    for (const call of prisma.transaction.groupBy.mock.calls) {
      expect(call[0].where.userId).toBe('user-1');
      expect(call[0].where.currency).toBe('VND');
      expect(call[0].where.type).toBe('EXPENSE');
    }
  });

  it('keeps uncategorised spending under a readable label', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([categoryRow(null, '250000.00', 1)])
      .mockResolvedValueOnce([]);

    const result = await createService(prisma).categories('user-1', { month: '2024-03' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      categoryId: null,
      categoryName: 'Chưa phân loại',
      total: '250000.00',
      sharePercent: 100,
      isNewSpending: true,
    });
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('does not mark a small increase as notable even when it is above zero', async () => {
    const prisma = createPrismaMock();
    prisma.transaction.groupBy
      .mockResolvedValueOnce([categoryRow('food', '1100000.00', 1)])
      .mockResolvedValueOnce([categoryRow('food', '1000000.00', 1)]);
    prisma.category.findMany.mockResolvedValue([{ id: 'food', name: 'Ăn uống' }]);

    const result = await createService(prisma).categories('user-1', { month: '2024-03' });

    expect(result.items[0]).toMatchObject({
      changePercent: 10,
      notableIncrease: false,
      isNewSpending: false,
    });
  });
});
