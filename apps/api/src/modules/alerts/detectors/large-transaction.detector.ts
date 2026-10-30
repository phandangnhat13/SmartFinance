import { Prisma } from '@prisma/client';
import { toStoredScore } from '../alert-score';
import type { DetectorResult, TransactionSample } from './anomaly.types';
import { decimalString, formatAmount } from './anomaly.types';
import { robustStats, robustZ } from './stats';

/**
 * A big expense relative to the user's own history, not to an absolute amount.
 *
 * Primary rule: Iglewicz–Hoaglin robust z-score against the median, using
 * MAD (not standard deviation) so a few previous outliers do not hide a new
 * one. When MAD is 0 — the user has a perfectly uniform history, e.g. the same
 * top-up every time — the z-score is undefined, so the fallback is a pure ratio
 * rule (at least 3× the median). No alert is produced under either rule without
 * enough history.
 */
export const LARGE_TRANSACTION_RULES = {
  /** Fewer prior expenses than this means we cannot call anything unusual. */
  minHistoryCount: 8,
  robustZThreshold: 3.5,
  highSeverityZ: 5,
  madZeroRatioThreshold: 3,
  highSeverityRatio: 5,
  /** History window the scan service queries. Documented in the facts. */
  lookbackDays: 180,
} as const;

export interface LargeTransactionFacts {
  method: 'robust_z' | 'mad_zero_ratio';
  amount: string;
  currency: string;
  median: string;
  mad: string;
  robustZ: string | null;
  /**
   * True when `robustZ` did not fit the DECIMAL(10, 4) `score` column and the
   * persisted score was clamped to 999999.9999. The z-score itself is never
   * altered: it is kept here in full and used by the explanation.
   */
  scoreClamped: boolean;
  ratio: string;
  historyCount: number;
  historyDays: number;
  lookbackDays: number;
  thresholds: {
    minHistoryCount: number;
    robustZ: number;
    madZeroRatio: number;
  };
}

export interface LargeTransactionInput {
  candidate: TransactionSample;
  /** Prior transactions of the same user. Rows that do not qualify are ignored. */
  history: readonly TransactionSample[];
}

/**
 * Rebuilds the Vietnamese explanation from the stored facts only, so the API
 * can show the same text months later without persisting a duplicate string.
 */
export function explainLargeTransaction(facts: LargeTransactionFacts): string {
  const amount = new Prisma.Decimal(facts.amount);
  const medianValue = new Prisma.Decimal(facts.median);
  if (facts.method === 'robust_z' && facts.robustZ !== null) {
    return (
      `Khoản chi ${formatAmount(amount, facts.currency)} cao hơn hẳn mức chi thường lệ của bạn ` +
      `(trung vị ${formatAmount(medianValue, facts.currency)} trong ${facts.historyDays} ngày, ` +
      `${facts.historyCount} giao dịch). Độ lệch vững ${Number(facts.robustZ).toFixed(1)} lần ` +
      `(ngưỡng ${facts.thresholds.robustZ}).`
    );
  }
  return (
    `Khoản chi ${formatAmount(amount, facts.currency)} cao gấp ${Number(facts.ratio).toFixed(1)} lần mức chi ` +
    `thường lệ (${formatAmount(medianValue, facts.currency)}, ${facts.historyCount} giao dịch trước đó). ` +
    `Lịch sử của bạn quá đồng nhất để tính độ lệch, nên hệ thống dùng ngưỡng tỷ lệ ` +
    `${facts.thresholds.madZeroRatio} lần.`
  );
}

export function detectLargeTransaction(
  input: LargeTransactionInput,
): DetectorResult<LargeTransactionFacts> | null {
  const { candidate } = input;
  if (candidate.type !== 'EXPENSE') return null;

  const history = input.history.filter(
    (transaction) =>
      transaction.id !== candidate.id &&
      transaction.type === 'EXPENSE' &&
      transaction.currency === candidate.currency &&
      transaction.occurredAt.getTime() < candidate.occurredAt.getTime(),
  );
  if (history.length < LARGE_TRANSACTION_RULES.minHistoryCount) return null;

  const amount = new Prisma.Decimal(candidate.amount);
  const stats = robustStats(history.map((transaction) => new Prisma.Decimal(transaction.amount)));
  // A zero median cannot happen through the API (amounts must be > 0) but the
  // detector is defensive: with no central tendency there is nothing to compare.
  if (stats.median.lessThanOrEqualTo(0)) return null;

  const ratio = amount.dividedBy(stats.median);
  const z = robustZ(amount, stats);
  // The stored score is clamped to the DB column's range; `facts.robustZ`
  // keeps the exact value, and `facts.scoreClamped` records the difference.
  const storedScore = z ? toStoredScore(z) : null;
  const historyDays = new Set(
    history.map((transaction) => transaction.occurredAt.toISOString().slice(0, 10)),
  ).size;

  const facts: LargeTransactionFacts = {
    method: z ? 'robust_z' : 'mad_zero_ratio',
    amount: decimalString(amount),
    currency: candidate.currency,
    median: decimalString(stats.median),
    mad: decimalString(stats.mad),
    robustZ: z ? z.toFixed(4) : null,
    scoreClamped: storedScore?.clamped ?? false,
    ratio: ratio.toFixed(4),
    historyCount: history.length,
    historyDays,
    lookbackDays: LARGE_TRANSACTION_RULES.lookbackDays,
    thresholds: {
      minHistoryCount: LARGE_TRANSACTION_RULES.minHistoryCount,
      robustZ: LARGE_TRANSACTION_RULES.robustZThreshold,
      madZeroRatio: LARGE_TRANSACTION_RULES.madZeroRatioThreshold,
    },
  };

  if (z) {
    if (z.lessThan(LARGE_TRANSACTION_RULES.robustZThreshold)) return null;
    const severity = z.greaterThanOrEqualTo(LARGE_TRANSACTION_RULES.highSeverityZ)
      ? 'HIGH'
      : 'MEDIUM';
    return {
      type: 'LARGE_TRANSACTION',
      severity,
      dedupeKey: `LARGE:${candidate.id}`,
      transactionId: candidate.id,
      relatedTransactionId: null,
      categoryId: candidate.categoryId,
      periodStart: null,
      periodEnd: null,
      score: storedScore!.score,
      facts,
      explanation: explainLargeTransaction(facts),
    };
  }

  // MAD = 0: every historical amount is identical. The z-score would divide by
  // zero, so fall back to a ratio that is easy to explain and audit.
  if (
    amount.lessThanOrEqualTo(stats.median) ||
    ratio.lessThan(LARGE_TRANSACTION_RULES.madZeroRatioThreshold)
  ) {
    return null;
  }
  const severity = ratio.greaterThanOrEqualTo(LARGE_TRANSACTION_RULES.highSeverityRatio)
    ? 'HIGH'
    : 'MEDIUM';
  return {
    type: 'LARGE_TRANSACTION',
    severity,
    dedupeKey: `LARGE:${candidate.id}`,
    transactionId: candidate.id,
    relatedTransactionId: null,
    categoryId: candidate.categoryId,
    periodStart: null,
    periodEnd: null,
    score: null,
    facts,
    explanation: explainLargeTransaction(facts),
  };
}
