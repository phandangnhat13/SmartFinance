import { importFingerprint, normalizeText } from '../../common/utils/hash';
import { safeCsvCell } from './csv.util';

describe('CSV export safety', () => {
  it('escapes cells that spreadsheets would execute as formulas', () => {
    expect(safeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(safeCsvCell('+841234')).toBe("'+841234");
    expect(safeCsvCell('-1+2')).toBe("'-1+2");
    expect(safeCsvCell('@import')).toBe("'@import");
    expect(safeCsvCell('\tTAB')).toBe("'\tTAB");
  });

  it('leaves normal values untouched', () => {
    expect(safeCsvCell('Highlands Coffee')).toBe('Highlands Coffee');
    expect(safeCsvCell(65000)).toBe('65000');
    expect(safeCsvCell(null)).toBe('');
    expect(safeCsvCell(undefined)).toBe('');
  });
});

describe('import fingerprint', () => {
  const base = {
    userId: 'user-1',
    accountId: 'account-1',
    type: 'EXPENSE',
    amount: '65000.00',
    occurredAtIso: '2026-10-24T17:00:00.000Z',
    description: 'Highlands Coffee',
  };

  it('is stable and ignores description casing/extra whitespace', () => {
    const first = importFingerprint(base);
    const second = importFingerprint({
      ...base,
      description: '  highlands   COFFEE ',
    });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('changes when any business field changes', () => {
    const first = importFingerprint(base);
    expect(importFingerprint({ ...base, amount: '66000.00' })).not.toBe(first);
    expect(importFingerprint({ ...base, accountId: 'account-2' })).not.toBe(first);
    expect(importFingerprint({ ...base, userId: 'user-2' })).not.toBe(first);
    expect(importFingerprint({ ...base, description: 'Other' })).not.toBe(first);
  });

  it('normalizes Unicode and spacing', () => {
    expect(normalizeText('  Grab   Đi Làm ')).toBe('grab đi làm');
  });
});
