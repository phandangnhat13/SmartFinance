import type { TransactionSample } from './anomaly.types';
import { makeTx, makeWindow } from '../fixtures/anomaly-scenarios';
import {
  CATEGORY_SPIKE_RULES,
  type SpikeWindow,
  detectCategorySpike,
} from './category-spike.detector';

const CURRENT = makeWindow('2026-10', 18);
const REF_SEP = makeWindow('2026-09', 18);
const REF_AUG = makeWindow('2026-08', 18);
const REF_JUL = makeWindow('2026-07', 18);

const DAY_MS = 24 * 60 * 60 * 1000;
const midDay = (window: SpikeWindow, day: number) =>
  new Date(window.start.getTime() + (day - 1) * DAY_MS + 12 * 60 * 60 * 1000);

function expense(
  id: string,
  amount: string,
  at: Date,
  overrides: Partial<TransactionSample> = {},
): TransactionSample {
  return makeTx({ id, amount, at, categoryId: 'category-food', ...overrides });
}

/** Two food expenses in the same month, on days 4 and 12. */
const monthOf = (prefix: string, window: SpikeWindow, amount: string, categoryId?: string) => [
  expense(`${prefix}-a`, amount, midDay(window, 4), categoryId ? { categoryId } : {}),
  expense(`${prefix}-b`, amount, midDay(window, 12), categoryId ? { categoryId } : {}),
];

function spike(
  currentTransactions: TransactionSample[],
  references: SpikeWindow[],
  transactions: TransactionSample[],
) {
  return detectCategorySpike({
    categoryId: 'category-food',
    categoryName: 'Ăn uống',
    currency: 'VND',
    current: CURRENT,
    references,
    transactions: [...currentTransactions, ...transactions],
  });
}

const standardReferences = [
  ...monthOf('sep', REF_SEP, '200000.00'),
  ...monthOf('aug', REF_AUG, '150000.00'),
  ...monthOf('jul', REF_JUL, '175000.00'),
];

