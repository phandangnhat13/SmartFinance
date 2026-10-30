import { Prisma } from '@prisma/client';
import { ALERT_SCORE_MAX_VALUE, toStoredScore } from './alert-score';

describe('toStoredScore', () => {
  it('keeps an in-range z-score and reports that it was not clamped', () => {
    expect(toStoredScore(new Prisma.Decimal('32.5'))).toEqual({
      score: '32.5000',
      clamped: false,
    });
  });

  it('keeps the exact column maximum without clamping it', () => {
    expect(toStoredScore(new Prisma.Decimal(ALERT_SCORE_MAX_VALUE))).toEqual({
      score: ALERT_SCORE_MAX_VALUE,
      clamped: false,
    });
  });

  it('clamps a z-score above the column range and reports it', () => {
    expect(toStoredScore(new Prisma.Decimal('1214082.72'))).toEqual({
      score: ALERT_SCORE_MAX_VALUE,
      clamped: true,
    });
  });

  it('clamps a value that only rounds above the column range', () => {
    // 999999.99996 rounds to 1000000.0000: in range as a number, out of range
    // as a DECIMAL(10, 4) value.
    expect(toStoredScore(new Prisma.Decimal('999999.99996'))).toEqual({
      score: ALERT_SCORE_MAX_VALUE,
      clamped: true,
    });
  });

  it('clamps negative scores by magnitude as well', () => {
    expect(toStoredScore(new Prisma.Decimal('-1214082.72'))).toEqual({
      score: '-999999.9999',
      clamped: true,
    });
  });
});
