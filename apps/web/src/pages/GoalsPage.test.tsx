import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GoalContributionDto, GoalDto, InsightsMonthlyDto } from '@smart-finance/shared-types';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayInTimeZone } from '../lib/date';
import { GoalsPage } from './GoalsPage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', timezone: 'Asia/Ho_Chi_Minh', defaultCurrency: 'VND' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function contribution(overrides: Partial<GoalContributionDto> = {}): GoalContributionDto {
  return {
    id: 'contribution-1',
    amount: '2000000.00',
    contributedAt: '2026-10-20T03:00:00.000Z',
    note: null,
    ...overrides,
  };
}

function makeGoal(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: 'goal-1',
    name: 'Mua laptop',
    description: null,
    targetAmount: '30000000.00',
    savedAmount: '6000000.00',
    remainingAmount: '24000000.00',
    percentage: 20,
    currency: 'VND',
    startDate: '2026-10-01',
    targetDate: '2027-06-30',
    status: 'ACTIVE',
    displayStatus: 'ACTIVE',
    isOverdue: false,
    monthsRemaining: 8,
    requiredMonthlySaving: '3000000.00',
    contributions: [contribution()],
    ...overrides,
  };
}

function makeMonthly(overrides: Partial<InsightsMonthlyDto> = {}): InsightsMonthlyDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    estimated: false,
    months: [
      {
        month: '2026-09',
        monthStatus: 'complete',
        income: '10000000.00',
        expense: '4000000.00',
        net: '6000000.00',
        savingsRate: 60,
        transactionCount: 2,
        hasTransactions: true,
      },
      {
        month: '2026-10',
        monthStatus: 'in_progress',
        income: '20000000.00',
        expense: '5000000.00',
        net: '15000000.00',
        savingsRate: 75,
        transactionCount: 3,
        hasTransactions: true,
      },
    ],
    ...overrides,
  };
}

interface RecordedCall {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createServer(initialGoals: GoalDto[]) {
  const state = [...initialGoals];
  const calls: RecordedCall[] = [];
  let monthly = makeMonthly();
  let failGoals = false;

  function patchGoal(id: string, patch: Partial<GoalDto>): GoalDto {
    const index = state.findIndex((goal) => goal.id === id);
    if (index >= 0) state[index] = { ...state[index], ...patch };
    return state[index];
  }

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input.toString();
      const parsed = new URL(raw, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, url: `${parsed.pathname}${parsed.search}`, body });

      if (parsed.pathname.endsWith('/insights/monthly')) return json(monthly);

