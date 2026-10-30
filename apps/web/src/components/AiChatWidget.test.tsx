import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AiChatMessageMetadataDto,
  AiConversationDto,
  AiDisclosureDto,
  AiMessageDto,
  AiStoredAnalyticsReplyDto,
  AiStoredSavingsReplyDto,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiChat } from '../lib/ai-chat-events';
import { AiChatWidget } from './AiChatWidget';

interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  body?: Record<string, unknown>;
}

type Respond = (call: RecordedCall) => Response | Promise<Response>;

const DISCLOSURE_OFF: AiDisclosureDto = {
  aiEnabled: false,
  provider: null,
  model: null,
  usedModel: false,
  fallbackReason: 'disabled',
  notice: 'AI đang tắt. Nội dung do quy tắc của hệ thống tạo ra từ dữ liệu thực của bạn.',
};

function makeConversation(overrides: Partial<AiConversationDto> = {}): AiConversationDto {
  return {
    id: 'c1',
    title: 'Cuộc trò chuyện A',
    assistantType: 'ANALYTICS',
    createdAt: '2026-10-30T02:00:00.000Z',
    updatedAt: '2026-10-30T03:00:00.000Z',
    ...overrides,
  };
}

function analyticsMetadata(
  overrides: Partial<AiStoredAnalyticsReplyDto> = {},
): AiChatMessageMetadataDto {
  return {
    assistantType: 'ANALYTICS',
    reply: {
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      generatedAt: '2026-10-30T03:00:00.000Z',
      source: 'FALLBACK',
      intent: 'BUDGET',
      evidence: [{ label: 'Tổng quan ngân sách tháng', value: '3 ngân sách: 1 vượt hạn mức' }],
      clarification: null,
      canModifyData: false,
      disclosure: DISCLOSURE_OFF,
      ...overrides,
    },
  };
}

function savingsMetadata(
  overrides: Partial<AiStoredSavingsReplyDto> = {},
): AiChatMessageMetadataDto {
  return {
    assistantType: 'SAVINGS',
    reply: {
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      generatedAt: '2026-10-30T03:00:00.000Z',
      source: 'FALLBACK',
      intent: 'SCENARIO',
      references: [{ label: 'Mục tiêu Du lịch', value: 'Còn thiếu 19.000.000 ₫' }],
      scenario: makeSimulation(),
      clarification: null,
      canModifyData: false,
      disclosure: DISCLOSURE_OFF,
      ...overrides,
    },
  };
}

function makeSimulation(): SingleGoalSimulationDto {
  const figures = {
    targetAmount: '20000000.00',
    savedAmount: '1000000.00',
    remainingAmount: '19000000.00',
    completionPercentage: 5,
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    requiredMonthlySaving: '2375000.00',
    monthlySaving: '2000000.00',
    monthsToComplete: 10,
    estimatedCompletionDate: '2027-08-31',
    deadlineMet: false,
  };
  return {
    scenario: 'MONTHLY_AMOUNT',
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    goalId: 'g1',
    goalName: 'Du lịch',
    current: figures,
    simulated: { ...figures, monthlySaving: '3000000.00', deadlineMet: true },
    difference: {
      targetAmount: '0.00',
      remainingAmount: '0.00',
      requiredMonthlySaving: '2375000.00',
      monthlySaving: '1000000.00',
      completionDateShiftMonths: -2,
    },
    capacity: { available: true, monthlySaving: '4000000.00', requiredWithinCapacity: true },
    feasibility: 'FEASIBLE',
    feasibilityReason: 'Mức góp mới đủ để hoàn thành đúng hạn.',
    warnings: [],
    limitations: ['Mô phỏng chỉ đọc.'],
  };
}

let messageSeq = 0;

function userMessage(
  conversationId: string,
  content: string,
  createdAt = '2026-10-30T03:00:00.000Z',
): AiMessageDto {
  messageSeq += 1;
  return {
    id: `m${messageSeq}`,
    conversationId,
    role: 'USER',
    content,
    metadata: null,
    createdAt,
  };
}

