import { Prisma } from '@prisma/client';

/**
 * `spending_alerts.score` is `DECIMAL(10, 4)`: PostgreSQL can only store
 * magnitudes below 10^6. A robust z-score has no such upper bound — a
 * near-uniform history (MAD close to zero) can produce z in the millions —
 * so writing it unclamped fails the INSERT with SQLSTATE 22003 and the whole
 * scan returns 500.
 *
 * The column therefore stores the z-score clamped to the column's range. The
 * exact value is always kept in `facts.robustZ`, and `facts.scoreClamped` says
 * whether the stored score is the exact one, so the truncation is never
 * silent. Detection itself is unchanged: thresholds and severity are still
 * computed from the exact z before clamping.
 */
export const ALERT_SCORE_MAX_VALUE = '999999.9999';
export const ALERT_SCORE_MAX = new Prisma.Decimal(ALERT_SCORE_MAX_VALUE);

export interface StoredScore {
  /** Value safe to write to a DECIMAL(10, 4) column. */
  score: string;
  /** True when the exact z-score did not fit and the stored value is capped. */
  clamped: boolean;
}

export function toStoredScore(z: Prisma.Decimal): StoredScore {
  // Round first: 999999.99996 rounds to 1000000.0000, which would overflow
  // even though the raw value is technically below 10^6.
  const rounded = new Prisma.Decimal(z.toFixed(4));
  if (rounded.abs().greaterThan(ALERT_SCORE_MAX)) {
    const limit = rounded.isNegative() ? ALERT_SCORE_MAX.times(-1) : ALERT_SCORE_MAX;
    return { score: limit.toFixed(4), clamped: true };
  }
  return { score: rounded.toFixed(4), clamped: false };
}
