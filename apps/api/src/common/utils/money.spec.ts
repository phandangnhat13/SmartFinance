import { Prisma } from '@prisma/client';
import {
  changePercent,
  isNonNegativeMoney,
  isPositiveMoney,
  moneyString,
  percentage,
  sumDecimals,
  toDecimal,
} from './money';

describe('money utilities', () => {
  it('accepts positive amounts with up to two decimals', () => {
    expect(isPositiveMoney('1')).toBe(true);
    expect(isPositiveMoney('65000')).toBe(true);
    expect(isPositiveMoney('0.01')).toBe(true);
    expect(isPositiveMoney('1234567890.99')).toBe(true);
  });

  it('rejects zero, negatives, exponents and malformed values', () => {
    expect(isPositiveMoney('0')).toBe(false);
    expect(isPositiveMoney('-1')).toBe(false);
    expect(isPositiveMoney('1e5')).toBe(false);
    expect(isPositiveMoney('1.234')).toBe(false);
    expect(isPositiveMoney('')).toBe(false);
    expect(isPositiveMoney('01')).toBe(false);
  });

  it('allows zero only for non-negative balances', () => {
    expect(isNonNegativeMoney('0')).toBe(true);
    expect(isNonNegativeMoney('0.00')).toBe(true);
    expect(isNonNegativeMoney('-0.01')).toBe(false);
  });

  it('serializes decimals without losing cents', () => {
    expect(moneyString(new Prisma.Decimal('1000000'))).toBe('1000000.00');
    expect(moneyString('0.1')).toBe('0.10');
    expect(moneyString(12.345)).toBe('12.35');
  });

  it('computes percentages defensively', () => {
    expect(percentage(toDecimal('25'), toDecimal('200'))).toBe(12.5);
    expect(percentage(toDecimal('1'), toDecimal('0'))).toBe(0);
    expect(percentage(toDecimal('100'), toDecimal('3'))).toBe(3333.33);
  });

  it('sums decimals exactly', () => {
    expect(sumDecimals([toDecimal('0.1'), toDecimal('0.2')]).toFixed(2)).toBe('0.30');
  });

  it('computes change against a previous value without inventing a baseline', () => {
    expect(changePercent('150', '100')).toBe(50);
    expect(changePercent('50', '100')).toBe(-50);
    expect(changePercent('-20', '100')).toBe(-120);
    expect(changePercent('100', '0')).toBeNull();
    expect(changePercent(toDecimal('100'), toDecimal('3'))).toBe(3233.33);
  });
});