describe('detectCategorySpike — producing an alert', () => {
  it('compares the same span of days and explains the numbers', () => {
    const result = spike(
      monthOf('oct', CURRENT, '1000000.00'),
      [REF_SEP, REF_AUG, REF_JUL],
      standardReferences,
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe('CATEGORY_SPIKE');
    expect(result!.severity).toBe('HIGH');
    expect(result!.dedupeKey).toBe('SPIKE:category-food:2026-10');
    expect(result!.categoryId).toBe('category-food');
    expect(result!.score).toBeNull();
    expect(result!.facts.currentSpend).toBe('2000000.00');
    expect(result!.facts.currentTransactions).toBe(2);
    expect(result!.facts.baseline).toBe('350000.00');
    expect(result!.facts.ratio).toBe('5.7143');
    expect(result!.facts.windowDays).toBe(18);
    expect(result!.facts.currentMonth).toBe('2026-10');
    expect(result!.facts.referenceMonths).toHaveLength(3);
    expect(result!.facts.excludedReferenceMonths).toEqual([]);
    expect(result!.periodStart!.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(result!.periodEnd!.toISOString().slice(0, 10)).toBe('2026-10-18');
    expect(result!.explanation).toContain('Ăn uống');
    expect(result!.explanation).toContain('18 ngày');
  });

  it('treats a reference month with no data as missing, not as zero', () => {
    const result = spike(
      monthOf('oct', CURRENT, '1000000.00'),
      [REF_SEP, REF_AUG, REF_JUL],
      [
        ...monthOf('sep', REF_SEP, '200000.00'),
        // Không có giao dịch nào trong tháng 8.
        ...monthOf('jul', REF_JUL, '170000.00'),
      ],
    );
    expect(result).not.toBeNull();
    expect(result!.facts.excludedReferenceMonths).toEqual([
      { month: '2026-08', reason: 'no_data' },
    ]);
    expect(result!.facts.referenceMonths.map((month) => month.month)).toEqual([
      '2026-09',
      '2026-07',
    ]);
    expect(result!.facts.baseline).toBe('370000.00');
    expect(result!.explanation).toContain('1 tháng không có dữ liệu');
  });

  it('filters out expenses in another currency before comparing', () => {
    const current = [
      ...monthOf('oct', CURRENT, '1000000.00'),
      expense('oct-usd', '9999999.00', midDay(CURRENT, 6), { currency: 'USD' }),
    ];
    const result = spike(current, [REF_SEP, REF_AUG, REF_JUL], standardReferences);
    expect(result).not.toBeNull();
    expect(result!.facts.currentSpend).toBe('2000000.00');
    expect(result!.facts.currentTransactions).toBe(2);
  });

  it('excludes a transaction exactly on the exclusive window boundary', () => {
    const current = [
      ...monthOf('oct', CURRENT, '1000000.00'),
      expense('boundary', '5000000.00', new Date(CURRENT.endExclusive)),
    ];
    const result = spike(current, [REF_SEP, REF_AUG, REF_JUL], standardReferences);
    expect(result!.facts.currentSpend).toBe('2000000.00');
    expect(result!.facts.currentTransactions).toBe(2);
  });
});

describe('detectCategorySpike — severity thresholds', () => {
  // Baseline 150 000: median of a 100 000 month (2 × 50 000) and a 200 000 month (2 × 100 000).
  const references = [
    ...monthOf('sep', REF_SEP, '50000.00'),
    ...monthOf('aug', REF_AUG, '100000.00'),
  ];
  const twoReferences = [REF_SEP, REF_AUG];

  it('marks exactly 2× the baseline as HIGH', () => {
    const result = spike(monthOf('oct', CURRENT, '150000.00'), twoReferences, references);
    expect(result).not.toBeNull();
    expect(result!.facts.baseline).toBe('150000.00');
    expect(result!.facts.ratio).toBe('2.0000');
    expect(result!.severity).toBe('HIGH');
  });

  it('marks exactly 1.5× the baseline as MEDIUM', () => {
    const result = spike(
      [
        expense('oct-a', '112500.00', midDay(CURRENT, 4)),
        expense('oct-b', '112500.00', midDay(CURRENT, 12)),
      ],
      twoReferences,
      references,
    );
    expect(result).not.toBeNull();
    expect(result!.facts.ratio).toBe('1.5000');
    expect(result!.severity).toBe('MEDIUM');
  });

  it('stays quiet below the 1.5× threshold', () => {
    const result = spike(
      [
        expense('oct-a', '105000.00', midDay(CURRENT, 4)),
        expense('oct-b', '105000.00', midDay(CURRENT, 12)),
      ],
      twoReferences,
      references,
    );
    expect(result).toBeNull();
  });
});

describe('detectCategorySpike — insufficient or irregular data', () => {
  it('needs at least two reference months with data', () => {
    const result = spike(
      monthOf('oct', CURRENT, '5000000.00'),
      [REF_SEP, REF_AUG, REF_JUL],
      monthOf('sep', REF_SEP, '200000.00'),
    );
    expect(result).toBeNull();
  });

  it('needs the category to appear in at least two reference months', () => {
    const references = [
      ...monthOf('sep', REF_SEP, '250000.00'),
      ...monthOf('aug', REF_AUG, '150000.00', 'category-transport'),
      ...monthOf('jul', REF_JUL, '160000.00', 'category-transport'),
    ];
    const result = spike(
      monthOf('oct', CURRENT, '900000.00'),
      [REF_SEP, REF_AUG, REF_JUL],
      references,
    );
    expect(result).toBeNull();
  });

  it('needs at least two transactions in the current window', () => {
    const result = spike(
      [expense('oct-single', '5000000.00', midDay(CURRENT, 5))],
      [REF_SEP, REF_AUG, REF_JUL],
      standardReferences,
    );
    expect(result).toBeNull();
  });

  it('needs current spending in the category at all', () => {
    const current = monthOf('oct', CURRENT, '1000000.00', 'category-transport');
    const result = spike(current, [REF_SEP, REF_AUG, REF_JUL], standardReferences);
    expect(result).toBeNull();
  });

  it('ignores transactions outside the compared windows', () => {
    const result = spike(
      [
        ...monthOf('oct', CURRENT, '1000000.00'),
        expense('old', '9000000.00', midDay(makeWindow('2026-01', 18), 5)),
      ],
      [REF_SEP, REF_AUG, REF_JUL],
      standardReferences,
    );
    expect(result!.facts.currentSpend).toBe('2000000.00');
  });
});

describe('CATEGORY_SPIKE_RULES', () => {
  it('documents its thresholds in the produced facts', () => {
    const result = spike(
      monthOf('oct', CURRENT, '1000000.00'),
      [REF_SEP, REF_AUG, REF_JUL],
      standardReferences,
    );
    expect(result!.facts.thresholds).toEqual({
      ratio: CATEGORY_SPIKE_RULES.ratioThreshold,
      minReferenceMonths: CATEGORY_SPIKE_RULES.minReferenceMonths,
      minNonZeroReferenceMonths: CATEGORY_SPIKE_RULES.minNonZeroReferenceMonths,
      minCurrentTransactions: CATEGORY_SPIKE_RULES.minCurrentTransactions,
    });
  });
});