function assistantMessage(
  conversationId: string,
  content: string,
  metadata: AiChatMessageMetadataDto,
  createdAt = '2026-10-30T03:00:01.000Z',
): AiMessageDto {
  messageSeq += 1;
  return {
    id: `m${messageSeq}`,
    conversationId,
    role: 'ASSISTANT',
    content,
    metadata,
    createdAt,
  };
}

function paged<T>(
  items: T[],
  {
    page = 1,
    limit = 20,
    total = items.length,
  }: { page?: number; limit?: number; total?: number } = {},
) {
  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function setupServer(respond: Respond) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input.toString();
      const url = new URL(raw, 'http://localhost');
      const call: RecordedCall = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^\/api\/v1/, ''),
        search: url.searchParams,
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
      };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}

function renderWidget(pathname = '/dashboard') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <AiChatWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function renderWidgetWithNavigation(pathname = '/dashboard') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function NavigationProbe() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate('/budgets')}>
        Đi tới ngân sách
      </button>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <NavigationProbe />
        <AiChatWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

async function openWidget() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('ai-chat-launcher'));
  await screen.findByTestId('ai-chat-widget');
  return user;
}

function conversationCalls(calls: RecordedCall[], method?: string) {
  return calls.filter(
    (call) => call.path === '/ai/conversations' && (!method || call.method === method),
  );
}

