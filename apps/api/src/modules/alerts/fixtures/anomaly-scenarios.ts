import type { TransactionSample } from '../detectors/anomaly.types';
import type { LargeTransactionInput } from '../detectors/large-transaction.detector';
import type { CategorySpikeInput, SpikeWindow } from '../detectors/category-spike.detector';

/**
 * Labelled synthetic cases used to measure the *detectors' agreement with their
 * own written expectations*. They are hand-authored to cover each rule and its
 * edge cases — they are NOT real user data and say nothing about real-world
 * precision or recall. Any claim beyond "the implementation matches this
 * specification" would be unsupported.
 */

export type FixtureKind = 'large' | 'spike' | 'duplicate';

export interface FixtureCase {
  id: string;
  kind: FixtureKind;
  description: string;
  expected: boolean;
  expectedSeverity?: 'LOW' | 'MEDIUM' | 'HIGH';
  large?: LargeTransactionInput;
  spike?: CategorySpikeInput;
  duplicate?: TransactionSample[];
}

export const FIXTURE_NOW = new Date('2026-10-18T09:00:00.000Z');

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBefore(days: number): Date {
  return new Date(FIXTURE_NOW.getTime() - days * DAY_MS);
}

interface TxOverrides {
  id: string;
  amount: string;
  at: Date;
  accountId?: string;
  categoryId?: string | null;
  description?: string;
  currency?: string;
  type?: TransactionSample['type'];
}

export function makeTx(overrides: TxOverrides): TransactionSample {
  return {
    id: overrides.id,
    accountId: overrides.accountId ?? 'account-1',
    categoryId: overrides.categoryId ?? 'category-food',
    type: overrides.type ?? 'EXPENSE',
    amount: overrides.amount,
    currency: overrides.currency ?? 'VND',
    description: overrides.description ?? 'Cà phê',
    occurredAt: overrides.at,
  };
}

/** Builds a matched-day window for month 'YYYY-MM' covering the first `days` days. */
export function makeWindow(month: string, days: number): SpikeWindow {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const endExclusive = new Date(start.getTime() + days * DAY_MS);
  const periodEnd = new Date(endExclusive.getTime() - DAY_MS);
  return { month, start, endExclusive, periodStart: start, periodEnd, days };
}

/** A date inside the window, e.g. day 5 at noon UTC. */
function dayOf(window: SpikeWindow, day: number): Date {
  return new Date(window.start.getTime() + (day - 1) * DAY_MS + 12 * 60 * 60 * 1000);
}

const CURRENT = makeWindow('2026-10', 18);
const REF_SEP = makeWindow('2026-09', 18);
const REF_AUG = makeWindow('2026-08', 18);
const REF_JUL = makeWindow('2026-07', 18);

function spikeInput(
  id: string,
  options: {
    currentTransactions: Array<{
      amount: string;
      day: number;
      categoryId?: string;
      currency?: string;
    }>;
    references: Array<{
      window: SpikeWindow;
      transactions: Array<{ amount: string; day: number; categoryId?: string; currency?: string }>;
    }>;
  },
): CategorySpikeInput {
  return {
    categoryId: 'category-food',
    categoryName: 'Ăn uống',
    currency: 'VND',
    current: CURRENT,
    references: options.references.map((reference) => reference.window),
    transactions: [
      ...options.currentTransactions.map((transaction, index) =>
        makeTx({
          id: `${id}-c${index}`,
          amount: transaction.amount,
          at: dayOf(CURRENT, transaction.day),
          categoryId: transaction.categoryId ?? 'category-food',
          currency: transaction.currency,
        }),
      ),
      ...options.references.flatMap((reference, referenceIndex) =>
        reference.transactions.map((transaction, index) =>
          makeTx({
            id: `${id}-r${referenceIndex}-${index}`,
            amount: transaction.amount,
            at: dayOf(reference.window, transaction.day),
            categoryId: transaction.categoryId ?? 'category-food',
            currency: transaction.currency,
          }),
        ),
      ),
    ],
  };
}

const steadyHistory: TransactionSample[] = [
  '50000.00',
  '60000.00',
  '55000.00',
  '70000.00',
  '65000.00',
  '60000.00',
  '58000.00',
  '62000.00',
  '54000.00',
  '66000.00',
].map((amount, index) =>
  makeTx({ id: `history-${index}`, amount, at: daysBefore(30 - index * 2) }),
);

