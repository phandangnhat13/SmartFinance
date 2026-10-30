import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  SavingsChatReplyDto,
  SavingsExplanationDto,
  SavingsScenarioExplanationDto,
  SavingsSuggestionsDto,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavingsAssistantPanel } from './SavingsAssistantPanel';

interface RecordedCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

const DISCLOSURE_OFF = {
  aiEnabled: false,
  provider: null,
  model: null,
  usedModel: false,
  fallbackReason: 'disabled' as const,
  notice: 'AI đang tắt. Nội dung do quy tắc của hệ thống tạo ra từ dữ liệu thực của bạn.',
};

function makeExplanation(overrides: Partial<SavingsExplanationDto> = {}): SavingsExplanationDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    today: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    summary: 'Kế hoạch tháng này phân bổ 2.375.000 ₫ trên 1 mục tiêu đang thực hiện.',
    facts: {
      currency: 'VND',
      capacityStatus: 'available',
      capacityReason: null,
      monthsAnalyzed: 6,
      analyzedMonths: ['2026-04', '2026-05'],
      averageMonthlyIncome: '20000000.00',
      averageMonthlyExpense: '15000000.00',
      averageNetCashFlow: '5000000.00',
      historicalSavingsRate: 25,
      safetyBufferPercent: 20,
      safetyBufferAmount: '1000000.00',
      monthlyBudget: '4000000.00',
      allocatedMonthly: '2375000.00',
      unallocatedMonthly: '1625000.00',
      confidence: 'high',
    },
    goals: [
      {
        goalId: 'g1',
        goalName: 'Du lịch',
        priority: 1,
        priorityReason: 'Hạn chót gần nhất.',
        progressStatus: 'AT_RISK',
        statusReason: 'Chậm hơn kế hoạch một khoản góp.',
        targetDate: '2027-06-30',
        remainingAmount: '19000000.00',
        requiredMonthlySaving: '2375000.00',
        recommendedMonthlySaving: '2375000.00',
        estimatedCompletionDate: '2027-06-30',
        feasibility: 'ON_TRACK',
        atRisk: true,
      },
    ],
    sections: [
      { title: 'Khả năng tiết kiệm', body: 'Tính từ 6 tháng đã kết thúc.' },
      { title: 'Vì sao giữ lại 20%', body: 'Quy tắc cố định của hệ thống.' },
      { title: 'Rủi ro và tiến độ', body: 'Du lịch đang chậm tiến độ.' },
    ],
    limitations: ['Chưa tính lạm phát.'],
    disclosure: DISCLOSURE_OFF,
    ...overrides,
  };
}

function makeSuggestions(overrides: Partial<SavingsSuggestionsDto> = {}): SavingsSuggestionsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    suggestions: [
      {
        id: 'catch-up-g1',
        title: 'Đưa mục tiêu Du lịch về đúng kế hoạch',
        explanation: 'Mục tiêu đang chậm tiến độ.',
        evidence: [{ label: 'Tiến độ Du lịch', value: 'AT_RISK — Chậm hơn kế hoạch.' }],
        expectedImpact: 'Có thể hoàn thành đúng hạn nếu giữ nhịp; đây là ước tính.',
        goalIds: ['g1'],
        confidence: 'high',
        limitations: ['Chưa tính lạm phát.'],
        requiresConfirmation: true,
      },
    ],
    limitations: ['Chỉ dựa trên dữ liệu đã ghi nhận.'],
    disclosure: DISCLOSURE_OFF,
    ...overrides,
  };
}