function messageCalls(calls: RecordedCall[], conversationId = 'c1', method?: string) {
  return calls.filter(
    (call) =>
      call.path === `/ai/conversations/${conversationId}/messages` &&
      (!method || call.method === method),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AiChatWidget — window states', () => {
  it('opens, minimizes to a pill, expands again and closes', async () => {
    setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget();

    const user = await openWidget();
    expect(screen.getByRole('dialog', { name: 'Trợ lý AI' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thu nhỏ trò chuyện AI' }));
    expect(screen.queryByTestId('ai-chat-widget')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở rộng trò chuyện AI' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mở rộng trò chuyện AI' }));
    expect(await screen.findByTestId('ai-chat-widget')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Đóng trợ lý AI' }));
    expect(screen.queryByTestId('ai-chat-widget')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-launcher')).toBeInTheDocument();
  });

  it('keeps the draft while the window is minimized', async () => {
    setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget();
    const user = await openWidget();

    await user.type(screen.getByTestId('ai-chat-input'), 'Câu hỏi đang viết dở');
    await user.click(screen.getByRole('button', { name: 'Thu nhỏ trò chuyện AI' }));
    await user.click(screen.getByRole('button', { name: 'Mở rộng trò chuyện AI' }));

    expect(await screen.findByTestId('ai-chat-input')).toHaveValue('Câu hỏi đang viết dở');
  });

  it('opens pre-filled when a page asks about something and never sends on its own', async () => {
    const calls = setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget('/analytics');
    expect(screen.queryByTestId('ai-chat-widget')).not.toBeInTheDocument();

    const prompt = 'Giải thích biểu đồ thu nhập và chi tiêu của tôi trong 6 tháng gần đây.';
    act(() => {
      openAiChat({ prompt, assistantType: 'ANALYTICS' });
    });

    expect(await screen.findByTestId('ai-chat-widget')).toBeInTheDocument();
    const input = screen.getByTestId('ai-chat-input');
    await waitFor(() => expect(input).toHaveValue(prompt));
    await waitFor(() => expect(input).toHaveFocus());
    // Pre-filling is only a composer draft; the user still decides to send.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});

describe('AiChatWidget — assistant selection', () => {
  it('defaults to the savings assistant on the goals page and can switch', async () => {
    setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget('/goals');
    const user = await openWidget();

    expect(screen.getByText('Trợ lý tiết kiệm · chỉ đọc')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Hỏi về mục tiêu và kế hoạch tiết kiệm...'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tại sao hệ thống đề xuất mức tiết kiệm này?' }),
    ).toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Chọn trợ lý' });
    expect(within(group).getByRole('button', { name: 'Trợ lý tiết kiệm' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(group).getByRole('button', { name: 'Trợ lý phân tích' }));

    expect(screen.getByText('Trợ lý phân tích · chỉ đọc')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Hỏi về chi tiêu, ngân sách, dự báo...'),
    ).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Trợ lý phân tích' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('AiChatWidget — sending', () => {
  it('creates a conversation on the first turn and renders the stored reply', async () => {
    const conversation = makeConversation();
    const stored: AiMessageDto[] = [];
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations' && call.method === 'GET') {
        return json(paged([] as AiConversationDto[]));
      }
      if (call.path === '/ai/conversations' && call.method === 'POST') {
        return json(conversation);
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'GET') {
        return json(paged(stored));
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'POST') {
        const content = String(call.body?.content ?? '');
        const reply = assistantMessage(
          'c1',
          'Có một ngân sách đang vượt hạn mức trong tháng này.',
          analyticsMetadata(),
        );
        stored.push(userMessage('c1', content), reply);
        return json({
          userMessage: stored[stored.length - 2],
          assistantMessage: reply,
        });
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();

    await user.type(screen.getByTestId('ai-chat-input'), 'Ngân sách nào đang vượt hạn mức?');
    await user.click(screen.getByTestId('ai-chat-send'));

    expect(
      await screen.findByText('Có một ngân sách đang vượt hạn mức trong tháng này.'),
    ).toBeInTheDocument();
    // The header title and the user's bubble both show the question.
    expect(screen.getAllByText('Ngân sách nào đang vượt hạn mức?')).toHaveLength(2);
    expect(screen.getByTestId('ai-chat-input')).toHaveValue('');

    const creates = conversationCalls(calls, 'POST');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toEqual({ assistantType: 'ANALYTICS' });

    const sends = messageCalls(calls, 'c1', 'POST');
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toEqual({ content: 'Ngân sách nào đang vượt hạn mức?' });
  });

  it('sends on Enter but inserts a newline on Shift+Enter', async () => {
    const stored = [userMessage('c1', 'Câu hỏi cũ')];
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'GET') {
        return json(paged(stored));
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'POST') {
        const content = String(call.body?.content ?? '');
        const reply = assistantMessage(
          'c1',
          'Câu trả lời mới.',
          analyticsMetadata({ intent: 'SUMMARY' }),
        );
        stored.push(userMessage('c1', content), reply);
        return json({
          userMessage: stored[stored.length - 2],
          assistantMessage: reply,
        });
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    const input = screen.getByTestId('ai-chat-input');
    await user.type(input, 'Dòng một');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(messageCalls(calls, 'c1', 'POST')).toHaveLength(0);
    expect(input).toHaveValue('Dòng một\n');

    await user.type(input, 'Dòng hai');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Câu trả lời mới.')).toBeInTheDocument();
    expect(messageCalls(calls, 'c1', 'POST')[0].body).toEqual({
      content: 'Dòng một\nDòng hai',
    });
  });

  it('shows a typing indicator while the answer is being written', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stored = [userMessage('c1', 'Câu hỏi cũ')];
    setupServer(async (call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'GET') {
        return json(paged(stored));
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'POST') {
        await gate;
        const reply = assistantMessage('c1', 'Câu trả lời chậm.', analyticsMetadata());
        return json({
          userMessage: userMessage('c1', 'Hỏi chậm'),
          assistantMessage: reply,
        });
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    await user.type(screen.getByTestId('ai-chat-input'), 'Hỏi chậm');
    await user.click(screen.getByTestId('ai-chat-send'));

    expect(await screen.findByText('Đang soạn câu trả lời...')).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-send')).toBeDisabled();

    release();

    expect(await screen.findByText('Câu trả lời chậm.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Đang soạn câu trả lời...')).not.toBeInTheDocument();
    });
  });

  it('shows the rate-limit hint and keeps the draft when sending is throttled', async () => {
    const stored = [userMessage('c1', 'Câu hỏi cũ')];
    setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'GET') {
        return json(paged(stored));
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'POST') {
        return new Response(JSON.stringify({ statusCode: 429, code: 'RATE_LIMITED' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'retry-after': '30' },
        });
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    await user.type(screen.getByTestId('ai-chat-input'), 'Hỏi quá nhanh');
    await user.click(screen.getByTestId('ai-chat-send'));

    expect(
      await screen.findByText('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 30 giây.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-input')).toHaveValue('Hỏi quá nhanh');
  });

  it('keeps the send button disabled for a blank message', async () => {
    setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget();
    await openWidget();

    expect(screen.getByTestId('ai-chat-send')).toBeDisabled();
  });
});

describe('AiChatWidget — history', () => {
  it('lists conversations, searches by title and opens one to continue it', async () => {
    const first = makeConversation({ id: 'c1', title: 'Du lịch 2027', assistantType: 'SAVINGS' });
    const second = makeConversation({ id: 'c2', title: 'Ngân sách tháng 10' });
    const history = [first, second];
    const stored = [
      userMessage('c1', 'Mục tiêu du lịch thế nào?', '2026-10-30T02:00:00.000Z'),
      assistantMessage(
        'c1',
        'Bạn còn thiếu 19.000.000 ₫ cho mục tiêu Du lịch.',
        savingsMetadata({ scenario: null }),
        '2026-10-30T02:00:01.000Z',
      ),
    ];
    let sent = 0;
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations') {
        const q = call.search.get('q') ?? '';
        const items = q
          ? history.filter((conversation) =>
              conversation.title.toLowerCase().includes(q.toLowerCase()),
            )
          : history;
        return json(paged(items));
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'GET') {
        return json(paged(stored));
      }
      if (call.path === '/ai/conversations/c1/messages' && call.method === 'POST') {
        sent += 1;
        const reply = assistantMessage(
          'c1',
          'Mục tiêu vẫn đang được theo dõi.',
          savingsMetadata({ scenario: null }),
        );
        return json({
          userMessage: userMessage('c1', 'Tiếp tục nhé'),
          assistantMessage: reply,
        });
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));

    const list = await screen.findByTestId('ai-conversation-list');
    expect(within(list).getByText('Du lịch 2027')).toBeInTheDocument();
    expect(within(list).getByText('Ngân sách tháng 10')).toBeInTheDocument();
    // Each row names the assistant type and its last activity.
    expect(within(list).getByText('Trợ lý tiết kiệm')).toBeInTheDocument();
    expect(within(list).getByText('Trợ lý phân tích')).toBeInTheDocument();

    await user.type(screen.getByTestId('ai-conversation-search'), 'du lịch');

    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.path === '/ai/conversations' && call.search.get('q') === 'du lịch',
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        within(screen.getByTestId('ai-conversation-list')).queryByText('Ngân sách tháng 10'),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ai-conversation-item'));

    expect(await screen.findByText('Mục tiêu du lịch thế nào?')).toBeInTheDocument();
    expect(
      screen.getByText('Bạn còn thiếu 19.000.000 ₫ cho mục tiêu Du lịch.'),
    ).toBeInTheDocument();
    // Reopening restores the conversation's assistant, not the page default.
    expect(screen.getByText('Trợ lý tiết kiệm · chỉ đọc')).toBeInTheDocument();

    await user.type(screen.getByTestId('ai-chat-input'), 'Tiếp tục nhé');
    await user.click(screen.getByTestId('ai-chat-send'));

    expect(await screen.findByText('Mục tiêu vẫn đang được theo dõi.')).toBeInTheDocument();
    expect(sent).toBe(1);
    // Continuing must not create a second conversation.
    expect(conversationCalls(calls, 'POST')).toHaveLength(0);
  });

  it('renames a conversation from the history view', async () => {
    let conversations = [makeConversation({ title: 'Tên cũ' })];
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations' && call.method === 'GET') {
        return json(paged(conversations));
      }
      if (call.path === '/ai/conversations/c1' && call.method === 'PATCH') {
        conversations = [
          {
            ...conversations[0],
            title: String(call.body?.title ?? ''),
            updatedAt: '2026-10-31T00:00:00.000Z',
          },
        ];
        return json(conversations[0]);
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await screen.findByText('Tên cũ');

    await user.click(screen.getByRole('button', { name: 'Đổi tên Tên cũ' }));
    const input = await screen.findByLabelText('Tiêu đề mới');
    await user.clear(input);
    await user.type(input, 'Tên mới');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Tên mới')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tiêu đề mới')).not.toBeInTheDocument();

    const patches = calls.filter(
      (call) => call.path === '/ai/conversations/c1' && call.method === 'PATCH',
    );
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ title: 'Tên mới' });
  });

  it('deletes only after the confirmation and shows the empty state', async () => {
    let conversations = [makeConversation({ title: 'Sẽ xoá' })];
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations' && call.method === 'GET') {
        return json(paged(conversations));
      }
      if (call.path === '/ai/conversations/c1' && call.method === 'DELETE') {
        conversations = [];
        return noContent();
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await screen.findByText('Sẽ xoá');

    await user.click(screen.getByRole('button', { name: 'Xoá Sẽ xoá' }));

    expect(
      await screen.findByText(
        'Xoá “Sẽ xoá” cùng toàn bộ tin nhắn? Hành động này không thể hoàn tác.',
      ),
    ).toBeInTheDocument();
    // Nothing is deleted until the dialog is confirmed.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Xoá' }));

    expect(
      await screen.findByText('Chưa có cuộc trò chuyện nào. Hãy bắt đầu một cuộc trò chuyện mới.'),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('loads older messages page by page and keeps chronological order', async () => {
    const older = userMessage('c1', 'Tin cũ nhất', '2026-10-29T01:00:00.000Z');
    const middle = userMessage('c1', 'Tin giữa', '2026-10-30T01:00:00.000Z');
    const newest = assistantMessage(
      'c1',
      'Tin mới nhất',
      analyticsMetadata({ intent: 'SUMMARY' }),
      '2026-10-30T02:00:00.000Z',
    );
    setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages') {
        const page = Number(call.search.get('page') ?? '1');
        return json(
          page === 1
            ? paged([middle, newest], { page: 1, limit: 30, total: 33 })
            : paged([older], { page: 2, limit: 30, total: 33 }),
        );
      }
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));

    const log = await screen.findByTestId('ai-chat-log');
    expect(within(log).queryByText('Tin cũ nhất')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tải tin nhắn cũ hơn' }));

    await waitFor(() => {
      expect(within(log).getByText('Tin cũ nhất')).toBeInTheDocument();
    });
    const rendered = within(log)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(rendered.findIndex((text) => text.includes('Tin cũ nhất'))).toBeLessThan(
      rendered.findIndex((text) => text.includes('Tin giữa')),
    );
    expect(rendered.findIndex((text) => text.includes('Tin giữa'))).toBeLessThan(
      rendered.findIndex((text) => text.includes('Tin mới nhất')),
    );
    expect(screen.queryByRole('button', { name: 'Tải tin nhắn cũ hơn' })).not.toBeInTheDocument();
  });
  it('starts a fresh conversation without deleting the open one', async () => {
    const stored = [userMessage('c1', 'Câu hỏi cũ')];
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages') return json(paged(stored));
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    await user.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));

    expect(screen.getByText('Bắt đầu cuộc trò chuyện mới')).toBeInTheDocument();
    expect(screen.queryByText('Câu hỏi cũ')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    expect(await screen.findByText('Cuộc trò chuyện A')).toBeInTheDocument();
  });
});

describe('AiChatWidget — stored AI metadata', () => {
  it('renders evidence, intent, clarification and the fallback disclosure from a stored reply', async () => {
    const stored = [
      userMessage('c1', 'Ngân sách nào vượt?', '2026-10-30T02:00:00.000Z'),
      assistantMessage(
        'c1',
        'Mình không thể thay đổi dữ liệu, nhưng đây là ngân sách vượt hạn mức.',
        analyticsMetadata({
          intent: 'UNSUPPORTED',
          clarification: 'Mình không thể tạo, sửa hay xóa giao dịch hay ngân sách.',
        }),
        '2026-10-30T02:00:01.000Z',
      ),
    ];
    setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages') return json(paged(stored));
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));

    const reply = await screen.findByTestId('ai-chat-reply');
    expect(within(reply).getByText('Không dùng AI')).toBeInTheDocument();
    expect(within(reply).getByText('Không hỗ trợ thay đổi dữ liệu')).toBeInTheDocument();
    expect(
      within(reply).getByText('Tổng quan ngân sách tháng', { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(reply).getByText('Mình không thể tạo, sửa hay xóa giao dịch hay ngân sách.'),
    ).toBeInTheDocument();
    expect(within(reply).getByText(DISCLOSURE_OFF.notice)).toBeInTheDocument();
  });

  it('renders the read-only simulation stored with a savings answer', async () => {
    const stored = [
      userMessage('c1', 'Nếu góp 3 triệu thì sao?', '2026-10-30T02:00:00.000Z'),
      assistantMessage(
        'c1',
        'Đây là kết quả mô phỏng cho mục tiêu Du lịch.',
        savingsMetadata(),
        '2026-10-30T02:00:01.000Z',
      ),
    ];
    setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      if (call.path === '/ai/conversations/c1/messages') return json(paged(stored));
      return json({}, 404);
    });

    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));

    const reply = await screen.findByTestId('ai-chat-reply');
    expect(within(reply).getByText('Câu trả lời kèm mô phỏng')).toBeInTheDocument();
    expect(within(reply).getByText('Giả định – chưa áp dụng')).toBeInTheDocument();
    expect(within(reply).getByText(/Mức góp mới đủ để hoàn thành đúng hạn/)).toBeInTheDocument();
    // The goal name appears in both the simulation summary and the reference chip.
    expect(within(reply).getAllByText('Mục tiêu Du lịch', { exact: false }).length).toBeGreaterThan(
      0,
    );
  });
});

