import { DateTime } from 'luxon';
import { buildScanWindows } from './scan-windows';

const OPTIONS = { lookbackDays: 180, candidateDays: 30, referenceMonths: 3 };

const iso = (date: Date) => date.toISOString();

describe('buildScanWindows — month boundaries in the user timezone', () => {
  it('places the first minutes of a local month in that month, not in UTC', () => {
    // 00:30 on 1 November in Ho Chi Minh City is 17:30 UTC on 31 October.
    const now = DateTime.fromISO('2026-11-01T00:30:00', { zone: 'Asia/Ho_Chi_Minh' });
    const windows = buildScanWindows(now, OPTIONS);

    expect(windows.current.month).toBe('2026-11');
    expect(iso(windows.current.start)).toBe('2026-10-31T17:00:00.000Z');
    expect(iso(windows.current.endExclusive)).toBe('2026-10-31T17:30:00.000Z');
    expect(iso(windows.current.periodStart)).toBe('2026-11-01T00:00:00.000Z');
    expect(iso(windows.current.periodEnd)).toBe('2026-11-01T00:00:00.000Z');
    expect(windows.current.days).toBe(1);

    const [october, september, august] = windows.references;
    expect(windows.references.map((reference) => reference.month)).toEqual([
      '2026-10',
      '2026-09',
      '2026-08',
    ]);
    expect(iso(october.start)).toBe('2026-09-30T17:00:00.000Z');
    expect(iso(october.endExclusive)).toBe('2026-10-01T17:00:00.000Z');
    expect(october.days).toBe(1);
    expect(iso(october.periodEnd)).toBe('2026-10-01T00:00:00.000Z');
    expect(september.month).toBe('2026-09');
    expect(august.month).toBe('2026-08');
  });

  it('compares a 31-day month against February over February’s own days', () => {
    const now = DateTime.fromISO('2026-03-31T12:00:00', { zone: 'Asia/Ho_Chi_Minh' });
    const windows = buildScanWindows(now, OPTIONS);

    expect(windows.current.days).toBe(31);
    const [february, january] = windows.references;
    expect(february.month).toBe('2026-02');
    expect(february.days).toBe(28);
    expect(iso(february.start)).toBe('2026-01-31T17:00:00.000Z');
    expect(iso(february.endExclusive)).toBe('2026-02-28T17:00:00.000Z');
    expect(iso(february.periodEnd)).toBe('2026-02-28T00:00:00.000Z');
    expect(january.days).toBe(31);
  });

  it('uses the local calendar day even when UTC is already on another day', () => {
    // 23:30 on 30 October in Pago Pago is 10:30 UTC on 31 October.
    const now = DateTime.fromISO('2026-10-30T23:30:00', { zone: 'Pacific/Pago_Pago' });
    expect(now.toUTC().day).toBe(31);
    const windows = buildScanWindows(now, OPTIONS);

    expect(windows.current.month).toBe('2026-10');
    expect(windows.current.days).toBe(30);
    expect(iso(windows.current.periodEnd)).toBe('2026-10-30T00:00:00.000Z');
    expect(windows.current.endExclusive.toISOString()).toBe(now.toUTC().toISO());
  });

  it('keeps the correct UTC offset across a DST change', () => {
    // US DST ends on 1 November 2026; the month starts in EDT (-04).
    const now = DateTime.fromISO('2026-11-02T09:00:00', { zone: 'America/New_York' });
    const windows = buildScanWindows(now, OPTIONS);

    expect(iso(windows.current.start)).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(windows.current.endExclusive)).toBe('2026-11-02T14:00:00.000Z');
    expect(windows.current.days).toBe(2);
    expect(iso(windows.references[0].start)).toBe('2026-10-01T04:00:00.000Z');
  });
});

describe('buildScanWindows — query bounds', () => {
  it('derives history and candidate starts from the zoned "now"', () => {
    const now = DateTime.fromISO('2026-10-30T12:00:00', { zone: 'Asia/Ho_Chi_Minh' });
    const windows = buildScanWindows(now, OPTIONS);

    expect(iso(windows.nowExclusive)).toBe('2026-10-30T05:00:00.000Z');
    expect(iso(windows.historyStart)).toBe('2026-05-03T05:00:00.000Z');
    expect(iso(windows.candidateStart)).toBe('2026-09-30T05:00:00.000Z');
    expect(windows.candidateStart.getTime()).toBeGreaterThan(windows.historyStart.getTime());
  });

  it('returns exactly the requested number of reference months', () => {
    const now = DateTime.fromISO('2026-10-30T12:00:00', { zone: 'UTC' });
    expect(buildScanWindows(now, { ...OPTIONS, referenceMonths: 1 }).references).toHaveLength(1);
    expect(buildScanWindows(now, { ...OPTIONS, referenceMonths: 5 }).references).toHaveLength(5);
  });

  it('rejects an invalid DateTime instead of producing nonsense windows', () => {
    expect(() => buildScanWindows(DateTime.invalid('bad'), OPTIONS)).toThrow('Invalid scan time');
  });
});
