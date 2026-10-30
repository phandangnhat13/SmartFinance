import {
  analyticsEvidenceCatalog,
  analyticsEvidenceList,
  buildAnalyticsAiContext,
  buildAnalyticsAiFacts,
  collectAnalyticsNumbers,
  findAnalyticsInventedNumbers,
} from './analytics-context';
import {
  budgetsDto,
  categoriesDto,
  forecastDto,
  healthDto,
  overviewDto,
  savingsDto,
  trendsDto,
} from './analytics-analyst.fixtures';

const OVERVIEW = overviewDto();

function fullContext() {
  return buildAnalyticsAiContext({
    overview: OVERVIEW,
    trends: trendsDto(),
    categories: categoriesDto(),
    budgets: budgetsDto(),
    forecast: forecastDto(),
    health: healthDto(),
    savings: savingsDto(),
  });
}

describe('buildAnalyticsAiContext', () => {
  it('copies the figures the analytics services computed, without recalculating', () => {
    const context = fullContext();

    expect(context.currency).toBe('VND');
    expect(context.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(context.overview).toMatchObject({
      income: '20000000.00',
      expense: '16000000.00',
      net: '4000000.00',
      savingsRate: 20,
      transactionCount: 37,
    });
    expect(context.trends?.rangeMonths).toBe(3);
    expect(context.categories[0]).toMatchObject({ name: 'Ăn uống', total: '8000000.00' });
    expect(context.budgets).toMatchObject({ count: 3, exceeded: 1, warning: 1, onTrack: 1 });
    expect(context.forecast).toMatchObject({ status: 'ok', netBase: '1000000.00' });
    expect(context.health).toMatchObject({ status: 'scored', score: 71, classification: 'GOOD' });
    expect(context.savings).toMatchObject({
      suggestedMonthlySaving: '2000000.00',
      allocatedMonthly: '1800000.00',
      activeGoalCount: 1,
    });
  });

  it('keeps only the top five positive expense categories and sorts budgets by spend', () => {
    const many = categoriesDto({
      categories: [
        ...categoriesDto().categories,
        ...Array.from({ length: 4 }, (_, index) => ({
          ...categoriesDto().categories[0],
          categoryName: `Danh mục ${index + 4}`,
          total: '100000.00',
          rank: index + 4,
        })),
        { ...categoriesDto().categories[0], categoryName: 'Hoàn tiền', total: '0.00', rank: null },
      ],
    });
    const context = buildAnalyticsAiContext({
      overview: OVERVIEW,
      categories: many,
      budgets: budgetsDto(),
    });

    expect(context.categories).toHaveLength(5);
    expect(context.categories.map((row) => row.name)).not.toContain('Hoàn tiền');
    expect(context.budgets?.items.map((item) => item.name)).toEqual([
      'Ăn uống',
      'Mua sắm',
      'Di chuyển',
    ]);
  });

  it('marks sections the request did not need as null instead of zero', () => {
    const context = buildAnalyticsAiContext({ overview: OVERVIEW });

    expect(context.trends).toBeNull();
    expect(context.budgets).toBeNull();
    expect(context.forecast).toBeNull();
    expect(context.health).toBeNull();
    expect(context.savings).toBeNull();
    expect(context.categories).toEqual([]);
  });

  it('never includes an email, user id, token, account number or transaction description', () => {
    const serialized = JSON.stringify(fullContext());

    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/user-1|userId/i);
    expect(serialized).not.toMatch(/token|authorization|password/i);
    expect(serialized).not.toMatch(/description|ghi chú|note/i);
  });

  it('deduplicates limitations coming from several services', () => {
    const context = buildAnalyticsAiContext({
      overview: OVERVIEW,
      forecast: forecastDto(),
      health: healthDto({ limitations: [forecastDto().limitations[0]] }),
    });
    const unique = new Set(context.limitations);

    expect(unique.size).toBe(context.limitations.length);
  });

  it('states the missing-data rule and the no-write rule', () => {
    const context = fullContext();

    expect(context.limitations.join(' ')).toContain('không có giao dịch');
    expect(context.rules.join(' ')).toContain('AI không có quyền tạo, sửa hoặc xóa');
  });
});

describe('buildAnalyticsAiFacts', () => {
  it('mirrors the loaded sections and leaves unloaded ones null', () => {
    const facts = buildAnalyticsAiFacts(buildAnalyticsAiContext({ overview: OVERVIEW }));

    expect(facts).toMatchObject({
      income: '20000000.00',
      expense: '16000000.00',
      net: '4000000.00',
      savingsRate: 20,
      monthsAnalyzed: 0,
      budgetCount: null,
      forecastStatus: null,
      healthStatus: null,
      savingsCapacity: null,
    });
    expect(facts.topCategories).toEqual([]);
  });

  it('reports the loaded figures', () => {
    const facts = buildAnalyticsAiFacts(fullContext());

    expect(facts.monthsAnalyzed).toBe(3);
    expect(facts.budgetCount).toBe(3);
    expect(facts.budgetsExceeded).toBe(1);
    expect(facts.forecastStatus).toBe('ok');
    expect(facts.forecastNet).toBe('1000000.00');
    expect(facts.healthScore).toBe(71);
    expect(facts.savingsCapacity).toBe('2.000.000 VND');
    expect(facts.topCategories[0]).toEqual({
      name: 'Ăn uống',
      total: '8000000.00',
      sharePercent: 50,
    });
  });
});

describe('analyticsEvidenceCatalog', () => {
  it('formats every value on the backend', () => {
    const catalog = analyticsEvidenceCatalog(fullContext());

    expect(catalog.overview_income.value).toBe('20.000.000 VND');
    expect(catalog.savings_rate.value).toBe('20%');
    expect(catalog['category:1'].value).toBe('8.000.000 VND (50% tổng chi)');
    expect(catalog.budgets_summary.value).toBe(
      '3 ngân sách: 1 vượt hạn mức, 1 cảnh báo, 1 trong hạn mức',
    );
    expect(catalog.health_overall.value).toContain('71/100');
  });

  it('only exposes keys backed by loaded data', () => {
    const lean = analyticsEvidenceCatalog(buildAnalyticsAiContext({ overview: OVERVIEW }));

    expect(Object.keys(lean).sort()).toEqual(
      [
        'overview_expense',
        'overview_income',
        'overview_net',
        'overview_period',
        'savings_rate',
        'transaction_count',
      ].sort(),
    );
  });

  it('resolves unknown keys to nothing rather than undefined entries', () => {
    const catalog = analyticsEvidenceCatalog(fullContext());

    expect(analyticsEvidenceList(['overview_net', 'not_a_key'], catalog)).toEqual([
      catalog.overview_net,
    ]);
  });
});

describe('numeric whitelist', () => {
  it('accepts every number the context and the catalogue actually contain', () => {
    const context = fullContext();
    const allowed = collectAnalyticsNumbers(context);
    const catalog = Object.values(analyticsEvidenceCatalog(context));

    catalog.forEach((entry) => {
      expect(findAnalyticsInventedNumbers(entry.value, allowed)).toEqual([]);
    });
  });

  it('flags an amount that is not in the data', () => {
    const allowed = collectAnalyticsNumbers(fullContext());

    expect(findAnalyticsInventedNumbers('Bạn nên tiết kiệm 9.999.999 VND.', allowed)).toEqual([
      '9.999.999',
    ]);
  });

  it('accepts the formatted context amounts and their digits', () => {
    const allowed = collectAnalyticsNumbers(fullContext());

    expect(findAnalyticsInventedNumbers('Thu 20.000.000 VND, chi 16000000.', allowed)).toEqual([]);
  });
});