const CONTEXT_PROMPT = 'Giải thích chi tiêu của tôi trong tháng này.';
const DASHBOARD_EXPENSE_CONTEXT = {
  page: 'dashboard' as const,
  feature: 'expense',
  label: 'Chi tiêu tháng này',
  currency: 'VND',
  dateRange: { from: '2026-10-01', to: '2026-10-31' },
};

/** A server that accepts one new conversation and answers its first message. */
function setupSendingServer() {
  const conversation = makeConversation();
  const stored: AiMessageDto[] = [];
  const calls = setupServer((call) => {
    if (call.path === '/ai/conversations' && call.method === 'GET') {
      return json(paged([] as AiConversationDto[]));
    }
    if (call.path === '/ai/conversations' && call.method === 'POST') {
      return json(conversation);
    }
    if (call.path === '/ai/conversations/c1/messages' && call.method === 'GET') {
      return json(paged(stored));
    }
    if (call.path === '/ai/conversations/c1/messages' && call.method === 'POST') {
      const content = String(call.body?.content ?? '');
      const reply = assistantMessage(
        'c1',
        'Đây là câu trả lời theo ngữ cảnh.',
        analyticsMetadata(),
      );
      stored.push(userMessage('c1', content), reply);
      return json({ userMessage: stored[stored.length - 2], assistantMessage: reply });
    }
    return json({}, 404);
  });
  return calls;
}

