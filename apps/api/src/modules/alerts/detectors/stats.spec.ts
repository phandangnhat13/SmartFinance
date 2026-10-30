import { Prisma } from '@prisma/client';
import { median, medianAbsoluteDeviation, robustStats, robustZ } from './stats';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('median', () => {
  it('returns the middle value for an odd count', () => {
    expect(median([d(3), d(1), d(2)]).toFixed(2)).toBe('2.00');
  });

  it('averages the two middle values for an even count', () => {
    expect(median([d(1), d(2), d(3), d(10)]).toFixed(2)).toBe('2.50');
  });

  it('does not depend on input order and does not mutate the input', () => {
    const values = [d(5), d(1), d(9), d(3)];
    expect(median(values).toFixed(2)).toBe('4.00');
    expect(values.map((value) => value.toFixed(0))).toEqual(['5', '1', '9', '3']);
  });

  it('handles a single value and decimal values exactly', () => {
    expect(median([d('1234.56')]).toFixed(2)).toBe('1234.56');
    expect(median([d('100000.10'), d('100000.20'), d('100000.30')]).toFixed(2)).toBe('100000.20');
  });

  it('throws on an empty list instead of returning a misleading value', () => {
    expect(() => median([])).toThrow('median() requires at least one value');
  });
});

describe('medianAbsoluteDeviation', () => {
  it('measures spread around a supplied centre', () => {
    const centre = d(10);
    expect(medianAbsoluteDeviation([d(8), d(10), d(14)], centre).toFixed(2)).toBe('2.00');
  });

  it('is zero when every value equals the centre', () => {
    expect(medianAbsoluteDeviation([d(7), d(7), d(7)], d(7)).toFixed(0)).toBe('0');
  });
});

describe('robustStats', () => {
  it('reports median, unscaled MAD and count', () => {
    const stats = robustStats([d(1), d(2), d(3), d(4), d(100)]);
    expect(stats.median.toFixed(0)).toBe('3');
    // Deviations: 2,1,0,1,97 → median 1
    expect(stats.mad.toFixed(0)).toBe('1');
    expect(stats.count).toBe(5);
  });
});

describe('robustZ', () => {
  it('divides by 1.4826 × MAD', () => {
    const stats = robustStats([d(10), d(11), d(12), d(13), d(14)]);
    expect(stats.median.toFixed(0)).toBe('12');
    expect(stats.mad.toFixed(0)).toBe('1');
    const z = robustZ(d(20), stats);
    expect(z).not.toBeNull();
    expect(z!.toFixed(4)).toBe('5.3959');
  });

  it('returns null when MAD is zero rather than dividing by zero', () => {
    const stats = robustStats([d(5), d(5), d(5)]);
    expect(robustZ(d(500), stats)).toBeNull();
  });

  it('returns a negative score for values below the median', () => {
    const stats = robustStats([d(10), d(11), d(12), d(13), d(14)]);
    expect(robustZ(d(1), stats)!.isNegative()).toBe(true);
  });
});
