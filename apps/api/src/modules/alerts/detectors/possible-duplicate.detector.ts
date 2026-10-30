import { Prisma } from '@prisma/client';
import type { DetectorResult, TransactionSample } from './anomaly.types';
import {
  decimalString,
  descriptionsLookSimilar,
  formatAmount,
  minutesBetween,
} from './anomaly.types';

/**
 * Two transactions that look like the same event entered twice.
 *
 * The identity of a possible duplicate is the *pair*, so the dedupe key sorts
 * the two ids: whichever order a scan visits them in, the key is the same.
 *
 * Matching rules (all must hold): same owner (enforced by the query), account,
 * type, amount exactly, currency, and |Δt| ≤ 24 h. Description similarity is a
 * supporting signal only — it raises nothing on its own and, when absent, does
 * not suppress an alert.
 *
 * Recurring payments are outside the 24-hour window by construction (monthly or
 * weekly intervals are far longer), and internal transfers are skipped because
 * their two legs are intentionally identical. Nothing is ever deleted or merged:
 * this is a prompt for the user to check.
 */
export const DUPLICATE_RULES = {
  windowMinutes: 24 * 60,
  /** Upper bound on alerts returned per scan, to keep a bad import from flooding. */
  maxPairs: 20,
} as const;

export interface PossibleDuplicateFacts {
  rule: 'same_account_amount_type_currency_within_window';
  amount: string;
  currency: string;
  accountId: string;
  minutesApart: number;
  descriptionSimilar: boolean;
  windowMinutes: number;
  occurredAt: string;
  relatedOccurredAt: string;
  note: string;
}

/** Rebuilds the explanation from the stored facts only. */
export function explainPossibleDuplicate(facts: PossibleDuplicateFacts): string {
  const amount = new Prisma.Decimal(facts.amount);
  return (
    `Hai giao dịch cùng tài khoản, cùng số tiền ${formatAmount(amount, facts.currency)}, ` +
    `cách nhau ${facts.minutesApart} phút` +
    (facts.descriptionSimilar ? ' và có mô tả tương tự' : '') +
    '. Đây chỉ là gợi ý để bạn kiểm tra lại, không phải kết luận trùng lặp hay gian lận; ' +
    'hệ thống không tự xoá hoặc gộp giao dịch.'
  );
}

export function detectPossibleDuplicates(
  transactions: readonly TransactionSample[],
): Array<DetectorResult<PossibleDuplicateFacts>> {
  const eligible = transactions
    .filter((transaction) => transaction.type !== 'TRANSFER')
    .slice()
    .sort((a, b) =>
      a.occurredAt.getTime() === b.occurredAt.getTime()
        ? a.id.localeCompare(b.id)
        : a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

  const results: Array<DetectorResult<PossibleDuplicateFacts>> = [];
  const seen = new Set<string>();

  for (let i = 0; i < eligible.length; i += 1) {
    const earlier = eligible[i];
    if (results.length >= DUPLICATE_RULES.maxPairs) break;
    for (let j = i + 1; j < eligible.length; j += 1) {
      const later = eligible[j];
      const gap = minutesBetween(earlier.occurredAt, later.occurredAt);
      if (gap > DUPLICATE_RULES.windowMinutes) break;

      if (
        earlier.accountId !== later.accountId ||
        earlier.type !== later.type ||
        earlier.currency !== later.currency
      ) {
        continue;
      }
      if (!new Prisma.Decimal(earlier.amount).equals(new Prisma.Decimal(later.amount))) continue;

      const pairKey = `DUP:${[earlier.id, later.id].sort().join(':')}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const similar = descriptionsLookSimilar(earlier.description, later.description);
      const amount = new Prisma.Decimal(later.amount);
      const facts: PossibleDuplicateFacts = {
        rule: 'same_account_amount_type_currency_within_window',
        amount: decimalString(amount),
        currency: later.currency,
        accountId: later.accountId,
        minutesApart: gap,
        descriptionSimilar: similar,
        windowMinutes: DUPLICATE_RULES.windowMinutes,
        occurredAt: later.occurredAt.toISOString(),
        relatedOccurredAt: earlier.occurredAt.toISOString(),
        note: 'Gợi ý kiểm tra, không phải kết luận trùng lặp.',
      };

      results.push({
        type: 'POSSIBLE_DUPLICATE',
        severity: 'LOW',
        dedupeKey: pairKey,
        transactionId: later.id,
        relatedTransactionId: earlier.id,
        categoryId: later.categoryId,
        periodStart: null,
        periodEnd: null,
        score: null,
        facts,
        explanation: explainPossibleDuplicate(facts),
      });
      if (results.length >= DUPLICATE_RULES.maxPairs) break;
    }
  }

  return results;
}
