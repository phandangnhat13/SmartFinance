import { Prisma } from '@prisma/client';
import type { AlertRecord } from './alerts.service';
import { explainAlert, toSpendingAlertDto } from './alert.mapper';

const LARGE_FACTS = {
  method: 'robust_z',
  amount: '300000.00',
  currency: 'VND',
  median: '60000.00',
  mad: '5000.00',
  robustZ: '32.3748',
  ratio: '5.0000',
  historyCount: 10,
  historyDays: 10,
  lookbackDays: 180,
  thresholds: { minHistoryCount: 8, robustZ: 3.5, madZeroRatio: 3 },
};

const SPIKE_FACTS = {
  method: 'matched_day_window',
  categoryName: 'Ăn uống',
  currency: 'VND',
  currentMonth: '2026-10',
  windowDays: 18,
  currentSpend: '2000000.00',
  currentTransactions: 2,
  baseline: '350000.00',
  ratio: '5.7143',
  referenceMonths: [
    { month: '2026-09', spend: '400000.00', transactions: 2, days: 18 },
    { month: '2026-08', spend: '300000.00', transactions: 2, days: 18 },
  ],
  excludedReferenceMonths: [{ month: '2026-07', reason: 'no_data' }],
  thresholds: {
    ratio: 1.5,
    minReferenceMonths: 2,
    minNonZeroReferenceMonths: 2,
    minCurrentTransactions: 2,
  },
};

const DUPLICATE_FACTS = {
  rule: 'same_account_amount_type_currency_within_window',
  amount: '80000.00',
  currency: 'VND',
  accountId: 'account-1',
  minutesApart: 10,
  descriptionSimilar: true,
  windowMinutes: 1440,
  occurredAt: '2026-10-29T09:10:00.000Z',
  relatedOccurredAt: '2026-10-29T09:00:00.000Z',
  note: 'Gợi ý kiểm tra, không phải kết luận trùng lặp.',
};

function record(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'alert-1',
    type: 'LARGE_TRANSACTION',
    severity: 'HIGH',
    status: 'OPEN',
    dedupeKey: 'LARGE:tx-1',
    transactionId: 'tx-1',
    relatedTransactionId: null,
    categoryId: 'category-1',
    periodStart: null,
    periodEnd: null,
    score: new Prisma.Decimal('4.2000'),
    facts: LARGE_FACTS,
    createdAt: new Date('2026-10-29T10:00:00.000Z'),
    updatedAt: new Date('2026-10-29T10:05:00.000Z'),
    resolvedAt: null,
    category: { name: 'Ăn uống' },
    ...overrides,
  };
}

describe('toSpendingAlertDto', () => {
  it('maps every stored field without exposing anything else', () => {
    const dto = toSpendingAlertDto(record());
    expect(dto).toMatchObject({
      id: 'alert-1',
      type: 'LARGE_TRANSACTION',
      severity: 'HIGH',
      status: 'OPEN',
      dedupeKey: 'LARGE:tx-1',
      transactionId: 'tx-1',
      relatedTransactionId: null,
      categoryId: 'category-1',
      categoryName: 'Ăn uống',
      periodStart: null,
      periodEnd: null,
      score: '4.2000',
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:05:00.000Z',
      resolvedAt: null,
    });
    expect(dto.facts).toEqual(LARGE_FACTS);
  });

  it('formats DATE columns as calendar dates and nulls a missing category', () => {
    const dto = toSpendingAlertDto(
      record({
        type: 'CATEGORY_SPIKE',
        facts: SPIKE_FACTS,
        categoryId: null,
        category: null,
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-18T00:00:00.000Z'),
        score: null,
        resolvedAt: new Date('2026-10-20T08:00:00.000Z'),
      }),
    );
    expect(dto.categoryName).toBeNull();
    expect(dto.periodStart).toBe('2026-10-01');
    expect(dto.periodEnd).toBe('2026-10-18');
    expect(dto.score).toBeNull();
    expect(dto.resolvedAt).toBe('2026-10-20T08:00:00.000Z');
  });
});

describe('explainAlert', () => {
  it('rebuilds the large-transaction sentence from facts', () => {
    const text = explainAlert('LARGE_TRANSACTION', LARGE_FACTS);
    expect(text).toContain('cao hơn hẳn');
    expect(text).toContain('300.000');
    expect(text).toContain('32.4');
  });

  it('rebuilds the category-spike sentence from facts', () => {
    const text = explainAlert('CATEGORY_SPIKE', SPIKE_FACTS);
    expect(text).toContain('Ăn uống');
    expect(text).toContain('5.7 lần');
    expect(text).toContain('1 tháng không có dữ liệu');
  });

  it('rebuilds the duplicate sentence from facts', () => {
    const text = explainAlert('POSSIBLE_DUPLICATE', DUPLICATE_FACTS);
    expect(text).toContain('80.000');
    expect(text).toContain('10 phút');
    expect(text).toContain('không tự xoá');
  });

  it('falls back instead of throwing when facts cannot be read', () => {
    expect(explainAlert('LARGE_TRANSACTION', {})).toContain('Hệ thống đã ghi nhận');
    expect(explainAlert('CATEGORY_SPIKE', null)).toContain('Hệ thống đã ghi nhận');
    expect(explainAlert('POSSIBLE_DUPLICATE', [])).toContain('Hệ thống đã ghi nhận');
  });
});
