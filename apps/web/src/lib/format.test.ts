import { describe, expect, it } from 'vitest';
import { formatMoney, formatPercent } from './format';

describe('formatMoney', () => {
  it('formats VND without decimals', () => {
    expect(formatMoney('1000000', 'VND')).toContain('1.000.000');
  });

  it('keeps cents for foreign currencies', () => {
    expect(formatMoney('1234.5', 'USD')).toContain('1.234,50');
  });

  it('returns a dash for invalid input', () => {
    expect(formatMoney('not-a-number', 'VND')).toBe('—');
  });
});

describe('formatPercent', () => {
  it('signs positive changes and handles missing values', () => {
    expect(formatPercent(12.345)).toBe('+12.3%');
    expect(formatPercent(-5)).toBe('-5.0%');
    expect(formatPercent(null)).toBe('—');
  });
});