      if (method === 'GET' && parsed.pathname.endsWith('/goals')) {
        if (failGoals) {
          return json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500);
        }
        return json({ items: state });
      }

      if (method === 'POST' && parsed.pathname.endsWith('/goals')) {
        const created = makeGoal({
          id: 'goal-created',
          name: String(body?.name ?? 'Mới'),
          targetAmount: `${body?.targetAmount ?? '0'}.00`,
          savedAmount: '0.00',
          remainingAmount: `${body?.targetAmount ?? '0'}.00`,
          percentage: 0,
          startDate: String(body?.startDate ?? '2026-10-30'),
          targetDate: (body?.targetDate as string | undefined) ?? null,
          currency: String(body?.currency ?? 'VND'),
          contributions: [],
          requiredMonthlySaving: null,
        });
        state.push(created);
        return json({ goal: created }, 201);
      }

      const contributionMatch = parsed.pathname.match(
        /\/goals\/([^/]+)\/contributions(?:\/([^/]+))?$/,
      );
      if (contributionMatch) {
        const goal = state.find((item) => item.id === contributionMatch[1]);
        if (!goal) return json({ statusCode: 404, code: 'NOT_FOUND', message: 'Không thấy' }, 404);
        if (method === 'DELETE') {
          const remaining = goal.contributions.filter((item) => item.id !== contributionMatch[2]);
          patchGoal(goal.id, { contributions: remaining });
          return json({ goal: state[state.indexOf(goal)] });
        }
        return json({ goal });
      }

      const goalMatch = parsed.pathname.match(/\/goals\/([^/]+)$/);
      if (goalMatch) {
        const goal = state.find((item) => item.id === goalMatch[1]);
        if (!goal) return json({ statusCode: 404, code: 'NOT_FOUND', message: 'Không thấy' }, 404);
        if (method === 'PATCH' && body) {
          const status = body.status as GoalDto['status'] | undefined;
          const patch: Partial<GoalDto> = { ...body };
          if (status) {
            patch.status = status;
            patch.displayStatus = status;
            patch.requiredMonthlySaving = status === 'PAUSED' ? null : '0.00';
          }
          return json({ goal: patchGoal(goal.id, patch) });
        }
        if (method === 'DELETE') {
          return json({
            goal: patchGoal(goal.id, { status: 'ARCHIVED', displayStatus: 'ARCHIVED' }),
          });
        }
        return json({ goal });
      }

      throw new Error(`Unexpected request ${method} ${parsed.pathname}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    state,
    fetchMock,
    setMonthly(next: InsightsMonthlyDto) {
      monthly = next;
    },
    setFailGoals(value: boolean) {
      failGoals = value;
    },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GoalsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function goalCard(name: string): HTMLElement {
  // The same name can also appear in an open dialog title, so resolve the card
  // through the article ancestor instead of assuming a single text node.
  const card = screen
    .getAllByText(name)
    .map((element) => element.closest('article'))
    .find((element): element is HTMLElement => element !== null);
  if (!card) throw new Error(`No card found for ${name}`);
  return card;
}

function callsFor(server: ReturnType<typeof createServer>, method: string, fragment: string) {
  return server.calls.filter((call) => call.method === method && call.url.includes(fragment));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GoalsPage — loading, errors and empty state', () => {
  it('shows the loading state first', async () => {
    createServer([makeGoal()]);
    renderPage();

    expect(screen.getByText('Đang tải mục tiêu...')).toBeInTheDocument();
    expect(await screen.findByText('Mua laptop')).toBeInTheDocument();
  });

  it('shows the list error and recovers on retry', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    server.setFailGoals(true);
    renderPage();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    server.setFailGoals(false);
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Mua laptop')).toBeInTheDocument();
  });

  it('shows an empty state when the user has no goals', async () => {
    createServer([]);
    renderPage();

    expect(await screen.findByText('Chưa có mục tiêu')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lọc theo tiền tệ')).not.toBeInTheDocument();
  });
});

describe('GoalsPage — list, progress and reference figures', () => {
  it('renders progress, remaining amount, monthly target and status', async () => {
    createServer([
      makeGoal({
        name: 'Mua laptop',
        contributions: [contribution(), contribution({ id: 'contribution-2' })],
      }),
    ]);
    renderPage();

    const card = await waitFor(() => goalCard('Mua laptop'));
    expect(within(card).getByText(/6\.000\.000/)).toBeInTheDocument();
    expect(within(card).getByText(/30\.000\.000/)).toBeInTheDocument();
    expect(within(card).getByText(/20%/)).toBeInTheDocument();
    expect(within(card).getByText(/còn thiếu 24\.000\.000/)).toBeInTheDocument();
    expect(within(card).getByText(/Cần tiết kiệm 3\.000\.000/)).toBeInTheDocument();
    expect(within(card).getByText('Đang thực hiện')).toBeInTheDocument();
  });

  it('marks overdue and paused goals clearly and stops asking for savings', async () => {
    createServer([
      makeGoal({
        id: 'goal-overdue',
        name: 'Mục tiêu trễ',
        displayStatus: 'OVERDUE',
        isOverdue: true,
        targetDate: '2026-10-01',
        monthsRemaining: 0,
        requiredMonthlySaving: null,
      }),
      makeGoal({
        id: 'goal-paused',
        name: 'Mục tiêu dừng',
        status: 'PAUSED',
        displayStatus: 'PAUSED',
        requiredMonthlySaving: null,
      }),
    ]);
    renderPage();

    await screen.findByText('Mục tiêu trễ');
    const overdueCard = goalCard('Mục tiêu trễ');
    expect(within(overdueCard).getByText('Quá hạn')).toBeInTheDocument();
    expect(within(overdueCard).getByText(/Đã quá hạn/)).toBeInTheDocument();
    expect(within(overdueCard).queryByText(/Cần tiết kiệm/)).not.toBeInTheDocument();

    const pausedCard = goalCard('Mục tiêu dừng');
    expect(within(pausedCard).getByText('Tạm dừng')).toBeInTheDocument();
    expect(within(pausedCard).getByText(/Đang tạm dừng nên không yêu cầu/)).toBeInTheDocument();
    expect(within(pausedCard).queryByText(/Cần tiết kiệm/)).not.toBeInTheDocument();
  });

  it('summarises one currency at a time and never converts between currencies', async () => {
    const user = userEvent.setup();
    createServer([
      makeGoal({ id: 'goal-vnd', name: 'Mua laptop' }),
      makeGoal({
        id: 'goal-usd',
        name: 'MacBook USD',
        currency: 'USD',
        targetAmount: '1000.00',
        savedAmount: '250.00',
        remainingAmount: '750.00',
        percentage: 25,
        requiredMonthlySaving: null,
      }),
    ]);
    renderPage();

    await screen.findByText('Mua laptop');
    const summary = screen.getByLabelText('Tổng quan tiến độ');
    expect(within(summary).getByText(/30\.000\.000/)).toBeInTheDocument();
    expect(within(summary).getByText(/Số liệu chỉ tính cho mục tiêu bằng VND/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Lọc theo tiền tệ'), 'USD');

    await waitFor(() => expect(screen.queryByText('Mua laptop')).not.toBeInTheDocument());
    expect(screen.getByText('MacBook USD')).toBeInTheDocument();
    const usdSummary = screen.getByLabelText('Tổng quan tiến độ');
    expect(within(usdSummary).getByText(/1\.000,00/)).toBeInTheDocument();
    expect(within(usdSummary).getByText(/250,00/)).toBeInTheDocument();
    expect(
      within(usdSummary).getByText(/Số liệu chỉ tính cho mục tiêu bằng USD/),
    ).toBeInTheDocument();
  });

  it('shows reference income, expense, net cash flow and savings rate from insights', async () => {
    createServer([makeGoal()]);
    renderPage();

    await screen.findByText('Mua laptop');
    const panel = await screen.findByLabelText('Số liệu tham khảo');
    expect(within(panel).getByText(/15\.000\.000/)).toBeInTheDocument();
    expect(within(panel).getByText(/4\.500\.000/)).toBeInTheDocument();
    const netStat = within(panel).getByText('Dòng tiền ròng TB/tháng').parentElement;
    if (!netStat) throw new Error('Net cash flow stat is missing');
    expect(within(netStat).getByText(/10\.500\.000/)).toBeInTheDocument();
    expect(within(panel).getByText('70.0%')).toBeInTheDocument();
    expect(within(panel).getByText(/Khả năng tiết kiệm tham khảo/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/không được cộng tự động vào số tiền đã tiết kiệm/),
    ).toBeInTheDocument();
  });

  it('says when there is no insight data for the currency yet', async () => {
    const server = createServer([makeGoal()]);
    server.setMonthly(
      makeMonthly({
        months: [
          {
            month: '2026-10',
            monthStatus: 'in_progress',
            income: '0.00',
            expense: '0.00',
            net: '0.00',
            savingsRate: null,
            transactionCount: 0,
            hasTransactions: false,
          },
        ],
      }),
    );
    renderPage();

    await screen.findByText('Mua laptop');
    expect(
      await screen.findByText('Chưa có giao dịch VND để tính số liệu tham khảo.'),
    ).toBeInTheDocument();
  });
});

describe('GoalsPage — create and edit', () => {
  it('creates a goal with the entered data and no unknown fields', async () => {
    const user = userEvent.setup();
    const server = createServer([]);
    renderPage();

    await screen.findByText('Chưa có mục tiêu');
    await user.click(screen.getAllByRole('button', { name: /Thêm mục tiêu/ })[0]);

    await user.type(screen.getByLabelText('Tên mục tiêu'), 'Quỹ khẩn cấp');
    await user.type(screen.getByLabelText('Mô tả (tuỳ chọn)'), 'Dự phòng 6 tháng');
    await user.type(screen.getByLabelText('Số tiền mục tiêu'), '50000000');
    fireEvent.change(screen.getByLabelText('Ngày đích (tuỳ chọn)'), {
      target: { value: '2028-01-31' },
    });
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(callsFor(server, 'POST', '/goals')).toHaveLength(1));
    expect(callsFor(server, 'POST', '/goals')[0].body).toEqual({
      name: 'Quỹ khẩn cấp',
      targetAmount: '50000000',
      currency: 'VND',
      startDate: todayInTimeZone('Asia/Ho_Chi_Minh'),
      description: 'Dự phòng 6 tháng',
      targetDate: '2028-01-31',
    });
  });

  it('blocks a zero target and a deadline that is not after the start', async () => {
    const user = userEvent.setup();
    const server = createServer([]);
    renderPage();

    await screen.findByText('Chưa có mục tiêu');
    await user.click(screen.getAllByRole('button', { name: /Thêm mục tiêu/ })[0]);
    await user.type(screen.getByLabelText('Tên mục tiêu'), 'X');
    await user.type(screen.getByLabelText('Số tiền mục tiêu'), '0');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Số tiền phải lớn hơn 0')).toBeInTheDocument();
    expect(callsFor(server, 'POST', '/goals')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Số tiền mục tiêu'));
    await user.type(screen.getByLabelText('Số tiền mục tiêu'), '1000');
    fireEvent.change(screen.getByLabelText('Ngày bắt đầu'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Ngày đích (tuỳ chọn)'), {
      target: { value: '2026-11-01' },
    });
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Ngày đích phải sau ngày bắt đầu')).toBeInTheDocument();
    expect(callsFor(server, 'POST', '/goals')).toHaveLength(0);
  });

  it('edits an existing goal and refuses a target below the saved amount', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(screen.getByRole('button', { name: 'Sửa Mua laptop' }));
    expect(screen.getByLabelText('Tên mục tiêu')).toHaveValue('Mua laptop');
    expect(screen.getByLabelText('Số tiền mục tiêu')).toHaveValue('30000000.00');

    await user.clear(screen.getByLabelText('Tên mục tiêu'));
    await user.type(screen.getByLabelText('Tên mục tiêu'), 'Mua laptop mới');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(callsFor(server, 'PATCH', '/goals/goal-1')).toHaveLength(1));
    expect(callsFor(server, 'PATCH', '/goals/goal-1')[0].body).toMatchObject({
      name: 'Mua laptop mới',
      targetAmount: '30000000.00',
      description: '',
      targetDate: '2027-06-30',
    });

    await user.click(await screen.findByRole('button', { name: 'Sửa Mua laptop mới' }));
    await user.clear(screen.getByLabelText('Số tiền mục tiêu'));
    await user.type(screen.getByLabelText('Số tiền mục tiêu'), '1000000');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(
      await screen.findByText('Số tiền mục tiêu không được thấp hơn số đã tiết kiệm'),
    ).toBeInTheDocument();
    expect(callsFor(server, 'PATCH', '/goals/goal-1')).toHaveLength(1);
  });
});

describe('GoalsPage — contributions', () => {
  it('records a contribution with the local date converted to UTC', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal({ contributions: [] })]);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(within(goalCard('Mua laptop')).getByRole('button', { name: /Góp thêm/ }));
    await user.type(screen.getByLabelText('Số tiền'), '2000000');
    await user.click(screen.getByRole('button', { name: 'Ghi nhận' }));

    await waitFor(() =>
      expect(callsFor(server, 'POST', '/goals/goal-1/contributions')).toHaveLength(1),
    );
    const body = callsFor(server, 'POST', '/goals/goal-1/contributions')[0].body ?? {};
    expect(body.amount).toBe('2000000');
    expect(String(body.contributedAt)).toMatch(/T\d{2}:00:00\.000Z$/);
  });

  it('stops a contribution above the remaining amount before calling the API', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal({ contributions: [] })]);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(within(goalCard('Mua laptop')).getByRole('button', { name: /Góp thêm/ }));
    await user.type(screen.getByLabelText('Số tiền'), '30000000');
    await user.click(screen.getByRole('button', { name: 'Ghi nhận' }));

    expect(await screen.findByText(/Chỉ còn có thể góp/)).toBeInTheDocument();
    expect(callsFor(server, 'POST', '/goals/goal-1/contributions')).toHaveLength(0);
  });

  it('opens the detail view, edits and deletes a contribution', async () => {
    const user = userEvent.setup();
    const server = createServer([
      makeGoal({ contributions: [contribution({ id: 'c1', amount: '2000000.00' })] }),
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(within(goalCard('Mua laptop')).getByRole('button', { name: 'Chi tiết' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Còn thiếu')).toBeInTheDocument();
    expect(within(dialog).getByText('Cần tiết kiệm/tháng')).toBeInTheDocument();
    expect(within(dialog).getByText(/2\.000\.000/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Sửa khoản góp' }));
    expect(screen.getByLabelText('Số tiền')).toHaveValue('2000000.00');
    await user.clear(screen.getByLabelText('Số tiền'));
    await user.type(screen.getByLabelText('Số tiền'), '3000000');
    await user.clear(screen.getByLabelText('Ghi chú (tuỳ chọn)'));
    await user.type(screen.getByLabelText('Ghi chú (tuỳ chọn)'), 'Thưởng');
    await user.click(screen.getByRole('button', { name: 'Ghi nhận' }));

    await waitFor(() =>
      expect(callsFor(server, 'PATCH', '/goals/goal-1/contributions/c1')).toHaveLength(1),
    );
    expect(callsFor(server, 'PATCH', '/goals/goal-1/contributions/c1')[0].body).toMatchObject({
      amount: '3000000',
      note: 'Thưởng',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(within(goalCard('Mua laptop')).getByRole('button', { name: 'Chi tiết' }));
    const reopened = await screen.findByRole('dialog');
    await user.click(within(reopened).getByRole('button', { name: 'Xóa khoản góp' }));

    await waitFor(() =>
      expect(callsFor(server, 'DELETE', '/goals/goal-1/contributions/c1')).toHaveLength(1),
    );
  });
});

describe('GoalsPage — status changes and archiving', () => {
  it('pauses and resumes a goal from the detail view', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(within(goalCard('Mua laptop')).getByRole('button', { name: 'Chi tiết' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Tạm dừng/ }));

    await waitFor(() => expect(callsFor(server, 'PATCH', '/goals/goal-1')).toHaveLength(1));
    expect(callsFor(server, 'PATCH', '/goals/goal-1')[0].body).toEqual({ status: 'PAUSED' });
    await waitFor(() =>
      expect(within(goalCard('Mua laptop')).getByText('Tạm dừng')).toBeInTheDocument(),
    );

    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Tiếp tục/ }));
    await waitFor(() => expect(callsFor(server, 'PATCH', '/goals/goal-1')).toHaveLength(2));
    expect(callsFor(server, 'PATCH', '/goals/goal-1')[1].body).toEqual({ status: 'ACTIVE' });
  });

  it('marks an active goal as completed and offers no more savings once completed', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(within(goalCard('Mua laptop')).getByRole('button', { name: 'Chi tiết' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Hoàn thành/ }));

    await waitFor(() => expect(callsFor(server, 'PATCH', '/goals/goal-1')).toHaveLength(1));
    expect(callsFor(server, 'PATCH', '/goals/goal-1')[0].body).toEqual({ status: 'COMPLETED' });
  });

  it('archives a goal after confirmation', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(screen.getByRole('button', { name: 'Lưu trữ Mua laptop' }));

    await waitFor(() => expect(callsFor(server, 'DELETE', '/goals/goal-1')).toHaveLength(1));
  });

  it('does not archive when the user cancels the confirmation', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(screen.getByRole('button', { name: 'Lưu trữ Mua laptop' }));

    expect(callsFor(server, 'DELETE', '/goals/goal-1')).toHaveLength(0);
  });
});
