import { Prisma } from '@prisma/client';
import type { TransactionSample } from './anomaly.types';
import { LARGE_TRANSACTION_RULES, detectLargeTransaction } from './large-transaction.detector';

const BASE = new Date('2026-10-18T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (days: number) => new Date(BASE.getTime() - days * DAY_MS);

function tx(
  overrides: Partial<TransactionSample> & { id: string; amount: string },
): TransactionSample {
  return {
    accountId: 'account-1',
    categoryId: 'category-food',
    type: 'EXPENSE',
    currency: 'VND',
    description: 'Chi tiêu',
    occurredAt: daysBefore(10),
    ...overrides,
  };
}

/** Ten expenses, two days apart, median 60 000 and MAD 5 000. */
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
  tx({ id: `steady-${index}`, amount, occurredAt: daysBefore(30 - index * 2) }),
);

/** Eight identical expenses: MAD is 0, so the ratio fallback applies. */
const uniformHistory: TransactionSample[] = Array.from({ length: 8 }, (_, index) =>
  tx({ id: `uniform-${index}`, amount: '20000.00', occurredAt: daysBefore(20 - index * 2) }),
);

/** Wide spread: median 45 000, MAD 20 000 and scale ≈ 29 652, so 150 000 lands at z ≈ 3.54. */
const wideHistory: TransactionSample[] = [
  '10000',
  '20000',
  '30000',
  '40000',
  '50000',
  '60000',
  '70000',
  '80000',
].map((amount, index) =>
  tx({ id: `wide-${index}`, amount: `${amount}.00`, occurredAt: daysBefore(24 - index * 2) }),
);

const candidate = (amount: string, overrides: Partial<TransactionSample> = {}) =>
  tx({ id: 'candidate', amount, occurredAt: BASE, ...overrides });

describe('detectLargeTransaction — eligibility', () => {
  it('ignores non-expense transactions', () => {
    expect(
      detectLargeTransaction({
        candidate: candidate('900000.00', { type: 'TRANSFER' }),
        history: steadyHistory,
      }),
    ).toBeNull();
    expect(
      detectLargeTransaction({
        candidate: candidate('900000.00', { type: 'INCOME' }),
        history: steadyHistory,
      }),
    ).toBeNull();
  });

  it('produces no alert when history is below the documented minimum', () => {
    const result = detectLargeTransaction({
      candidate: candidate('900000.00'),
      history: steadyHistory.slice(0, LARGE_TRANSACTION_RULES.minHistoryCount - 1),
    });
    expect(result).toBeNull();
  });

  it('produces an alert at exactly the minimum history count when the amount is extreme', () => {
    const result = detectLargeTransaction({
      candidate: candidate('900000.00'),
      history: steadyHistory.slice(0, LARGE_TRANSACTION_RULES.minHistoryCount),
    });
    expect(result).not.toBeNull();
    expect(result!.facts.historyCount).toBe(LARGE_TRANSACTION_RULES.minHistoryCount);
  });

  it('ignores history rows that are not comparable', () => {
    const confounders: TransactionSample[] = [
      tx({ id: 'other-currency', amount: '60000.00', currency: 'USD', occurredAt: daysBefore(28) }),
      tx({ id: 'income', amount: '60000.00', type: 'INCOME', occurredAt: daysBefore(28) }),
      tx({ id: 'future', amount: '60000.00', occurredAt: daysBefore(-1) }),
      tx({ id: 'candidate', amount: '999999.00', occurredAt: daysBefore(28) }),
    ];
    const result = detectLargeTransaction({
      candidate: candidate('300000.00'),
      history: [...steadyHistory, ...confounders],
    });
    expect(result).not.toBeNull();
    expect(result!.facts.historyCount).toBe(steadyHistory.length);
  });
});

