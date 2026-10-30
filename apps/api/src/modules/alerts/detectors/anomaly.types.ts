import type { Prisma } from '@prisma/client';

export type AlertType = 'LARGE_TRANSACTION' | 'CATEGORY_SPIKE' | 'POSSIBLE_DUPLICATE';
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type TransactionKind = 'INCOME' | 'EXPENSE' | 'TRANSFER';

/**
 * The small, transport-independent shape the detectors work on. Keeping it
 * separate from Prisma rows lets the same code run in unit tests and in the
 * scan service without a database.
 */
export interface TransactionSample {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: TransactionKind;
  /** Decimal string, e.g. "125000.00". */
  amount: string;
  currency: string;
  description: string;
  occurredAt: Date;
}

/**
 * What a detector returns. It is a *candidate*: the scan service decides which
 * candidates are persisted, and the user decides what an alert means.
 */
export interface DetectorResult<TFacts> {
  type: AlertType;
  severity: AlertSeverity;
  /** Stable identity of the event so repeated scans cannot duplicate it. */
  dedupeKey: string;
  transactionId: string | null;
  relatedTransactionId: string | null;
  categoryId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /**
   * Robust z-score as a decimal string. `null` when the fallback ratio rule was
   * used. This is never a probability and must not be shown as one.
   */
  score: string | null;
  /** Snapshot of the numbers behind the explanation; stored as JSON. */
  facts: TFacts;
  /** Vietnamese, template-based, derived only from `facts`. */
  explanation: string;
}

/** Amounts are only ever compared within the same currency. */
export function sameCurrency(a: TransactionSample, b: TransactionSample): boolean {
  return a.currency === b.currency;
}

const VI_NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** Display-only formatting; never used for arithmetic. */
export function formatAmount(value: Prisma.Decimal, currency: string): string {
  return `${VI_NUMBER.format(value.toNumber())} ${currency}`;
}

export function decimalString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function minutesBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60_000);
}

/** Normalized across case, Unicode form and whitespace; accents are preserved. */
export function normalizeDescription(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Description is only a supporting signal for duplicates (same account, type,
 * amount, currency and a time window do the real work). Two descriptions count
 * as similar when they are equal after normalization or one contains the other
 * and is at least three characters long.
 */
export function descriptionsLookSimilar(a: string, b: string): boolean {
  const left = normalizeDescription(a);
  const right = normalizeDescription(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 3 && longer.includes(shorter);
}