function makeSimulation(): SingleGoalSimulationDto {
  return {
    scenario: 'MONTHLY_AMOUNT',
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    goalId: 'g1',
    goalName: 'Du lịch',
    current: {
      targetAmount: '24000000.00',
      savedAmount: '5000000.00',
      remainingAmount: '19000000.00',
      completionPercentage: 21,
      targetDate: '2027-06-30',
      monthsRemaining: 8,
      requiredMonthlySaving: '2375000.00',
      monthlySaving: '2375000.00',
      monthsToComplete: 8,
      estimatedCompletionDate: '2027-06-30',
      deadlineMet: true,
    },
    simulated: {
      targetAmount: '24000000.00',
      savedAmount: '5000000.00',
      remainingAmount: '19000000.00',
      completionPercentage: 21,
      targetDate: '2027-06-30',
      monthsRemaining: 8,
      requiredMonthlySaving: '2375000.00',
      monthlySaving: '3000000.00',
      monthsToComplete: 7,
      estimatedCompletionDate: '2027-05-30',
      deadlineMet: true,
    },
    difference: {
      targetAmount: '0',
      remainingAmount: '0',
      requiredMonthlySaving: '2375000.00',
      monthlySaving: '625000.00',
      completionDateShiftMonths: -1,
    },
    capacity: { available: true, monthlySaving: '4000000.00', requiredWithinCapacity: true },
    feasibility: 'FEASIBLE',
    feasibilityReason: 'Mức góp nằm trong khả năng tiết kiệm.',
    warnings: [],
    limitations: ['Chỉ là mô phỏng.'],
  };
}

function makeScenario(
  overrides: Partial<SavingsScenarioExplanationDto> = {},
): SavingsScenarioExplanationDto {
  return {
    status: 'simulated',
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    simulation: makeSimulation(),
    explanation:
      'Đây là mô phỏng chỉ đọc, không phải thay đổi đã lưu. Với giả định này, mục tiêu Du lịch hoàn thành sớm hơn.',
    clarification: null,
    interpretation: {
      scenario: 'MONTHLY_AMOUNT',
      goalId: 'g1',
      goalName: 'Du lịch',
      monthlyAmount: '3000000',
      targetAmount: null,
      targetDate: null,
      budget: null,
      confidence: 'high',
    },
    requiresConfirmation: true,
    limitations: ['Mô phỏng chỉ đọc: không có khoản góp nào được lưu.'],
    disclosure: DISCLOSURE_OFF,
    ...overrides,
  };
}

function makeChatReply(overrides: Partial<SavingsChatReplyDto> = {}): SavingsChatReplyDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    source: 'FALLBACK',
    intent: 'PRIORITY',
    reply: 'Thứ tự ưu tiên hiện tại: 1. Du lịch.',
    references: [{ label: 'Mục tiêu Du lịch', value: 'Còn thiếu 19.000.000 ₫' }],
    scenario: null,
    clarification: null,
    canModifyData: false,
    disclosure: DISCLOSURE_OFF,
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

function renderPanel(onReviewGoal = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SavingsAssistantPanel currency="VND" onReviewGoal={onReviewGoal} />
    </QueryClientProvider>,
  );
  return { onReviewGoal };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SavingsAssistantPanel — explanation', () => {
  it('loads the explanation once and labels deterministic text as calculated', async () => {
    const server = setupServer(() => json(makeExplanation()));
    renderPanel();

    expect(
      await screen.findByText(
        'Kế hoạch tháng này phân bổ 2.375.000 ₫ trên 1 mục tiêu đang thực hiện.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Hệ thống tính')).toBeInTheDocument();
    expect(screen.getByText(/AI đang tắt/)).toBeInTheDocument();
    expect(screen.getByText('20.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('Du lịch')).toBeInTheDocument();
    expect(screen.getByText('Chưa tính lạm phát.')).toBeInTheDocument();

    const explainCalls = server.calls.filter((call) => call.path === '/ai/savings/explain');
    expect(explainCalls).toHaveLength(1);
    expect(explainCalls[0].body).toEqual({ currency: 'VND' });
    expect(explainCalls[0].method).toBe('POST');
  });

  it('shows the AI badge and disclosure when the model wrote the text', async () => {
    setupServer(() =>
      json(
        makeExplanation({
          source: 'AI',
          disclosure: {
            aiEnabled: true,
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            usedModel: true,
            fallbackReason: null,
            notice: 'Nội dung do AI (anthropic · claude-opus-5-5) viết.',
          },
        }),
      ),
    );
    renderPanel();

    expect(await screen.findByText('AI viết')).toBeInTheDocument();
    expect(
      screen.getByText('Nội dung do AI (anthropic · claude-opus-5-5) viết.'),
    ).toBeInTheDocument();
  });

  it('offers a retry when the explanation request fails', async () => {
    let attempt = 0;
    const server = setupServer(() => {
      attempt += 1;
      if (attempt === 1) {
        return json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500);
      }
      return json(makeExplanation());
    });
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText(/Kế hoạch tháng này phân bổ/)).toBeInTheDocument();
    expect(server.calls.filter((call) => call.path === '/ai/savings/explain')).toHaveLength(2);
  });
});

