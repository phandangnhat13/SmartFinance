import { previousRange, resolveDateRange, resolveMonthPeriod, toMonthLabel } from './period';

describe('period utilities', () => {
  it('converts a local calendar month to UTC instants', () => {
    const range = resolveDateRange('2026-10-01', '2026-10-31', 'Asia/Ho_Chi_Minh');
    expect(range.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('keeps UTC dates aligned for the UTC timezone', () => {
    const range = resolveDateRange('2026-10-01', '2026-10-31', 'UTC');
    expect(range.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('derives the previous equivalent period (same number of days)', () => {
    const october = resolveDateRange('2026-10-01', '2026-10-31', 'Asia/Ho_Chi_Minh');
    const previous = previousRange(october, 'Asia/Ho_Chi_Minh');
    // 31 days ending the day before 2026-10-01.
    expect(previous.from).toBe('2026-08-31');
    expect(previous.to).toBe('2026-09-30');
    expect(previous.start.toISOString()).toBe('2026-08-30T17:00:00.000Z');
    expect(previous.endExclusive.toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });

  it('builds month periods for budgets', () => {
    const period = resolveMonthPeriod('2026-10', 'Asia/Ho_Chi_Minh');
    expect(period.periodStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(period.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(period.endExclusive.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('labels a UTC instant with the user timezone', () => {
    const instant = new Date('2026-10-31T18:30:00.000Z');
    expect(toMonthLabel(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-11');
    expect(toMonthLabel(instant, 'UTC')).toBe('2026-10');
  });

  it('rejects impossible dates, inverted ranges and oversized ranges', () => {
    expect(() => resolveDateRange('2026-02-30', '2026-03-01', 'UTC')).toThrow(
      'from không phải ngày hợp lệ',
    );
    expect(() => resolveDateRange('2026-10-10', '2026-10-01', 'UTC')).toThrow(
      'Ngày bắt đầu không được sau ngày kết thúc',
    );
    expect(() => resolveDateRange('2024-01-01', '2026-01-02', 'UTC')).toThrow(
      'Khoảng thời gian tối đa',
    );
    expect(() => resolveMonthPeriod('2026-13', 'UTC')).toThrow('Tháng phải có định dạng YYYY-MM');
  });
});
