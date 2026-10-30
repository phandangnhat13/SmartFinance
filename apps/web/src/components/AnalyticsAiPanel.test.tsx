import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AiDisclosureDto,
  AnalyticsAiChatReplyDto,
  AnalyticsAiExplanationDto,
  AnalyticsAiFactsDto,
  AnalyticsAiRecommendationsDto,
  AnalyticsAiSummaryDto,
} from '@smart-finance/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsAiPanel } from './AnalyticsAiPanel';

interface RecordedCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

const DISCLOSURE_OFF: AiDisclosureDto = {
  aiEnabled: false,
  provider: null,
  model: null,
  usedModel: false,
  fallbackReason: 'disabled',
  notice: 'AI đang tắt. Nội dung do quy tắc của hệ thống tạo ra từ dữ liệu thực của bạn.',
};

const DISCLOSURE_ON: AiDisclosureDto = {
  aiEnabled: true,
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  usedModel: true,
  fallbackReason: null,
  notice: 'Nội dung do AI (anthropic · claude-opus-5-5) viết; AI chỉ nhận số liệu tổng hợp.',
};

function makeFacts(overrides: Partial<AnalyticsAiFactsDto> = {}): AnalyticsAiFactsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    periodLabel: 'Tháng 10/2026',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    income: '20000000.00',
    expense: '16000000.00',
    net: '4000000.00',
    savingsRate: 20,
    transactionCount: 37,
    hasTransactions: true,
    monthsAnalyzed: 6,
    topCategories: [{ name: 'Ăn uống', total: '8000000.00', sharePercent: 50 }],
    budgetCount: 3,
    budgetsExceeded: 1,
    budgetsWarning: 1,
    forecastStatus: 'ok',
    forecastNet: '1000000.00',
    forecastHorizon: 'current_month',
    healthStatus: 'scored',
    healthScore: 71,
    healthClassification: 'GOOD',
    savingsCapacity: '2000000.00',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<AnalyticsAiSummaryDto> = {}): AnalyticsAiSummaryDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    facts: makeFacts(),
    evidence: [{ label: 'Dòng tiền ròng trong kỳ', value: '4.000.000 ₫' }],
    limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
    canModifyData: false,
    disclosure: DISCLOSURE_OFF,
    summary: 'Dòng tiền trong kỳ được tính từ các giao dịch đã ghi nhận.',
    highlights: [
      {
        title: 'Dòng tiền trong kỳ',
        body: 'Thu nhập và chi tiêu đều được hệ thống tính từ giao dịch ghi nhận.',
        evidence: [{ label: 'Dòng tiền ròng trong kỳ', value: '4.000.000 ₫' }],
      },
    ],
    ...overrides,
  };
}

function makeExplanation(
  overrides: Partial<AnalyticsAiExplanationDto> = {},
): AnalyticsAiExplanationDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    facts: makeFacts(),
    evidence: [{ label: 'Tổng quan ngân sách tháng', value: '3 ngân sách: 1 vượt hạn mức' }],
    limitations: ['Chỉ giải thích các chỉ số đã tính.'],
    canModifyData: false,
    disclosure: DISCLOSURE_OFF,
    summary: 'Chi tiêu giữ nguyên các giá trị do hệ thống tính.',
    sections: [
      { title: 'Dòng tiền', body: 'Dòng tiền ròng được tính từ thu nhập trừ chi tiêu.' },
      { title: 'Danh mục chi tiêu', body: 'Nhóm chi nhiều nhất là Ăn uống.' },
      { title: 'Ngân sách', body: 'Có một ngân sách đã vượt hạn mức của tháng.' },
    ],
    ...overrides,
  };
}

function makeRecommendations(
  overrides: Partial<AnalyticsAiRecommendationsDto> = {},
): AnalyticsAiRecommendationsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    facts: makeFacts(),
    evidence: [{ label: 'Tổng quan ngân sách tháng', value: '3 ngân sách: 1 vượt hạn mức' }],
    limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
    canModifyData: false,
    disclosure: DISCLOSURE_OFF,
    recommendations: [
      {
        id: 'budget-exceeded',
        title: 'Xem lại ngân sách đang căng',
        detail: 'Có ngân sách đã vượt hạn mức trong tháng.',
        evidence: [{ label: 'Tổng quan ngân sách tháng', value: '3 ngân sách: 1 vượt hạn mức' }],
        expectedImpact: 'Giữ chi tiêu trong hạn mức đã đặt; đây chỉ là gợi ý.',
        confidence: 'medium',
        limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
        requiresConfirmation: true,
      },
    ],
    ...overrides,
  };
}