describe('SavingsAssistantPanel — suggestions', () => {
  it('only requests suggestions on demand and shows evidence from the backend', async () => {
    const server = setupServer((_method, path) =>
      path === '/ai/savings/explain' ? json(makeExplanation()) : json(makeSuggestions()),
    );
    const user = userEvent.setup();
    const { onReviewGoal } = renderPanel();

    await screen.findByText(/Kế hoạch tháng này phân bổ/);
    expect(server.calls.some((call) => call.path === '/ai/savings/suggestions')).toBe(false);

    await user.click(screen.getByRole('button', { name: /Xem gợi ý/ }));

    expect(await screen.findByText('Bằng chứng từ dữ liệu')).toBeInTheDocument();
    const panel = within(screen.getByTestId('ai-suggestions'));
    expect(panel.getByText('Độ tin cậy cao')).toBeInTheDocument();
    expect(panel.getByText(/Gợi ý này không tự áp dụng/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xem mục tiêu' }));
    expect(onReviewGoal).toHaveBeenCalledWith('g1');

    const calls = server.calls.filter((call) => call.path === '/ai/savings/suggestions');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ currency: 'VND' });
  });
});

describe('SavingsAssistantPanel — scenario', () => {
  it('simulates through the server, labels it hypothetical and never writes', async () => {
    const server = setupServer((_method, path) => {
      if (path === '/ai/savings/explain') return json(makeExplanation());
      return json(makeScenario());
    });
    const user = userEvent.setup();
    const { onReviewGoal } = renderPanel();

    await screen.findByText(/Kế hoạch tháng này phân bổ/);
    await user.type(
      screen.getByLabelText('Kịch bản muốn mô phỏng'),
      'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
    );
    await user.click(screen.getByRole('button', { name: /^Mô phỏng$/ }));

    expect(await screen.findByText('Giả định – chưa áp dụng')).toBeInTheDocument();
    expect(screen.getByText('Mức góp mỗi tháng · Du lịch')).toBeInTheDocument();
    expect(screen.getByText(/Đây là mô phỏng chỉ đọc/)).toBeInTheDocument();
    expect(screen.getByText(/chưa có thay đổi nào được lưu/)).toBeInTheDocument();

    const scenarioCalls = server.calls.filter(
      (call) => call.path === '/ai/savings/scenario-explanation',
    );
    expect(scenarioCalls).toHaveLength(1);
    expect(scenarioCalls[0].body).toEqual({
      currency: 'VND',
      message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
    });

    await user.click(screen.getByRole('button', { name: 'Xem và xác nhận điều chỉnh' }));
    expect(onReviewGoal).toHaveBeenCalledWith('g1');

    // The panel itself never touches goals, contributions or adjustments.
    expect(
      server.calls.filter(
        (call) =>
          call.path.includes('/goals') ||
          call.path.includes('/savings/adjustments') ||
          call.path.includes('/savings/simulations'),
      ),
    ).toHaveLength(0);
  });

  it('asks for clarification instead of showing a made-up simulation', async () => {
    setupServer((_method, path) =>
      path === '/ai/savings/explain'
        ? json(makeExplanation())
        : json(
            makeScenario({
              status: 'clarification',
              simulation: null,
              explanation: 'Bạn muốn mô phỏng cho mục tiêu nào?',
              clarification: 'Bạn muốn mô phỏng cho mục tiêu nào?',
              requiresConfirmation: true,
              interpretation: {
                scenario: null,
                goalId: null,
                goalName: null,
                monthlyAmount: null,
                targetAmount: null,
                targetDate: null,
                budget: null,
                confidence: 'low',
              },
            }),
          ),
    );
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText(/Kế hoạch tháng này phân bổ/);
    await user.type(screen.getByLabelText('Kịch bản muốn mô phỏng'), 'Nếu góp thêm thì sao?');
    await user.click(screen.getByRole('button', { name: /^Mô phỏng$/ }));

    expect(await screen.findByText('Bạn muốn mô phỏng cho mục tiêu nào?')).toBeInTheDocument();
    expect(screen.queryByText('Giả định – chưa áp dụng')).not.toBeInTheDocument();
  });
});

