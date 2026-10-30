import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { ALERT_SCAN_LIMITS, AlertScanService } from './alert-scan.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_PAIR_COUNT = ALERT_SCAN_LIMITS.maxDuplicatePairs;

type Row = Prisma.TransactionGetPayload<{
  select: {
    id: true;
    accountId: true;
    categoryId: true;
    type: true;
    amount: true;
    currency: true;
    description: true;
    occurredAt: true;
    category: { select: { name: true } };
  };
}>;

function row(overrides: Partial<Row> & { id: string; occurredAt: Date }): Row {
  return {
    accountId: 'account-1',
    categoryId: null,
    type: 'EXPENSE',
    amount: new Prisma.Decimal('100000.00'),
    currency: 'VND',
    description: 'Khoản chi',
    category: null,
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    user: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
    spendingAlert: { createMany: jest.fn() },
  };
}

function createService(prisma: ReturnType<typeof createPrismaMock>): AlertScanService {
  return new AlertScanService(prisma as unknown as PrismaService);
}

describe('AlertScanService.scan — transaction loading', () => {
  it('queries only income/expense rows inside the bounded time range', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCurrency: 'VND',
    });
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.spendingAlert.createMany.mockResolvedValue({ count: 0 });

    const summary = await createService(prisma).scan('user-1');

    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
    const query = prisma.transaction.findMany.mock.calls[0][0];
    expect(query.where.userId).toBe('user-1');
    expect(query.where.type).toEqual({ in: ['INCOME', 'EXPENSE'] });
    expect(query.where.occurredAt.gte).toBeInstanceOf(Date);
    expect(query.where.occurredAt.lt).toBeInstanceOf(Date);
    expect(query.orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
    expect(query.take).toBe(ALERT_SCAN_LIMITS.maxTransactions + 1);
    // Only detector inputs are selected — no notes, no user ids, no balances.
    expect(Object.keys(query.select).sort()).toEqual(
      [
        'accountId',
        'amount',
        'category',
        'categoryId',
        'currency',
        'description',
        'id',
        'occurredAt',
        'type',
      ].sort(),
    );
    expect(prisma.spendingAlert.createMany).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      status: 'completed',
      detected: 0,
      created: 0,
      alreadyPresent: 0,
      scannedTransactions: 0,
    });
  });

  it('reports a truncated scan instead of a complete one at the row cap', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCurrency: 'VND',
    });
    const now = Date.now();
    // One row more than the cap; every amount and day is unique so no detector fires.
    const rows: Row[] = [];
    for (let index = 0; index <= ALERT_SCAN_LIMITS.maxTransactions; index += 1) {
      rows.push(
        row({
          id: `tx-${index}`,
          amount: new Prisma.Decimal((index + 1).toFixed(2)),
          occurredAt: new Date(now - (31 + (index % 149)) * DAY_MS),
        }),
      );
    }
    prisma.transaction.findMany.mockResolvedValue(rows);

    const summary = await createService(prisma).scan('user-1');

    expect(summary.scannedTransactions).toBe(ALERT_SCAN_LIMITS.maxTransactions);
    expect(summary.status).toBe('truncated');
    expect(summary.limits.transactionsTruncated).toBe(true);
    expect(summary.limits.maxTransactions).toBe(ALERT_SCAN_LIMITS.maxTransactions);
    expect(prisma.spendingAlert.createMany).not.toHaveBeenCalled();
  });

  it('falls back to a known timezone when the stored one is invalid', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ timezone: 'Mars/Olympus', defaultCurrency: 'VND' });
    prisma.transaction.findMany.mockResolvedValue([]);

    const summary = await createService(prisma).scan('user-1');

    expect(summary.window.currentMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(summary.window.referenceMonths).toHaveLength(ALERT_SCAN_LIMITS.referenceMonths);
  });

  it('refuses to scan for a user that no longer exists', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(createService(prisma).scan('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    expect(prisma.spendingAlert.createMany).not.toHaveBeenCalled();
  });
});

