import { Prisma } from '@prisma/client';

export const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

export function toDecimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Serialize money for API responses without losing precision. */
export function moneyString(value: Prisma.Decimal | string | number): string {
  return toDecimal(value).toFixed(2);
}

export function isPositiveMoney(value: string): boolean {
  if (!MONEY_REGEX.test(value)) return false;
  return new Prisma.Decimal(value).greaterThan(0);
}

export function isNonNegativeMoney(value: string): boolean {
  if (!MONEY_REGEX.test(value)) return false;
  return new Prisma.Decimal(value).greaterThanOrEqualTo(0);
}

export function sumDecimals(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, value) => acc.plus(value), new Prisma.Decimal(0));
}

export function percentage(part: Prisma.Decimal, whole: Prisma.Decimal): number {
  if (whole.lessThanOrEqualTo(0)) return 0;
  return Number(part.dividedBy(whole).times(100).toFixed(2));
}