describe('SavingsAssistantPanel — chat', () => {
  it('sends a suggested question, shows references and keeps a bounded history', async () => {
    let chatCount = 0;
    const server = setupServer((_method, path) => {
      if (path === '/ai/savings/explain') return json(makeExplanation());
      chatCount += 1;
      return json(
        chatCount === 1
          ? makeChatReply()
          : makeChatReply({ intent: 'STATUS', reply: 'Bạn có 1 mục tiêu đang chậm tiến độ.' }),
      );
    });
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText(/Kế hoạch tháng này phân bổ/);
    await user.click(screen.getByRole('button', { name: 'Mục tiêu nào nên ưu tiên nhất?' }));
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(await screen.findByText('Thứ tự ưu tiên hiện tại: 1. Du lịch.')).toBeInTheDocument();
    expect(screen.getByText('Mục tiêu Du lịch: Còn thiếu 19.000.000 ₫')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Câu hỏi cho trợ lý'), 'Tiến độ thế nào?');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(await screen.findByText('Bạn có 1 mục tiêu đang chậm tiến độ.')).toBeInTheDocument();

    const chatCalls = server.calls.filter((call) => call.path === '/ai/savings/chat');
    expect(chatCalls).toHaveLength(2);
    expect(chatCalls[0].body).toEqual({
      currency: 'VND',
      message: 'Mục tiêu nào nên ưu tiên nhất?',
      history: [],
    });
    expect(chatCalls[1].body).toMatchObject({
      currency: 'VND',
      message: 'Tiến độ thế nào?',
      history: [
        { role: 'user', content: 'Mục tiêu nào nên ưu tiên nhất?' },
        { role: 'assistant', content: 'Thứ tự ưu tiên hiện tại: 1. Du lịch.' },
      ],
    });
  });

  it('shows the refusal notice when the assistant cannot change data', async () => {
    setupServer((_method, path) =>
      path === '/ai/savings/explain'
        ? json(makeExplanation())
        : json(
            makeChatReply({
              intent: 'UNSUPPORTED',
              reply: 'Mình chỉ giải thích và mô phỏng.',
              references: [],
              clarification:
                'Mình không thể tạo, sửa hay xóa mục tiêu, khoản góp, giao dịch hoặc số dư.',
            }),
          ),
    );
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText(/Kế hoạch tháng này phân bổ/);
    await user.type(screen.getByLabelText('Câu hỏi cho trợ lý'), 'Xóa mục tiêu Du lịch đi');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(
      await screen.findByText(
        'Mình không thể tạo, sửa hay xóa mục tiêu, khoản góp, giao dịch hoặc số dư.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-log')).toBeInTheDocument();
    });
  });
});
