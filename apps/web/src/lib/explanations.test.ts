import { describe, expect, it } from 'vitest';
import * as explanations from './explanations';
import type { Explanation } from './explanations';

const all = Object.values(explanations).filter(
  (value): value is Explanation =>
    typeof value === 'object' && value !== null && 'summary' in value && 'aiPrompt' in value,
);

describe('central explanation catalogue', () => {
  it('has every entry ready for both the tooltip and the AI action', () => {
    expect(all.length).toBeGreaterThan(20);
    const ids = new Set<string>();
    for (const entry of all) {
      expect(entry.id).toBeTruthy();
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.title.trim()).not.toBe('');
      expect(entry.summary.trim()).not.toBe('');
      expect(entry.aiPrompt.trim()).not.toBe('');
      expect(['ANALYTICS', 'SAVINGS']).toContain(entry.assistantType);
      // Provenance is kept for maintainers and never shown to users.
      expect(entry.source.trim()).not.toBe('');
    }
  });

  it('uses the verified savings-rate rule', () => {
    expect(explanations.analyticsSavingsRate.formula).toContain(
      '(Thu nhập − Chi tiêu) / Thu nhập × 100',
    );
    expect(explanations.analyticsSavingsRate.formula).toContain('Thu nhập ≤ 0');
  });

  it('uses the verified budget status thresholds', () => {
    expect(explanations.budgetsWarningThresholds.formula).toContain('80% và 100%');
    expect(explanations.budgetsUtilization.formula).toContain('≥ 100%');
  });

  it('uses the verified alert thresholds', () => {
    expect(explanations.alertsSeverity.formula).toContain('z ≥ 5');
    expect(explanations.alertsSeverity.formula).toContain('z ≥ 3,5');
    expect(explanations.alertsSeverity.formula).toContain('1,5 lần');
  });

  it('states that recurring transactions do not exist, matching the backend', () => {
    expect(explanations.transactionsTypes.limitations?.join(' ')).toContain(
      'Không có tính năng giao dịch định kỳ',
    );
    expect(explanations.alertsType.limitations?.join(' ')).toContain(
      'Không có tính năng giao dịch định kỳ',
    );
  });

  it('sends goal-related questions to the savings assistant', () => {
    expect(explanations.goalsProgress.assistantType).toBe('SAVINGS');
    expect(explanations.goalsSimulation.assistantType).toBe('SAVINGS');
    expect(explanations.analyticsForecast.assistantType).toBe('ANALYTICS');
  });
});
