import {
  extractAmounts,
  extractDate,
  interpretScenario,
  matchGoal,
  normalizeText,
} from './savings-intent';

const GOALS = [
  { id: 'g1', name: 'Du lịch', status: 'ACTIVE' },
  { id: 'g2', name: 'Mua laptop', status: 'ACTIVE' },
];
const TODAY = '2026-10-30';

describe('savings-intent', () => {
  describe('normalizeText', () => {
    it('strips Vietnamese diacritics and lower-cases', () => {
      expect(normalizeText('  Góp 3 TRIỆU  ')).toBe('gop 3 trieu');
      expect(normalizeText('Đổi mục tiêu')).toBe('doi muc tieu');
    });
  });

  describe('extractAmounts', () => {
    it('reads triệu and nghìn scales', () => {
      expect(extractAmounts('góp 3 triệu mỗi tháng')).toEqual([3_000_000]);
      expect(extractAmounts('để dành 500 nghìn')).toEqual([500_000]);
      expect(extractAmounts('góp 1,5 triệu')).toEqual([1_500_000]);
    });

    it('reads currency amounts with separators and bare large numbers', () => {
      expect(extractAmounts('góp 2.000.000đ mỗi tháng')).toEqual([2_000_000]);
      expect(extractAmounts('mục tiêu 15.000.000 VND')).toEqual([15_000_000]);
      expect(extractAmounts('góp 2000000')).toEqual([2_000_000]);
    });

    it('returns nothing when there is no amount', () => {
      expect(extractAmounts('tại sao mục tiêu này chậm?')).toEqual([]);
    });
  });

  describe('extractDate', () => {
    it('parses ISO and Vietnamese day-first dates in the future', () => {
      expect(extractDate('dời sang 2027-06-30', TODAY)).toBe('2027-06-30');
      expect(extractDate('dời sang 30/06/2027', TODAY)).toBe('2027-06-30');
    });

    it('rejects invalid or past dates instead of guessing', () => {
      expect(extractDate('dời sang 31/02/2027', TODAY)).toBeNull();
      expect(extractDate('dời sang 01/01/2025', TODAY)).toBeNull();
    });
  });

  describe('matchGoal', () => {
    it('matches the longest goal name and falls back to the only active goal', () => {
      expect(matchGoal('góp cho mục tiêu Mua laptop', GOALS).goal?.id).toBe('g2');
      expect(
        matchGoal('góp thêm', [{ id: 'only', name: 'Quỹ khẩn cấp', status: 'ACTIVE' }]).goal?.id,
      ).toBe('only');
      expect(matchGoal('góp thêm', GOALS).goal).toBeNull();
    });
  });

  describe('interpretScenario', () => {
    it('understands a monthly amount for a named goal', () => {
      const result = interpretScenario(
        'Nếu tôi góp 3 triệu mỗi tháng cho mục tiêu Du lịch thì sao?',
        GOALS,
        TODAY,
      );
      expect(result.scenario).toBe('MONTHLY_AMOUNT');
      expect(result.monthlyAmount).toBe('3000000');
      expect(result.goalId).toBe('g1');
      expect(result.confidence).toBe('high');
      expect(result.clarification).toBeNull();
    });

    it('understands a new deadline', () => {
      const result = interpretScenario('Dời hạn mục tiêu Du lịch sang 30/06/2027', GOALS, TODAY);
      expect(result.scenario).toBe('DEADLINE');
      expect(result.targetDate).toBe('2027-06-30');
      expect(result.goalId).toBe('g1');
    });

    it('understands a new target amount', () => {
      const result = interpretScenario('Đổi mục tiêu Mua laptop thành 15.000.000', GOALS, TODAY);
      expect(result.scenario).toBe('TARGET_AMOUNT');
      expect(result.targetAmount).toBe('15000000');
      expect(result.goalId).toBe('g2');
    });

    it('understands a multi-goal budget', () => {
      const result = interpretScenario(
        'Nếu mỗi tháng tôi có 5 triệu để phân bổ cho tất cả mục tiêu',
        GOALS,
        TODAY,
      );
      expect(result.scenario).toBe('MULTI_GOAL_BUDGET');
      expect(result.budget).toBe('5000000');
    });

    it('asks which goal when the goal is ambiguous', () => {
      const result = interpretScenario('Nếu góp 2.000.000 mỗi tháng thì sao?', GOALS, TODAY);
      expect(result.scenario).toBeNull();
      expect(result.clarification).toContain('mục tiêu nào');
      expect(result.looksLikeScenario).toBe(true);
    });

    it('asks for a date when the deadline is missing', () => {
      const result = interpretScenario('Dời hạn mục tiêu Du lịch', GOALS, TODAY);
      expect(result.scenario).toBeNull();
      expect(result.clarification).toContain('ngày');
    });

    it('asks for a concrete amount when none is present', () => {
      const result = interpretScenario('Nếu tôi tiết kiệm thêm thì sao?', GOALS, TODAY);
      expect(result.scenario).toBeNull();
      expect(result.clarification).toContain('số tiền');
    });

    it('treats a plain question as data, not a scenario', () => {
      const result = interpretScenario('Mục tiêu nào nên ưu tiên?', GOALS, TODAY);
      expect(result.scenario).toBeNull();
      expect(result.looksLikeScenario).toBe(false);
    });
  });
});