describe('AiChatWidget — page context', () => {
  it('shows what the page asked about and never sends on its own', async () => {
    const calls = setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget('/dashboard');

    act(() => {
      openAiChat({
        prompt: CONTEXT_PROMPT,
        assistantType: 'ANALYTICS',
        context: DASHBOARD_EXPENSE_CONTEXT,
      });
    });

    const indicator = await screen.findByTestId('ai-chat-context');
    expect(within(indicator).getByText('Chi tiêu tháng này')).toBeInTheDocument();
    expect(
      within(indicator).getByText('Đơn vị VND · Kỳ 01/10/2026 – 31/10/2026'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-input')).toHaveValue(CONTEXT_PROMPT);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('sends the displayed currency with the message and keeps the range display-only', async () => {
    const calls = setupSendingServer();
    renderWidget('/dashboard');
    act(() => {
      openAiChat({
        prompt: CONTEXT_PROMPT,
        assistantType: 'ANALYTICS',
        context: DASHBOARD_EXPENSE_CONTEXT,
      });
    });
    await screen.findByTestId('ai-chat-context');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('ai-chat-send'));

    expect(await screen.findByText('Đây là câu trả lời theo ngữ cảnh.')).toBeInTheDocument();
    expect(messageCalls(calls, 'c1', 'POST')).toHaveLength(1);
    // `dateRange` is not part of the assistant API contract.
    expect(messageCalls(calls, 'c1', 'POST')[0].body).toEqual({
      content: CONTEXT_PROMPT,
      currency: 'VND',
    });
  });

  it('drops the context once the question moves to another topic', async () => {
    const calls = setupSendingServer();
    renderWidget('/dashboard');
    act(() => {
      openAiChat({
        prompt: CONTEXT_PROMPT,
        assistantType: 'ANALYTICS',
        context: DASHBOARD_EXPENSE_CONTEXT,
      });
    });
    await screen.findByTestId('ai-chat-context');

    const user = userEvent.setup();
    const input = screen.getByTestId('ai-chat-input');
    await user.clear(input);
    await user.type(input, 'Làm sao để tăng thu nhập?');
    await user.click(screen.getByTestId('ai-chat-send'));

    expect(await screen.findByText('Đây là câu trả lời theo ngữ cảnh.')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-context')).not.toBeInTheDocument();
    expect(messageCalls(calls, 'c1', 'POST')[0].body).toEqual({
      content: 'Làm sao để tăng thu nhập?',
    });
  });

  it('lets the user remove the context before sending', async () => {
    setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidget('/dashboard');
    act(() => {
      openAiChat({
        prompt: CONTEXT_PROMPT,
        assistantType: 'ANALYTICS',
        context: DASHBOARD_EXPENSE_CONTEXT,
      });
    });
    await screen.findByTestId('ai-chat-context');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bỏ ngữ cảnh' }));

    expect(screen.queryByTestId('ai-chat-context')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-input')).toHaveValue(CONTEXT_PROMPT);
  });

  it('clears a stale context when the shell navigates to another page', async () => {
    setupServer((call) =>
      call.path === '/ai/conversations' ? json(paged([] as AiConversationDto[])) : json({}, 404),
    );
    renderWidgetWithNavigation('/dashboard');
    act(() => {
      openAiChat({
        prompt: CONTEXT_PROMPT,
        assistantType: 'ANALYTICS',
        context: DASHBOARD_EXPENSE_CONTEXT,
      });
    });
    await screen.findByTestId('ai-chat-context');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Đi tới ngân sách' }));

    await waitFor(() => {
      expect(screen.queryByTestId('ai-chat-context')).not.toBeInTheDocument();
    });
  });
});

describe('AiChatWidget — conversation continuity', () => {
  function setupExistingThread(assistantType: AiConversationDto['assistantType'] = 'ANALYTICS') {
    const stored = [userMessage('c1', 'Câu hỏi cũ')];
    const calls = setupServer((call) => {
      if (call.path === '/ai/conversations') {
        return json(paged([makeConversation({ assistantType })]));
      }
      if (call.path === '/ai/conversations/c1/messages') return json(paged(stored));
      return json({}, 404);
    });
    return calls;
  }

  it('keeps the open thread and its history when the assistant matches', async () => {
    const calls = setupExistingThread();
    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    act(() => {
      openAiChat({
        prompt: CONTEXT_PROMPT,
        assistantType: 'ANALYTICS',
        context: DASHBOARD_EXPENSE_CONTEXT,
      });
    });

    expect(await screen.findByTestId('ai-chat-context')).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-input')).toHaveValue(CONTEXT_PROMPT);
    expect(screen.getByText('Câu hỏi cũ')).toBeInTheDocument();
    expect(screen.getByText('Trợ lý phân tích · chỉ đọc')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-assistant-mismatch')).not.toBeInTheDocument();
    // A contextual entry never creates a conversation or overwrites history.
    expect(conversationCalls(calls, 'POST')).toHaveLength(0);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('offers an explicit choice when the page wants another assistant', async () => {
    const calls = setupExistingThread();
    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    act(() => {
      openAiChat({
        prompt: 'Giải thích tiến độ mục tiêu tiết kiệm của tôi.',
        assistantType: 'SAVINGS',
        context: {
          page: 'goals',
          feature: 'goal-progress',
          label: 'Tiến độ mục tiêu',
          currency: 'VND',
        },
      });
    });

    const notice = await screen.findByTestId('ai-chat-assistant-mismatch');
    expect(within(notice).getByText('Trợ lý phân tích')).toBeInTheDocument();
    expect(within(notice).getByText('Trợ lý tiết kiệm')).toBeInTheDocument();
    // The thread and its history are preserved until the user chooses.
    expect(screen.getByText('Câu hỏi cũ')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    await user.click(within(notice).getByRole('button', { name: 'Bắt đầu cuộc trò chuyện mới' }));

    expect(screen.queryByTestId('ai-chat-assistant-mismatch')).not.toBeInTheDocument();
    expect(screen.queryByText('Câu hỏi cũ')).not.toBeInTheDocument();
    expect(screen.getByText('Trợ lý tiết kiệm · chỉ đọc')).toBeInTheDocument();
    // Starting fresh keeps the prefilled question and the page context.
    expect(screen.getByTestId('ai-chat-input')).toHaveValue(
      'Giải thích tiến độ mục tiêu tiết kiệm của tôi.',
    );
    expect(screen.getByTestId('ai-chat-context')).toBeInTheDocument();
    expect(conversationCalls(calls, 'POST')).toHaveLength(0);
  });

  it('can keep the current assistant and dismiss the notice', async () => {
    setupExistingThread();
    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));
    await screen.findByText('Câu hỏi cũ');

    act(() => {
      openAiChat({
        prompt: 'Giải thích tiến độ mục tiêu tiết kiệm của tôi.',
        assistantType: 'SAVINGS',
      });
    });
    const notice = await screen.findByTestId('ai-chat-assistant-mismatch');

    await user.click(within(notice).getByRole('button', { name: 'Giữ cuộc trò chuyện này' }));

    expect(screen.queryByTestId('ai-chat-assistant-mismatch')).not.toBeInTheDocument();
    expect(screen.getByText('Câu hỏi cũ')).toBeInTheDocument();
    expect(screen.getByText('Trợ lý phân tích · chỉ đọc')).toBeInTheDocument();
  });
});

describe('AiChatWidget — chat errors', () => {
  it('explains a conversation that no longer exists', async () => {
    setupServer((call) => {
      if (call.path === '/ai/conversations') return json(paged([makeConversation()]));
      return json({ message: 'Not found' }, 404);
    });
    renderWidget();
    const user = await openWidget();
    await user.click(screen.getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await user.click(await screen.findByTestId('ai-conversation-item'));

    expect(
      await screen.findByText(
        'Cuộc trò chuyện không còn tồn tại. Hãy bắt đầu cuộc trò chuyện mới.',
      ),
    ).toBeInTheDocument();
  });
});