describe('detectLargeTransaction — robust z-score rule', () => {
  it('stays quiet for an amount inside the usual range', () => {
    expect(
      detectLargeTransaction({ candidate: candidate('72000.00'), history: steadyHistory }),
    ).toBeNull();
  });

  it('stays quiet for an amount below the median', () => {
    expect(
      detectLargeTransaction({ candidate: candidate('10000.00'), history: steadyHistory }),
    ).toBeNull();
  });

  it('raises a HIGH alert for a clear outlier and records the numbers behind it', () => {
    const result = detectLargeTransaction({
      candidate: candidate('300000.00'),
      history: steadyHistory,
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('LARGE_TRANSACTION');
    expect(result!.severity).toBe('HIGH');
    expect(result!.dedupeKey).toBe('LARGE:candidate');
    expect(result!.transactionId).toBe('candidate');
    expect(result!.score).not.toBeNull();
    expect(result!.facts.method).toBe('robust_z');
    expect(result!.facts.median).toBe('60000.00');
    expect(result!.facts.mad).toBe('5000.00');
    expect(result!.facts.historyCount).toBe(10);
    expect(result!.facts.historyDays).toBe(10);
    expect(result!.facts.amount).toBe('300000.00');
    expect(Number(result!.facts.robustZ)).toBeGreaterThan(LARGE_TRANSACTION_RULES.highSeverityZ);
    expect(result!.explanation).toContain('300.000');
  });

  it('raises a MEDIUM alert between the alert and high thresholds', () => {
    const result = detectLargeTransaction({
      candidate: candidate('150000.00'),
      history: wideHistory,
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('MEDIUM');
    const z = Number(result!.facts.robustZ);
    expect(z).toBeGreaterThanOrEqual(LARGE_TRANSACTION_RULES.robustZThreshold);
    expect(z).toBeLessThan(LARGE_TRANSACTION_RULES.highSeverityZ);
  });

  it('stays quiet just below the robust z threshold', () => {
    // (140 000 − 45 000) / (1.4826 × 20 000) ≈ 3.20 < 3.5
    expect(
      detectLargeTransaction({ candidate: candidate('140000.00'), history: wideHistory }),
    ).toBeNull();
  });

  it('clamps a z-score that exceeds DECIMAL(10, 4) but keeps the exact value in facts', () => {
    // A near-uniform history: 4 × 1 000.00 and 4 × 1 000.01 → median 1 000.005,
    // MAD 0.005, scale ≈ 0.007413, so 10 000.00 lands at z ≈ 1 214 000. PostgreSQL
    // cannot store anything ≥ 1 000 000 in the score column.
    const nearUniform: TransactionSample[] = [
      '1000.00',
      '1000.00',
      '1000.00',
      '1000.00',
      '1000.01',
      '1000.01',
      '1000.01',
      '1000.01',
    ].map((amount, index) =>
      tx({ id: `near-uniform-${index}`, amount, occurredAt: daysBefore(60 - index * 3) }),
    );

    const result = detectLargeTransaction({
      candidate: candidate('10000.00'),
      history: nearUniform,
    });

    expect(result).not.toBeNull();
    expect(result!.severity).toBe('HIGH');
    expect(result!.score).toBe('999999.9999');
    expect(result!.facts.scoreClamped).toBe(true);
    // The exact z-score is still recorded and is larger than the column allows.
    expect(new Prisma.Decimal(result!.facts.robustZ!).greaterThan('999999.9999')).toBe(true);
    expect(Number(result!.facts.robustZ)).toBeGreaterThan(1_000_000);
    // The explanation quotes the exact z-score, not the clamped column value.
    expect(result!.explanation).toContain(Number(result!.facts.robustZ).toFixed(1));
    expect(result!.explanation).not.toContain('999999.9999');
  });
});

describe('detectLargeTransaction — MAD = 0 fallback', () => {
  it('uses the ratio rule and reports no score', () => {
    const result = detectLargeTransaction({
      candidate: candidate('60000.00'),
      history: uniformHistory,
    });
    expect(result).not.toBeNull();
    expect(result!.facts.method).toBe('mad_zero_ratio');
    expect(result!.facts.mad).toBe('0.00');
    expect(result!.facts.robustZ).toBeNull();
    expect(result!.score).toBeNull();
    expect(result!.facts.ratio).toBe('3.0000');
  });

  it('marks 5× the median as HIGH', () => {
    const result = detectLargeTransaction({
      candidate: candidate('100000.00'),
      history: uniformHistory,
    });
    expect(result!.severity).toBe('HIGH');
    expect(result!.facts.ratio).toBe('5.0000');
  });

  it('marks 3.5× the median as MEDIUM', () => {
    const result = detectLargeTransaction({
      candidate: candidate('70000.00'),
      history: uniformHistory,
    });
    expect(result!.severity).toBe('MEDIUM');
    expect(result!.facts.ratio).toBe('3.5000');
  });

  it('stays quiet below the 3× ratio threshold', () => {
    expect(
      detectLargeTransaction({ candidate: candidate('59000.00'), history: uniformHistory }),
    ).toBeNull();
    expect(
      detectLargeTransaction({ candidate: candidate('50000.00'), history: uniformHistory }),
    ).toBeNull();
  });

  it('stays quiet when the amount equals the uniform history', () => {
    expect(
      detectLargeTransaction({ candidate: candidate('20000.00'), history: uniformHistory }),
    ).toBeNull();
  });
});
