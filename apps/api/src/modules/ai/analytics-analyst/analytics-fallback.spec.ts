import {
  fallbackChatReply,
  fallbackExplanation,
  fallbackRecommendations,
  fallbackSummary,
} from './analytics-fallback';
import {
  buildAnalyticsAiContext,
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

const FULL = buildAnalyticsAiContext({
  overview: OVERVIEW,
  trends: trendsDto(),
  categories: categoriesDto(),
  budgets: budgetsDto(),
  forecast: forecastDto(),
  health: healthDto(),
  savings: savingsDto(),
});

function expectNoInventedNumbers(text: string, context: typeof FULL) {
  expect(findAnalyticsInventedNumbers(text, collectAnalyticsNumbers(context))).toEqual([]);
}

describe('fallbackSummary', () => {
  it('is deterministic', () => {
    expect(fallbackSummary(FULL)).toEqual(fallbackSummary(FULL));
  });

  it('states the recorded figures from the context', () => {
    const result = fallbackSummary(FULL);

    expect(result.summary).toContain('20.000.000 VND');
    expect(result.summary).toContain('16.000.000 VND');
    expect(result.summary).toContain('4.000.000 VND');
    expect(result.highlights.length).toBeGreaterThanOrEqual(3);
    expect(result.highlights[0]).toMatchObject({ title: 'Dòng tiền trong kỳ' });
  });

  it('attaches backend evidence to every highlight', () => {
    fallbackSummary(FULL).highlights.forEach((highlight) => {
      expect(highlight.evidence.length).toBeGreaterThan(0);
      highlight.evidence.forEach((item) => {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.value.length).toBeGreaterThan(0);
      });
    });
  });

  it('never writes a number that is not in the context', () => {
    const result = fallbackSummary(FULL);

    expectNoInventedNumbers(result.summary, FULL);
    result.highlights.forEach((highlight) => {
      expectNoInventedNumbers(`${highlight.title} ${highlight.body}`, FULL);
    });
  });

  it('says the score is unavailable instead of showing zero when data is missing', () => {
    const context = buildAnalyticsAiContext({
      overview: OVERVIEW,
      health: healthDto({
        overall: {
          ...healthDto().overall,
          status: 'insufficient_data',
          score: null,
          classification: 'INSUFFICIENT_DATA',
        },
      }),
    });

    const text = fallbackSummary(context)
      .highlights.map((item) => item.body)
      .join(' ');

    expect(text).toContain('Chưa tính được điểm sức khỏe tài chính');
    expect(text).not.toContain('/100');
  });

  it('marks the forecast as an estimate and never invents one when data is insufficient', () => {
    const context = buildAnalyticsAiContext({
      overview: OVERVIEW,
      forecast: forecastDto({
        status: 'insufficient_data',
        income: { ...forecastDto().income, horizonTotal: null },
        expense: { ...forecastDto().expense, horizonTotal: null },
        net: { ...forecastDto().net, base: null },
      }),
    });

    const text = fallbackSummary(context)
      .highlights.map((item) => item.body)
      .join(' ');

    expect(text).toContain('ước tính');
    expect(text).toContain('không phải dự báo bằng 0');
  });
});

describe('fallbackExplanation', () => {
  it('explains every section that was loaded', () => {
    const result = fallbackExplanation(FULL);

    expect(result.sections.map((section) => section.title)).toEqual([
      'Dòng tiền',
      'Danh mục chi tiêu',
      'Ngân sách',
      'Dự báo (ước tính)',
      'Sức khỏe tài chính',
    ]);
    expect(result.referenceKeys.length).toBeGreaterThan(0);
  });

  it('omits sections whose data was not loaded', () => {
    const context = buildAnalyticsAiContext({ overview: OVERVIEW });

    expect(fallbackExplanation(context).sections).toHaveLength(2);
  });

  it('names the weakest health group', () => {
    const text = fallbackExplanation(FULL).sections.at(-1)?.body ?? '';

    expect(text).toContain('71/100');
    expect(text).toContain('Ngân sách');
  });
});

describe('fallbackRecommendations', () => {
  it('ranks suggestions by severity and caps them at four', () => {
    const context = buildAnalyticsAiContext({
      overview: overviewDto({ net: '-2000000.00', savingsRate: -10 }),
      budgets: budgetsDto(),
      forecast: forecastDto({ net: { ...forecastDto().net, base: '-500000.00' } }),
      health: healthDto({
        overall: { ...healthDto().overall, classification: 'NEEDS_ATTENTION', score: 45 },
      }),
      savings: savingsDto(),
    });

    const ids = fallbackRecommendations(context).recommendations.map((item) => item.id);

    expect(ids).toEqual([
      'budget-exceeded',
      'forecast-negative',
      'negative-cash-flow',
      'health-weakest-group',
    ]);
  });

  it('always asks for confirmation and cites evidence', () => {
    fallbackRecommendations(FULL).recommendations.forEach((item) => {
      expect(item.requiresConfirmation).toBe(true);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.expectedImpact.length).toBeGreaterThan(0);
      expect(item.limitations.length).toBeGreaterThan(0);
    });
  });

  it('offers a data-collection suggestion when nothing looks wrong', () => {
    const context = buildAnalyticsAiContext({ overview: overviewDto({ savingsRate: 45 }) });

    const result = fallbackRecommendations(context);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].id).toBe('maintain-habits');
    expect(result.recommendations[0].confidence).toBe('low');
  });

  it('never writes a number that is not in the context', () => {
    fallbackRecommendations(FULL).recommendations.forEach((item) => {
      expectNoInventedNumbers(`${item.title} ${item.detail} ${item.expectedImpact}`, FULL);
    });
  });
});

describe('fallbackChatReply', () => {
  it.each([
    ['SUMMARY', '4.000.000 VND'],
    ['EXPLAIN', 'Giải thích'],
    ['HEALTH', '71/100'],
    ['FORECAST', 'ước tính'],
    ['BUDGET', 'ngân sách'],
    ['CATEGORY', 'Ăn uống'],
    ['SAVINGS', '2.000.000 VND'],
  ] as const)('answers a %s question from the loaded section', (intent, expected) => {
    const reply = fallbackChatReply(FULL, intent);

    expect(reply.reply).toContain(expected);
    expect(reply.referenceKeys.length).toBeGreaterThan(0);
  });

  it('refuses to change data and points at the right screen', () => {
    const reply = fallbackChatReply(FULL, 'UNSUPPORTED');

    expect(reply.reply).toContain('không thể tạo, sửa hay xóa');
    expect(reply.referenceKeys).toEqual([]);
  });

  it('asks a clarifying question when the intent is unclear', () => {
    const reply = fallbackChatReply(FULL, 'UNCLEAR');

    expect(reply.reply).toContain('chưa rõ');
    expect(reply.referenceKeys).toEqual([]);
  });
});