describe('AlertScanService.scan — detection and persistence', () => {
  it('reports what was inserted and what was already present', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCurrency: 'VND',
    });
    const now = Date.now();
    // Eight baseline expenses, then one far larger recent expense (robust z ≫ 5).
    const historyAmounts = [
      '50000.00',
      '60000.00',
      '70000.00',
      '80000.00',
      '90000.00',
      '100000.00',
      '110000.00',
      '120000.00',
    ];
    const rows: Row[] = historyAmounts.map((amount, index) =>
      row({
        id: `history-${index}`,
        amount: new Prisma.Decimal(amount),
        occurredAt: new Date(now - (100 - index) * DAY_MS),
      }),
    );
    rows.push(
      row({
        id: 'candidate-1',
        amount: new Prisma.Decimal('900000.00'),
        occurredAt: new Date(now - DAY_MS),
      }),
    );
    prisma.transaction.findMany.mockResolvedValue(rows);
    prisma.spendingAlert.createMany.mockResolvedValue({ count: 1 });

    const summary = await createService(prisma).scan('user-1');

    expect(summary.status).toBe('completed');
    expect(summary.detected).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.alreadyPresent).toBe(0);
    expect(summary.detectedByType).toEqual({
      LARGE_TRANSACTION: 1,
      CATEGORY_SPIKE: 0,
      POSSIBLE_DUPLICATE: 0,
    });

    expect(prisma.spendingAlert.createMany).toHaveBeenCalledTimes(1);
    const payload = prisma.spendingAlert.createMany.mock.calls[0][0];
    expect(payload.skipDuplicates).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      userId: 'user-1',
      type: 'LARGE_TRANSACTION',
      transactionId: 'candidate-1',
      dedupeKey: 'LARGE:candidate-1',
    });
  });

  it('counts a re-detected alert as already present when the insert skips it', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCurrency: 'VND',
    });
    const now = Date.now();
    const amounts = [
      '50000.00',
      '60000.00',
      '70000.00',
      '80000.00',
      '90000.00',
      '100000.00',
      '110000.00',
      '120000.00',
    ];
    const rows: Row[] = amounts.map((amount, index) =>
      row({
        id: `history-${index}`,
        amount: new Prisma.Decimal(amount),
        occurredAt: new Date(now - (100 - index) * DAY_MS),
      }),
    );
    rows.push(
      row({
        id: 'candidate-1',
        amount: new Prisma.Decimal('900000.00'),
        occurredAt: new Date(now - DAY_MS),
      }),
    );
    prisma.transaction.findMany.mockResolvedValue(rows);
    // The unique index (userId, dedupeKey) already holds this key.
    prisma.spendingAlert.createMany.mockResolvedValue({ count: 0 });

    const summary = await createService(prisma).scan('user-1');

    expect(summary.detected).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.alreadyPresent).toBe(1);
    expect(summary.status).toBe('completed');
  });

  it('marks the scan truncated when the duplicate pair cap is reached', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCurrency: 'VND',
    });
    const now = Date.now();
    // 21 identical rows minutes apart produce more pairs than the cap allows.
    const rows: Row[] = Array.from({ length: 21 }, (_value, index) =>
      row({
        id: `dup-${index}`,
        occurredAt: new Date(now - 60 * DAY_MS + index * 5 * 60 * 1000),
      }),
    );
    prisma.transaction.findMany.mockResolvedValue(rows);
    prisma.spendingAlert.createMany.mockResolvedValue({ count: DUPLICATE_PAIR_COUNT });

    const summary = await createService(prisma).scan('user-1');

    expect(summary.detected).toBe(DUPLICATE_PAIR_COUNT);
    expect(summary.limits.maxDuplicatePairs).toBe(ALERT_SCAN_LIMITS.maxDuplicatePairs);
    expect(summary.limits.duplicateCapReached).toBe(true);
    expect(summary.limits.transactionsTruncated).toBe(false);
    expect(summary.status).toBe('truncated');
    expect(prisma.spendingAlert.createMany.mock.calls[0][0].data).toHaveLength(
      DUPLICATE_PAIR_COUNT,
    );
  });
});