const uniformHistory: TransactionSample[] = Array.from({ length: 8 }, (_, index) =>
  makeTx({ id: `uniform-${index}`, amount: '20000.00', at: daysBefore(20 - index * 2) }),
);

export const FIXTURE_CASES: FixtureCase[] = [
  // ── Large transaction ────────────────────────────────────────────────────
  {
    id: 'large-usual-amount',
    kind: 'large',
    description: 'Một khoản chi bình thường trong dải lịch sử → không cảnh báo',
    expected: false,
    large: {
      candidate: makeTx({ id: 'candidate-normal', amount: '72000.00', at: daysBefore(0) }),
      history: steadyHistory,
    },
  },
  {
    id: 'large-insufficient-history',
    kind: 'large',
    description: 'Chỉ 5 giao dịch lịch sử → không đủ cơ sở, không cảnh báo',
    expected: false,
    large: {
      candidate: makeTx({ id: 'candidate-thin', amount: '900000.00', at: daysBefore(0) }),
      history: steadyHistory.slice(0, 5),
    },
  },
  {
    id: 'large-robust-outlier',
    kind: 'large',
    description: 'Khoản chi gấp nhiều lần trung vị, MAD > 0 → cảnh báo HIGH',
    expected: true,
    expectedSeverity: 'HIGH',
    large: {
      candidate: makeTx({ id: 'candidate-outlier', amount: '300000.00', at: daysBefore(0) }),
      history: steadyHistory,
    },
  },
  {
    id: 'large-mad-zero-high-ratio',
    kind: 'large',
    description: 'Lịch sử đồng nhất (MAD = 0), khoản chi gấp 5 lần → cảnh báo HIGH',
    expected: true,
    expectedSeverity: 'HIGH',
    large: {
      candidate: makeTx({ id: 'candidate-uniform-5x', amount: '100000.00', at: daysBefore(0) }),
      history: uniformHistory,
    },
  },
  {
    id: 'large-mad-zero-medium-ratio',
    kind: 'large',
    description: 'MAD = 0, khoản chi gấp 3,5 lần → cảnh báo MEDIUM',
    expected: true,
    expectedSeverity: 'MEDIUM',
    large: {
      candidate: makeTx({ id: 'candidate-uniform-3x', amount: '70000.00', at: daysBefore(0) }),
      history: uniformHistory,
    },
  },
  {
    id: 'large-mad-zero-below-ratio',
    kind: 'large',
    description: 'MAD = 0, khoản chi gấp 2,5 lần (dưới ngưỡng 3) → không cảnh báo',
    expected: false,
    large: {
      candidate: makeTx({ id: 'candidate-uniform-2x', amount: '50000.00', at: daysBefore(0) }),
      history: uniformHistory,
    },
  },
  {
    id: 'large-other-currency',
    kind: 'large',
    description: 'Lịch sử toàn VND, giao dịch USD → không so sánh chéo tiền tệ',
    expected: false,
    large: {
      candidate: makeTx({
        id: 'candidate-usd',
        amount: '900.00',
        currency: 'USD',
        at: daysBefore(0),
      }),
      history: steadyHistory,
    },
  },
  {
    id: 'large-transfer-ignored',
    kind: 'large',
    description: 'Chuyển tiền nội bộ không phải chi tiêu → bỏ qua',
    expected: false,
    large: {
      candidate: makeTx({
        id: 'candidate-transfer',
        amount: '500000.00',
        type: 'TRANSFER',
        at: daysBefore(0),
      }),
      history: steadyHistory,
    },
  },

  // ── Category spike ───────────────────────────────────────────────────────
  {
    id: 'spike-real-increase',
    kind: 'spike',
    description: 'Cùng số ngày, chi ăn uống tăng rõ rệt so với trung vị 3 tháng',
    expected: true,
    expectedSeverity: 'HIGH',
    spike: spikeInput('spike-real', {
      currentTransactions: [
        { amount: '1000000.00', day: 5 },
        { amount: '1000000.00', day: 10 },
      ],
      references: [
        {
          window: REF_SEP,
          transactions: [
            { amount: '200000.00', day: 4 },
            { amount: '200000.00', day: 12 },
          ],
        },
        {
          window: REF_AUG,
          transactions: [
            { amount: '150000.00', day: 3 },
            { amount: '150000.00', day: 9 },
          ],
        },
        {
          window: REF_JUL,
          transactions: [
            { amount: '180000.00', day: 6 },
            { amount: '170000.00', day: 11 },
          ],
        },
      ],
    }),
  },
  {
    id: 'spike-equal-length-window',
    kind: 'spike',
    description: 'Kỳ dài hơn nhưng so cùng số ngày, mức chi tương đương → không cảnh báo',
    expected: false,
    spike: spikeInput('spike-equal', {
      currentTransactions: [
        { amount: '300000.00', day: 4 },
        { amount: '300000.00', day: 12 },
      ],
      references: [
        {
          window: REF_SEP,
          transactions: [
            { amount: '260000.00', day: 5 },
            { amount: '250000.00', day: 14 },
          ],
        },
        {
          window: REF_AUG,
          transactions: [
            { amount: '270000.00', day: 2 },
            { amount: '260000.00', day: 10 },
          ],
        },
        {
          window: REF_JUL,
          transactions: [
            { amount: '255000.00', day: 7 },
            { amount: '250000.00', day: 15 },
          ],
        },
      ],
    }),
  },
  {
    id: 'spike-missing-reference-months',
    kind: 'spike',
    description: 'Chỉ 1 tháng tham chiếu có dữ liệu → không đủ cơ sở, không cảnh báo',
    expected: false,
    spike: spikeInput('spike-missing', {
      currentTransactions: [
        { amount: '1000000.00', day: 5 },
        { amount: '1000000.00', day: 10 },
      ],
      references: [
        {
          window: REF_SEP,
          transactions: [
            { amount: '200000.00', day: 4 },
            { amount: '200000.00', day: 12 },
          ],
        },
        { window: REF_AUG, transactions: [] },
        { window: REF_JUL, transactions: [] },
      ],
    }),
  },
  {
    id: 'spike-irregular-category',
    kind: 'spike',
    description: 'Danh mục chỉ xuất hiện 1 tháng trong quá khứ → khoản chi không thường xuyên',
    expected: false,
    spike: spikeInput('spike-irregular', {
      currentTransactions: [
        { amount: '900000.00', day: 3 },
        { amount: '900000.00', day: 9 },
      ],
      references: [
        {
          window: REF_SEP,
          transactions: [
            { amount: '500000.00', day: 4 },
            { amount: '500000.00', day: 12 },
          ],
        },
        // Có chi tiêu khác trong tháng, nhưng không có ăn uống.
        {
          window: REF_AUG,
          transactions: [
            { amount: '150000.00', day: 3, categoryId: 'category-transport' },
            { amount: '150000.00', day: 9, categoryId: 'category-transport' },
          ],
        },
        {
          window: REF_JUL,
          transactions: [
            { amount: '160000.00', day: 6, categoryId: 'category-transport' },
            { amount: '160000.00', day: 11, categoryId: 'category-transport' },
          ],
        },
      ],
    }),
  },
  {
    id: 'spike-single-transaction',
    kind: 'spike',
    description: 'Chỉ 1 giao dịch trong kỳ hiện tại → để detector khoản chi lớn xử lý',
    expected: false,
    spike: spikeInput('spike-single', {
      currentTransactions: [{ amount: '5000000.00', day: 5 }],
      references: [
        {
          window: REF_SEP,
          transactions: [
            { amount: '200000.00', day: 4 },
            { amount: '200000.00', day: 12 },
          ],
        },
        {
          window: REF_AUG,
          transactions: [
            { amount: '150000.00', day: 3 },
            { amount: '150000.00', day: 9 },
          ],
        },
        {
          window: REF_JUL,
          transactions: [
            { amount: '180000.00', day: 6 },
            { amount: '170000.00', day: 11 },
          ],
        },
      ],
    }),
  },
  {
    id: 'spike-other-currency',
    kind: 'spike',
    description: 'Chi tiêu USD không được cộng vào phân tích VND',
    expected: false,
    spike: spikeInput('spike-usd', {
      currentTransactions: [
        { amount: '500.00', day: 5, currency: 'USD' },
        { amount: '500.00', day: 10, currency: 'USD' },
      ],
      references: [
        {
          window: REF_SEP,
          transactions: [
            { amount: '200000.00', day: 4 },
            { amount: '200000.00', day: 12 },
          ],
        },
        {
          window: REF_AUG,
          transactions: [
            { amount: '150000.00', day: 3 },
            { amount: '150000.00', day: 9 },
          ],
        },
        {
          window: REF_JUL,
          transactions: [
            { amount: '180000.00', day: 6 },
            { amount: '170000.00', day: 11 },
          ],
        },
      ],
    }),
  },

  // ── Possible duplicate ───────────────────────────────────────────────────
  {
    id: 'dup-same-minute',
    kind: 'duplicate',
    description: 'Cùng tài khoản, số tiền, cách nhau 10 phút, mô tả tương tự → cảnh báo LOW',
    expected: true,
    expectedSeverity: 'LOW',
    duplicate: [
      makeTx({
        id: 'dup-a',
        amount: '80000.00',
        at: daysBefore(1),
        description: 'Highlands Coffee',
      }),
      makeTx({
        id: 'dup-b',
        amount: '80000.00',
        at: new Date(daysBefore(1).getTime() + 10 * 60_000),
        description: 'Highlands Coffee',
      }),
    ],
  },
  {
    id: 'dup-different-description',
    kind: 'duplicate',
    description: 'Mô tả khác nhau nhưng cùng tài khoản/số tiền/thời gian → vẫn cảnh báo',
    expected: true,
    expectedSeverity: 'LOW',
    duplicate: [
      makeTx({ id: 'dup-c', amount: '120000.00', at: daysBefore(2), description: 'Grab đi làm' }),
      makeTx({
        id: 'dup-d',
        amount: '120000.00',
        at: new Date(daysBefore(2).getTime() + 5 * 60_000),
        description: 'Thanh toán',
      }),
    ],
  },
  {
    id: 'dup-monthly-recurring',
    kind: 'duplicate',
    description: 'Hai giao dịch giống nhau cách 30 ngày (định kỳ) → không phải trùng lặp',
    expected: false,
    duplicate: [
      makeTx({
        id: 'recurring-a',
        amount: '500000.00',
        at: daysBefore(35),
        description: 'Tiền nhà',
      }),
      makeTx({
        id: 'recurring-b',
        amount: '500000.00',
        at: daysBefore(5),
        description: 'Tiền nhà',
      }),
    ],
  },
  {
    id: 'dup-different-account',
    kind: 'duplicate',
    description: 'Cùng số tiền nhưng khác tài khoản → không cảnh báo',
    expected: false,
    duplicate: [
      makeTx({ id: 'acct-a', amount: '60000.00', at: daysBefore(1), accountId: 'account-1' }),
      makeTx({
        id: 'acct-b',
        amount: '60000.00',
        at: new Date(daysBefore(1).getTime() + 15 * 60_000),
        accountId: 'account-2',
      }),
    ],
  },
  {
    id: 'dup-25-hours-apart',
    kind: 'duplicate',
    description: 'Cách nhau hơn 24 giờ → ngoài cửa sổ trùng lặp',
    expected: false,
    duplicate: [
      makeTx({ id: 'gap-a', amount: '45000.00', at: daysBefore(2) }),
      makeTx({
        id: 'gap-b',
        amount: '45000.00',
        at: new Date(daysBefore(2).getTime() + 25 * 60 * 60_000),
      }),
    ],
  },
  {
    id: 'dup-different-amount',
    kind: 'duplicate',
    description: 'Cách nhau 5 phút nhưng khác số tiền → không cảnh báo',
    expected: false,
    duplicate: [
      makeTx({ id: 'amount-a', amount: '45000.00', at: daysBefore(1) }),
      makeTx({
        id: 'amount-b',
        amount: '46000.00',
        at: new Date(daysBefore(1).getTime() + 5 * 60_000),
      }),
    ],
  },
  {
    id: 'dup-transfer-legs',
    kind: 'duplicate',
    description: 'Hai vế của một lệnh chuyển tiền nội bộ → bỏ qua',
    expected: false,
    duplicate: [
      makeTx({ id: 'transfer-out', amount: '2000000.00', at: daysBefore(1), type: 'TRANSFER' }),
      makeTx({
        id: 'transfer-in',
        amount: '2000000.00',
        at: daysBefore(1),
        type: 'TRANSFER',
        accountId: 'account-2',
      }),
    ],
  },
];
