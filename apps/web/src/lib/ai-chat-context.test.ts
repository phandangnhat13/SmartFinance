import { describe, expect, it } from 'vitest';
import {
  describeAiChatContext,
  isAiChatDraftRelated,
  normalizeAiChatContext,
} from './ai-chat-context';

describe('normalizeAiChatContext', () => {
  it('keeps the documented fields and normalizes their values', () => {
    expect(
      normalizeAiChatContext({
        page: 'analytics',
        feature: 'net-cash-flow',
        label: '  Dòng tiền\n ròng  ',
        assistantType: 'ANALYTICS',
        currency: 'vnd',
        dateRange: { from: '2026-10-01', to: '2026-10-31' },
        selectedMetric: 'Dòng tiền ròng',
        selectedInsight: 'summary',
        displayedValue: '1.000.000 ₫',
        comparisonValue: '900.000 ₫',
        evidenceKeys: ['Income_Total', 'income_total', '  net_flow '],
      }),
    ).toEqual({
      page: 'analytics',
      feature: 'net-cash-flow',
      label: 'Dòng tiền ròng',
      assistantType: 'ANALYTICS',
      currency: 'VND',
      dateRange: { from: '2026-10-01', to: '2026-10-31' },
      selectedMetric: 'Dòng tiền ròng',
      selectedInsight: 'summary',
      displayedValue: '1.000.000 ₫',
      comparisonValue: '900.000 ₫',
      evidenceKeys: ['income_total', 'net_flow'],
    });
  });

  it('drops fields outside the contract, including identifiers and nested data', () => {
    expect(
      normalizeAiChatContext({
        page: 'goals',
        currency: 'USD',
        userId: 'u-1',
        conversationId: 'c1',
        transactionIds: ['t1'],
        raw: { nested: true },
      }),
    ).toEqual({ page: 'goals', currency: 'USD' });

    expect(normalizeAiChatContext({ page: 'unknown-page', currency: 'usd$' })).toBeUndefined();
    expect(normalizeAiChatContext({ assistantType: 'OTHER' })).toBeUndefined();
  });

  it('drops invalid and inverted calendar ranges', () => {
    expect(
      normalizeAiChatContext({ dateRange: { from: '2026-02-30', to: '2026-03-01' } }),
    ).toBeUndefined();
    expect(
      normalizeAiChatContext({ dateRange: { from: '2026-10-31', to: '2026-10-01' } }),
    ).toBeUndefined();
    expect(normalizeAiChatContext({ dateRange: '2026-10-01' })).toBeUndefined();
  });

  it('keeps only well-formed evidence keys, deduplicated and capped', () => {
    expect(
      normalizeAiChatContext({
        evidenceKeys: ['<script>', 42, `${'x'.repeat(41)}`, 'ok_key'],
      }),
    ).toEqual({ evidenceKeys: ['ok_key'] });

    const limited = normalizeAiChatContext({
      evidenceKeys: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
    });
    expect(limited?.evidenceKeys).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('returns undefined for non-objects and contexts with nothing left', () => {
    for (const value of [undefined, null, 'dashboard', 7, [], { userId: 'u-1' }]) {
      expect(normalizeAiChatContext(value)).toBeUndefined();
    }
  });
});

describe('describeAiChatContext', () => {
  it('uses the label, then the currency and period', () => {
    expect(
      describeAiChatContext({
        label: 'Chi tiêu tháng này',
        currency: 'VND',
        dateRange: { from: '2026-10-01', to: '2026-10-31' },
      }),
    ).toEqual({
      focus: 'Chi tiêu tháng này',
      detail: 'Đơn vị VND · Kỳ 01/10/2026 – 31/10/2026',
    });
  });

  it('falls back to the metric, the insight and then the page name', () => {
    expect(describeAiChatContext({ selectedMetric: 'Chi tiêu' }).focus).toBe('Chi tiêu');
    expect(describeAiChatContext({ selectedInsight: 'notable-increase' }).focus).toBe(
      'notable-increase',
    );
    expect(describeAiChatContext({ page: 'goals' })).toEqual({
      focus: 'Mục tiêu tiết kiệm',
      detail: '',
    });
    expect(describeAiChatContext({}).focus).toBe('Trang hiện tại');
  });
});

describe('isAiChatDraftRelated', () => {
  const reference = 'Giải thích chi tiêu tháng này. expense';

  it('keeps context while the question shares a topic word', () => {
    expect(isAiChatDraftRelated('Chi tiêu của tôi tháng này tăng vì đâu?', reference)).toBe(true);
  });

  it('drops context when the question moved to another topic', () => {
    expect(isAiChatDraftRelated('Làm sao để tăng thu nhập?', reference)).toBe(false);
  });

  it('does not treat a purely generic question as a topic change', () => {
    expect(isAiChatDraftRelated('Giải thích cho tôi với', reference)).toBe(true);
    expect(isAiChatDraftRelated('', reference)).toBe(true);
  });
});
