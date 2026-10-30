import { Prisma } from '@prisma/client';

export interface RobustStats {
  median: Prisma.Decimal;
  /** Median absolute deviation around the median (not scaled). */
  mad: Prisma.Decimal;
  count: number;
}

/** Median of one or more decimal values. Requires a non-empty list. */
export function median(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  if (values.length === 0) throw new Error('median() requires at least one value');
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return sorted[middle - 1].plus(sorted[middle]).dividedBy(2);
}

export function medianAbsoluteDeviation(
  values: readonly Prisma.Decimal[],
  center: Prisma.Decimal,
): Prisma.Decimal {
  return median(values.map((value) => value.minus(center).abs()));
}

export function robustStats(values: readonly Prisma.Decimal[]): RobustStats {
  const center = median(values);
  return { median: center, mad: medianAbsoluteDeviation(values, center), count: values.length };
}

/**
 * Iglewicz–Hoaglin robust z-score: (x − median) / (1.4826 · MAD).
 * Returns null when MAD is 0, because the score would be undefined. Callers
 * must use a documented fallback rule instead of dividing by zero.
 */
export function robustZ(value: Prisma.Decimal, stats: RobustStats): Prisma.Decimal | null {
  if (stats.mad.lessThanOrEqualTo(0)) return null;
  const scale = stats.mad.times('1.4826');
  return value.minus(stats.median).dividedBy(scale);
}