function makeChatReply(overrides: Partial<AnalyticsAiChatReplyDto> = {}): AnalyticsAiChatReplyDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    facts: makeFacts(),
    evidence: [{ label: 'Tổng quan ngân sách tháng', value: '3 ngân sách: 1 vượt hạn mức' }],
    limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
    canModifyData: false,
    disclosure: DISCLOSURE_OFF,
    intent: 'BUDGET',
    reply: 'Có một ngân sách đang vượt hạn mức trong tháng này.',
    clarification: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupServer(
  respond: (method: string, path: string, body?: Record<string, unknown>) => Response,
) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input.toString();
      const url = new URL(raw, 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      return respond(method, path, body);
    }),
  );
  return { calls };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsAiPanel currency="VND" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AnalyticsAiPanel — summary', () => {
  it('loads the summary once and separates official figures from the prose', async () => {
    const server = setupServer(() => json(makeSummary()));
    renderPanel();

    expect(
      await screen.findByText('Dòng tiền trong kỳ được tính từ các giao dịch đã ghi nhận.'),
    ).toBeInTheDocument();

    const facts = within(screen.getByTestId('ai-analytics-facts'));
    expect(facts.getByText('Hệ thống tính')).toBeInTheDocument();
    expect(facts.getByText('20.000.000 ₫')).toBeInTheDocument();
    expect(facts.getByText('71/100')).toBeInTheDocument();
    // Forecast and savings facts are explicitly marked as estimates.
    expect(
      facts.getByText(/Dự báo dòng tiền ròng \(phần còn lại của tháng này\)/),
    ).toBeInTheDocument();
    expect(
      facts.getByText('Ước tính từ mô hình dự báo; không phải số đã ghi nhận.'),
    ).toBeInTheDocument();
    expect(facts.getByText('Khả năng tiết kiệm/tháng (ước tính)')).toBeInTheDocument();

    const prose = within(screen.getByTestId('ai-analytics-summary-text'));
    expect(prose.getByText(/không thay thế số liệu chính thức/)).toBeInTheDocument();
    // A rule-based fallback is labelled "Không dùng AI", never as model output.
    expect(prose.getByText('Không dùng AI')).toBeInTheDocument();
    expect(prose.getByText(/AI đang tắt/)).toBeInTheDocument();
    expect(prose.getByText('Chỉ dựa trên dữ liệu đã ghi nhận.')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Bằng chứng từ hệ thống')).getAllByText(/Dòng tiền ròng/).length,
    ).toBeGreaterThan(0);

    const summaryCalls = server.calls.filter((call) => call.path === '/ai/analytics/summary');
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0].method).toBe('POST');
    expect(summaryCalls[0].body).toEqual({ currency: 'VND' });
  });

  it('labels model-written text as AI while official figures stay system-calculated', async () => {
    setupServer(() =>
      json(
        makeSummary({
          source: 'AI',
          disclosure: DISCLOSURE_ON,
          summary: 'Dòng tiền trong kỳ dương nhờ thu nhập lớn hơn chi tiêu.',
        }),
      ),
    );
    renderPanel();

    expect(await screen.findByText('AI giải thích')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nội dung do AI (anthropic · claude-opus-5-5) viết; AI chỉ nhận số liệu tổng hợp.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('ai-analytics-facts')).getByText('Hệ thống tính'),
    ).toBeInTheDocument();
    expect(screen.getByText('Thu nhập')).toBeInTheDocument();
    expect(screen.getByText('20.000.000 ₫')).toBeInTheDocument();
  });

  it('explains a rate limit instead of showing the raw 429', async () => {
    let attempt = 0;
    setupServer(() => {
      attempt += 1;
      if (attempt === 1) {
        return new Response(
          JSON.stringify({ statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests' }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
          },
        );
      }
      return json(makeSummary());
    });
    const user = userEvent.setup();
    renderPanel();

    expect(
      await screen.findByText('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 60 giây.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(
      await screen.findByText('Dòng tiền trong kỳ được tính từ các giao dịch đã ghi nhận.'),
    ).toBeInTheDocument();
  });
});

describe('AnalyticsAiPanel — explanation', () => {
  it('sends the question and renders backend evidence for each section', async () => {
    const server = setupServer((_method, path) =>
      path === '/ai/analytics/summary' ? json(makeSummary()) : json(makeExplanation()),
    );
    const user = userEvent.setup();
    renderPanel();

    await screen.findByTestId('ai-analytics-summary-text');
    await user.type(screen.getByLabelText('Câu hỏi cần giải thích'), 'Vì sao chi tiêu tăng?');
    await user.click(screen.getByRole('button', { name: /^Giải thích$/ }));

    expect(await screen.findByText('Nhóm chi nhiều nhất là Ăn uống.')).toBeInTheDocument();
    expect(screen.getByText(/Tổng quan ngân sách tháng/)).toBeInTheDocument();

    const explainCalls = server.calls.filter((call) => call.path === '/ai/analytics/explain');
    expect(explainCalls).toHaveLength(1);
    expect(explainCalls[0].method).toBe('POST');
    expect(explainCalls[0].body).toEqual({ currency: 'VND', question: 'Vì sao chi tiêu tăng?' });
  });

  it('asks for an explanation without a question when the field is empty', async () => {
    const server = setupServer((_method, path) =>
      path === '/ai/analytics/summary' ? json(makeSummary()) : json(makeExplanation()),
    );
    const user = userEvent.setup();
    renderPanel();

    await screen.findByTestId('ai-analytics-summary-text');
    await user.click(screen.getByRole('button', { name: /^Giải thích$/ }));

    await screen.findByText('Nhóm chi nhiều nhất là Ăn uống.');
    const explainCalls = server.calls.filter((call) => call.path === '/ai/analytics/explain');
    expect(explainCalls[0].body).toEqual({ currency: 'VND' });
  });
});

