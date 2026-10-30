import type { TransactionSample } from './anomaly.types';
import { makeTx } from '../fixtures/anomaly-scenarios';
import { DUPLICATE_RULES, detectPossibleDuplicates } from './possible-duplicate.detector';

const BASE = new Date('2026-10-17T09:00:00.000Z');
const MINUTE_MS = 60 * 1000;

const at = (minutesAfterBase: number) => new Date(BASE.getTime() + minutesAfterBase * MINUTE_MS);

function expense(
  id: string,
  amount: string,
  minutesAfterBase: number,
  overrides: Partial<TransactionSample> = {},
): TransactionSample {
  return makeTx({ id, amount, at: at(minutesAfterBase), ...overrides });
}

describe('detectPossibleDuplicates — matching', () => {
  it('flags two identical-looking expenses and points at both sides', () => {
    const results = detectPossibleDuplicates([
      expense('b', '80000.00', 10),
      expense('a', '80000.00', 0),
    ]);
    expect(results).toHaveLength(1);
    const [alert] = results;
    expect(alert.type).toBe('POSSIBLE_DUPLICATE');
    expect(alert.severity).toBe('LOW');
    expect(alert.score).toBeNull();
    expect(alert.dedupeKey).toBe('DUP:a:b');
    expect(alert.transactionId).toBe('b');
    expect(alert.relatedTransactionId).toBe('a');
    expect(alert.facts.minutesApart).toBe(10);
    expect(alert.facts.descriptionSimilar).toBe(true);
    expect(alert.facts.note).toContain('không phải kết luận');
  });

  it('produces the same dedupe key whatever order the rows arrive in', () => {
    const forward = detectPossibleDuplicates([
      expense('a', '80000.00', 0),
      expense('b', '80000.00', 10),
    ]);
    const backward = detectPossibleDuplicates([
      expense('b', '80000.00', 10),
      expense('a', '80000.00', 0),
    ]);
    expect(forward[0].dedupeKey).toBe(backward[0].dedupeKey);
    expect(forward[0].transactionId).toBe(backward[0].transactionId);
    expect(forward[0].relatedTransactionId).toBe(backward[0].relatedTransactionId);
  });

  it('still flags the pair when descriptions differ, recording similarity as a fact only', () => {
    const results = detectPossibleDuplicates([
      expense('a', '120000.00', 0, { description: 'Grab đi làm' }),
      expense('b', '120000.00', 5, { description: 'Thanh toán' }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].facts.descriptionSimilar).toBe(false);
    expect(results[0].explanation).not.toContain('mô tả tương tự');
  });

  it('treats equal amounts with different scale as the same amount', () => {
    const results = detectPossibleDuplicates([
      expense('a', '80000.00', 0),
      expense('b', '80000', 3),
    ]);
    expect(results).toHaveLength(1);
  });

  it('includes a pair exactly on the 24-hour boundary', () => {
    const results = detectPossibleDuplicates([
      expense('a', '45000.00', 0),
      expense('b', '45000.00', DUPLICATE_RULES.windowMinutes),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].facts.minutesApart).toBe(DUPLICATE_RULES.windowMinutes);
  });

  it('uses the id as a stable tie-break when timestamps are identical', () => {
    const results = detectPossibleDuplicates([
      expense('z', '10000.00', 0),
      expense('a', '10000.00', 0),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].relatedTransactionId).toBe('a');
    expect(results[0].transactionId).toBe('z');
  });

  it('finds every pair in a group of three identical rows', () => {
    const results = detectPossibleDuplicates([
      expense('a', '30000.00', 0),
      expense('b', '30000.00', 1),
      expense('c', '30000.00', 2),
    ]);
    expect(results.map((alert) => alert.dedupeKey).sort()).toEqual([
      'DUP:a:b',
      'DUP:a:c',
      'DUP:b:c',
    ]);
  });
});

describe('detectPossibleDuplicates — non-matches', () => {
  it('ignores rows on different accounts', () => {
    expect(
      detectPossibleDuplicates([
        expense('a', '60000.00', 0, { accountId: 'account-1' }),
        expense('b', '60000.00', 15, { accountId: 'account-2' }),
      ]),
    ).toHaveLength(0);
  });

  it('ignores a monthly recurring payment', () => {
    expect(
      detectPossibleDuplicates([
        expense('a', '500000.00', 0, { description: 'Tiền nhà' }),
        expense('b', '500000.00', 30 * 24 * 60, { description: 'Tiền nhà' }),
      ]),
    ).toHaveLength(0);
  });

  it('ignores pairs just outside the window', () => {
    expect(
      detectPossibleDuplicates([
        expense('a', '45000.00', 0),
        expense('b', '45000.00', DUPLICATE_RULES.windowMinutes + 1),
      ]),
    ).toHaveLength(0);
  });

  it('ignores different amounts', () => {
    expect(
      detectPossibleDuplicates([expense('a', '45000.00', 0), expense('b', '46000.00', 5)]),
    ).toHaveLength(0);
  });

  it('ignores different currencies', () => {
    expect(
      detectPossibleDuplicates([
        expense('a', '45000.00', 0),
        expense('b', '45000.00', 5, { currency: 'USD' }),
      ]),
    ).toHaveLength(0);
  });

  it('ignores different transaction types', () => {
    expect(
      detectPossibleDuplicates([
        expense('a', '45000.00', 0),
        expense('b', '45000.00', 5, { type: 'INCOME' }),
      ]),
    ).toHaveLength(0);
  });

  it('ignores internal transfer legs', () => {
    expect(
      detectPossibleDuplicates([
        expense('out', '2000000.00', 0, { type: 'TRANSFER' }),
        expense('in', '2000000.00', 0, { type: 'TRANSFER' }),
      ]),
    ).toHaveLength(0);
  });

  it('returns nothing for fewer than two rows', () => {
    expect(detectPossibleDuplicates([])).toHaveLength(0);
    expect(detectPossibleDuplicates([expense('only', '1000.00', 0)])).toHaveLength(0);
  });
});

describe('detectPossibleDuplicates — flood protection', () => {
  it('caps the number of pairs returned by one scan', () => {
    const many = Array.from({ length: 21 }, (_, index) =>
      expense(`tx-${index}`, '10000.00', index),
    );
    const results = detectPossibleDuplicates(many);
    expect(results).toHaveLength(DUPLICATE_RULES.maxPairs);
    expect(new Set(results.map((alert) => alert.dedupeKey)).size).toBe(DUPLICATE_RULES.maxPairs);
  });
});
