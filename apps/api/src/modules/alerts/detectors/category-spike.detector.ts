import { Prisma } from '@prisma/client';
import type { DetectorResult, TransactionSample } from './anomaly.types';
import { decimalString, formatAmount } from './anomaly.types';
import { median } from './stats';

/**
 * One month-shaped comparison window. Current and reference windows always
 * span the *same number of days* (e.g. 1–18 of each month), so a month simply
 * being longer than the one it is compared against cannot produce an alert.
 */
export interface SpikeWindow {
  /** 'YYYY-MM' in the user's timezone. */
  month: string;
  /** Inclusive instant, UTC. */
  start: Date;
  /** Exclusive instant, UTC. */
  endExclusive: Date;
  /** Calendar first day, for the DATE column. */
  periodStart: Date;
  /** Calendar last day of the compared span, for the DATE column. */
  periodEnd: Date;
  /** Number of calendar days covered (1–31). */
  days: number;
}

/**
 * Category spending spike against the user's own recent months.
 *
 * Deliberate conservatism:
 * - A reference month with no expense transactions at all is *missing data*,
 *   not a month with zero spending. It is excluded, never counted as 0.
 * - The category must have had spending in at least two reference months, so a
 *   one-off purchase last month does not become a "baseline".
 * - The current window needs at least two transactions in the category; a
 *   single large payment is the large-transaction detector's job.
 */
export const CATEGORY_SPIKE_RULES = {
  minReferenceMonths: 2,
  minNonZeroReferenceMonths: 2,
  minCurrentTransactions: 2,
  ratioThreshold: 1.5,
  highSeverityRatio: 2,
} as const;

export interface CategorySpikeFacts {
  method: 'matched_day_window';
  categoryName: string;
  currency: string;
  currentMonth: string;
  windowDays: number;
  currentSpend: string;
  currentTransactions: number;
  baseline: string;
  ratio: string;
  referenceMonths: Array<{
    month: string;
    spend: string;
    transactions: number;
    days: number;
  }>;
  excludedReferenceMonths: Array<{ month: string; reason: 'no_data' }>;
  thresholds: {
    ratio: number;
    minReferenceMonths: number;
    minNonZeroReferenceMonths: number;
    minCurrentTransactions: number;
  };
}

export interface CategorySpikeInput {
  categoryId: string;
  categoryName: string;
  /** Calendar currency of the plan; amounts in other currencies are ignored. */
  currency: string;
  current: SpikeWindow;
  references: readonly SpikeWindow[];
  /** EXPENSE transactions in the union of the windows; extra rows are ignored. */
  transactions: readonly TransactionSample[];
}

/** Rebuilds the explanation from the stored facts only. */
export function explainCategorySpike(facts: CategorySpikeFacts): string {
  const currentSpend = new Prisma.Decimal(facts.currentSpend);
  const baseline = new Prisma.Decimal(facts.baseline);
  return (
    `Chi cho "${facts.categoryName}" trong ${facts.windowDays} ngày của tháng ${facts.currentMonth} là ` +
    `${formatAmount(currentSpend, facts.currency)} (${facts.currentTransactions} giao dịch), ` +
    `gấp ${Number(facts.ratio).toFixed(1)} lần mức trung vị ${formatAmount(baseline, facts.currency)} của ` +
    `${facts.referenceMonths.length} tháng trước trong cùng số ngày.` +
    (facts.excludedReferenceMonths.length > 0
      ? ` ${facts.excludedReferenceMonths.length} tháng không có dữ liệu chi tiêu đã bị loại khỏi mức so sánh.`
      : '')
  );
}

interface WindowTotals {
  spend: Prisma.Decimal;
  categoryCount: number;
  totalCount: number;
}

export function detectCategorySpike(
  input: CategorySpikeInput,
): DetectorResult<CategorySpikeFacts> | null {
  const { categoryId, categoryName, currency, current, references } = input;
  const expenses = input.transactions.filter(
    (transaction) => transaction.type === 'EXPENSE' && transaction.currency === currency,
  );

  const totalsFor = (window: SpikeWindow): WindowTotals => {
    let spend = new Prisma.Decimal(0);
    let categoryCount = 0;
    let totalCount = 0;
    for (const transaction of expenses) {
      const time = transaction.occurredAt.getTime();
      if (time < window.start.getTime() || time >= window.endExclusive.getTime()) continue;
      totalCount += 1;
      if (transaction.categoryId !== categoryId) continue;
      categoryCount += 1;
      spend = spend.plus(new Prisma.Decimal(transaction.amount));
    }
    return { spend, categoryCount, totalCount };
  };

  const currentTotals = totalsFor(current);
  if (currentTotals.categoryCount < CATEGORY_SPIKE_RULES.minCurrentTransactions) return null;

  const included: Array<{ window: SpikeWindow; totals: WindowTotals }> = [];
  const excluded: Array<{ month: string; reason: 'no_data' }> = [];
  for (const reference of references) {
    const totals = totalsFor(reference);
    // No expenses at all in the window means the user was not using the app or
    // the period predates their data; treating it as 0 would manufacture a spike.
    if (totals.totalCount === 0) {
      excluded.push({ month: reference.month, reason: 'no_data' });
      continue;
    }
    included.push({ window: reference, totals });
  }
  if (included.length < CATEGORY_SPIKE_RULES.minReferenceMonths) return null;

  // Irregular spending should not create a baseline: require the category to
  // have appeared (with a positive amount) in at least two reference months.
  const nonZeroMonths = included.filter((entry) => entry.totals.spend.greaterThan(0));
  if (nonZeroMonths.length < CATEGORY_SPIKE_RULES.minNonZeroReferenceMonths) return null;

  const baseline = median(included.map((entry) => entry.totals.spend));
  if (baseline.lessThanOrEqualTo(0)) return null;

  const ratio = currentTotals.spend.dividedBy(baseline);
  if (ratio.lessThan(CATEGORY_SPIKE_RULES.ratioThreshold)) return null;

  const facts: CategorySpikeFacts = {
    method: 'matched_day_window',
    categoryName,
    currency,
    currentMonth: current.month,
    windowDays: current.days,
    currentSpend: decimalString(currentTotals.spend),
    currentTransactions: currentTotals.categoryCount,
    baseline: decimalString(baseline),
    ratio: ratio.toFixed(4),
    referenceMonths: included.map((entry) => ({
      month: entry.window.month,
      spend: decimalString(entry.totals.spend),
      transactions: entry.totals.categoryCount,
      days: entry.window.days,
    })),
    excludedReferenceMonths: excluded,
    thresholds: {
      ratio: CATEGORY_SPIKE_RULES.ratioThreshold,
      minReferenceMonths: CATEGORY_SPIKE_RULES.minReferenceMonths,
      minNonZeroReferenceMonths: CATEGORY_SPIKE_RULES.minNonZeroReferenceMonths,
      minCurrentTransactions: CATEGORY_SPIKE_RULES.minCurrentTransactions,
    },
  };

  const severity = ratio.greaterThanOrEqualTo(CATEGORY_SPIKE_RULES.highSeverityRatio)
    ? 'HIGH'
    : 'MEDIUM';

  return {
    type: 'CATEGORY_SPIKE',
    severity,
    dedupeKey: `SPIKE:${categoryId}:${current.month}`,
    transactionId: null,
    relatedTransactionId: null,
    categoryId,
    periodStart: current.periodStart,
    periodEnd: current.periodEnd,
    score: null,
    facts,
    explanation: explainCategorySpike(facts),
  };
}