describe('AnalyticsAiPanel — recommendations', () => {
  it('only asks on demand and marks every suggestion as not applied', async () => {
    const server = setupServer((_method, path) =>
      path === '/ai/analytics/summary' ? json(makeSummary()) : json(makeRecommendations()),
    );
    const user = userEvent.setup();
    renderPanel();

    await screen.findByTestId('ai-analytics-summary-text');
    expect(server.calls.some((call) => call.path === '/ai/analytics/recommendations')).toBe(false);

    await user.click(screen.getByRole('button', { name: /Xem gợi ý/ }));

    const card = await screen.findByTestId('ai-analytics-recommendation');
    expect(within(card).getByText('Xem lại ngân sách đang căng')).toBeInTheDocument();
    expect(within(card).getByText('Độ tin cậy trung bình')).toBeInTheDocument();
    expect(within(card).getByText(/Gợi ý này không tự áp dụng/)).toBeInTheDocument();
    expect(within(card).getByText(/Tác động dự kiến \(ước tính\)/)).toBeInTheDocument();
    expect(within(card).getByText(/Tổng quan ngân sách tháng/)).toBeInTheDocument();

    const calls = server.calls.filter((call) => call.path === '/ai/analytics/recommendations');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ currency: 'VND' });
    // The panel has no write endpoint: nothing touches transactions, budgets,
    // goals or accounts.
    expect(
      server.calls.filter((call) => /\/transactions|\/budgets|\/goals|\/accounts/.test(call.path)),
    ).toHaveLength(0);
  });
});

describe('AnalyticsAiPanel — chat', () => {
  it('sends one question at a time with no chat history', async () => {
    let chatCount = 0;
    const server = setupServer((_method, path) => {
      if (path === '/ai/analytics/summary') return json(makeSummary());
      chatCount += 1;
      return json(
        chatCount === 1
          ? makeChatReply()
          : makeChatReply({
              intent: 'HEALTH',
              reply: 'Điểm sức khỏe tài chính dựa trên các nhóm.',
            }),
      );
    });
    const user = userEvent.setup();
    renderPanel();

    await screen.findByTestId('ai-analytics-summary-text');
    await user.click(screen.getByRole('button', { name: 'Ngân sách nào đang vượt hạn mức?' }));
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(
      await screen.findByText('Có một ngân sách đang vượt hạn mức trong tháng này.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Ngân sách')).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Câu hỏi cho trợ lý phân tích'),
      'Điểm sức khỏe thế nào?',
    );
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(
      await screen.findByText('Điểm sức khỏe tài chính dựa trên các nhóm.'),
    ).toBeInTheDocument();
    await screen.findByText('Sức khỏe tài chính');

    const chatCalls = server.calls.filter((call) => call.path === '/ai/analytics/chat');
    expect(chatCalls).toHaveLength(2);
    // Each question stands alone: there is no history field at all.
    expect(chatCalls[0].body).toEqual({
      currency: 'VND',
      message: 'Ngân sách nào đang vượt hạn mức?',
    });
    expect(chatCalls[1].body).toEqual({
      currency: 'VND',
      message: 'Điểm sức khỏe thế nào?',
    });
  });

  it('shows the refusal when the question asks to change data', async () => {
    setupServer((_method, path) =>
      path === '/ai/analytics/summary'
        ? json(makeSummary())
        : json(
            makeChatReply({
              intent: 'UNSUPPORTED',
              reply: 'Mình chỉ phân tích dữ liệu đã ghi nhận.',
              evidence: [],
              clarification:
                'Mình không thể tạo, sửa hay xóa giao dịch, ngân sách, mục tiêu hay số dư.',
            }),
          ),
    );
    const user = userEvent.setup();
    renderPanel();

    await screen.findByTestId('ai-analytics-summary-text');
    await user.type(screen.getByLabelText('Câu hỏi cho trợ lý phân tích'), 'Xóa giao dịch đi');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(
      await screen.findByText(
        'Mình không thể tạo, sửa hay xóa giao dịch, ngân sách, mục tiêu hay số dư.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Không hỗ trợ thay đổi dữ liệu')).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-log')).toBeInTheDocument();
  });
});
