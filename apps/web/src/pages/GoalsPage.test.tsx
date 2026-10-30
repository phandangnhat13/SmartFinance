import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ContributionHistoryDto,
  GoalContributionDto,
  GoalDto,
  GoalProgressDto,
  SavingsProgressDto,
  SavingsRecommendationItemDto,
  SavingsRecommendationsDto,
} from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayInTimeZone } from '../lib/date';
import { GoalsPage } from './GoalsPage';

// Recharts cannot measure a container in jsdom; the real chart is exercised by
// the browser E2E suite. Keep the DOM small and deterministic here.
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    Line: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

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

function makeRecommendationItem(
  overrides: Partial<SavingsRecommendationItemDto> = {},
): SavingsRecommendationItemDto {
  return {
    goalId: 'goal-1',
    goalName: 'Laptop mới',
    currency: 'VND',
    displayStatus: 'ACTIVE',
    targetDate: '2027-04-30',
    monthsRemaining: 6,
    remainingAmount: '12000000.00',
    requiredMonthlySaving: '2000000.00',
    recommendedMonthlySaving: '2000000.00',
    estimatedCompletionDate: '2027-04-30',
    feasibility: 'ON_TRACK',
    priority: 1,
    priorityReason: 'Hạn chót 2027-04-30; xếp theo thứ tự hạn gần nhất.',
    explanation: 'Đề xuất 2.000.000 VND/tháng để hoàn thành trước 2027-04-30.',
    ...overrides,
  };
}

function makeRecommendations(
  overrides: Partial<SavingsRecommendationsDto> = {},
): SavingsRecommendationsDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    status: 'available',
    capacity: {
      status: 'available',
      reason: null,
      currency: 'VND',
      monthsAnalyzed: 3,
      analyzedMonths: ['2026-07', '2026-08', '2026-09'],
      averageMonthlyIncome: '10000000.00',
      averageMonthlyExpense: '4000000.00',
      averageNetCashFlow: '6000000.00',
      historicalSavingsRate: 60,
      safetyBufferPercent: 20,
      safetyBufferAmount: '1200000.00',
      suggestedMonthlySaving: '4800000.00',
      isPositive: true,
      confidence: 'high',
    },
    monthlyBudget: '4800000.00',
    simulated: false,
    simulatedMonthlySaving: null,
    items: [
      makeRecommendationItem(),
      makeRecommendationItem({
        goalId: 'goal-2',
        goalName: 'Quỹ dự phòng',
        targetDate: '2027-12-30',
        monthsRemaining: 14,
        remainingAmount: '30000000.00',
        requiredMonthlySaving: '2500000.00',
        recommendedMonthlySaving: '2500000.00',
        estimatedCompletionDate: '2027-12-30',
        priority: 2,
        priorityReason: 'Hạn chót 2027-12-30; xếp theo thứ tự hạn gần nhất.',
      }),
    ],
    allocatedMonthly: '4500000.00',
    unallocatedMonthly: '300000.00',
    excluded: { paused: 0, completed: 0, archived: 0 },
    assumptions: ['Chỉ dùng tối đa 6 tháng đã kết thúc có giao dịch.'],
    limitations: ['Đây là gợi ý, không phải cam kết.'],
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
  let recommendations = makeRecommendations();
  let failGoals = false;

  function patchGoal(id: string, patch: Partial<GoalDto>): GoalDto {
    const index = state.findIndex((goal) => goal.id === id);
    if (index >= 0) state[index] = { ...state[index], ...patch };
    return state[index];
  }

  // Progress is computed by the API in production; these fixtures only echo the
  // goal rows so the page tests exercise the wiring, not the financial rules.
  function goalProgress(goal: GoalDto): GoalProgressDto {
    return {
      goalId: goal.id,
      name: goal.name,
      currency: goal.currency,
      status: goal.status,
      displayStatus: goal.displayStatus,
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      remainingAmount: goal.remainingAmount,
      completionPercentage: goal.percentage,
      startDate: goal.startDate,
      targetDate: goal.targetDate,
      monthsRemaining: goal.monthsRemaining,
      requiredMonthlySaving: goal.requiredMonthlySaving,
      expectedAmount: null,
      expectedPercentage: null,
      actualVsExpected: null,
      atRisk: null,
      aheadOfSchedule: null,
      pace: {
        monthsObserved: 1,
        averageMonthlyContribution: null,
        monthsToComplete: null,
        estimatedCompletionDate: null,
        projectedAmountAtDeadline: null,
        projectedHitsDeadline: null,
      },
      progressStatus: 'INSUFFICIENT_DATA',
      statusReason: 'Chưa đủ dữ liệu để so sánh với kế hoạch.',
      lastContributionAt: null,
      timeline: [],
    };
  }

  function savingsProgress(currency: string): SavingsProgressDto {
    const scoped = state.filter((goal) => goal.currency === currency && goal.status !== 'ARCHIVED');
    const archived = state.filter(
      (goal) => goal.currency === currency && goal.status === 'ARCHIVED',
    ).length;
    const totalTarget = scoped.reduce((total, goal) => total + Number(goal.targetAmount), 0);
    const totalSaved = scoped.reduce((total, goal) => total + Number(goal.savedAmount), 0);
    const totalRemaining = scoped.reduce((total, goal) => total + Number(goal.remainingAmount), 0);
    return {
      currency,
      timezone: 'Asia/Ho_Chi_Minh',
      today: '2026-10-30',
      generatedAt: '2026-10-30T03:00:00.000Z',
      asOf: '2026-10-30',
      summary: {
        currency,
        activeGoals: scoped.filter((goal) => goal.status === 'ACTIVE').length,
        onTrack: 0,
        atRisk: 0,
        overdue: scoped.filter((goal) => goal.displayStatus === 'OVERDUE').length,
        completed: scoped.filter((goal) => goal.status === 'COMPLETED').length,
        paused: scoped.filter((goal) => goal.status === 'PAUSED').length,
        insufficientData: scoped.length,
        totalTargetAmount: totalTarget.toFixed(2),
        totalSavedAmount: totalSaved.toFixed(2),
        totalRemainingAmount: totalRemaining.toFixed(2),
        overallPercentage: totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0,
      },
      goals: scoped.map(goalProgress),
      excluded: { archived },
      rules: ['Quy tắc phân loại tiến độ do máy chủ tính.'],
      limitations: ['Chỉ dùng dữ liệu thử trong bài kiểm thử này.'],
    };
  }

  function contributionHistory(goalId: string | null): ContributionHistoryDto {
    const goal = goalId ? state.find((item) => item.id === goalId) : undefined;
    return {
      currency: goal?.currency ?? 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      monthCount: 6,
      fromMonth: '2026-05',
      toMonth: '2026-10',
      goalId,
      openingAmount: '0.00',
      totalAmount: '0.00',
      totalCount: 0,
      months: [],
      items: [],
      truncated: false,
      limitations: [],
    };
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

      if (parsed.pathname.endsWith('/insights/savings-recommendations'))
        return json(recommendations);

      const goalProgressMatch = parsed.pathname.match(/\/savings\/progress\/([^/]+)$/);
      if (method === 'GET' && goalProgressMatch) {
        const goal = state.find((item) => item.id === goalProgressMatch[1]);
        if (!goal) return json({ statusCode: 404, code: 'NOT_FOUND', message: 'Không thấy' }, 404);
        return json(goalProgress(goal));
      }

      if (method === 'GET' && parsed.pathname.endsWith('/savings/progress')) {
        return json(savingsProgress(parsed.searchParams.get('currency') ?? 'VND'));
      }

      if (method === 'GET' && parsed.pathname.endsWith('/savings/contribution-history')) {
        return json(contributionHistory(parsed.searchParams.get('goalId')));
      }

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
    setRecommendations(next: SavingsRecommendationsDto) {
      recommendations = next;
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

describe('GoalsPage — list, progress and recommendations', () => {
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
    const summary = await screen.findByLabelText('Tổng quan tiến độ');
    expect(await within(summary).findByText(/30\.000\.000/)).toBeInTheDocument();
    expect(
      await within(summary).findByText(/Số liệu chỉ tính cho mục tiêu bằng VND/),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Lọc theo tiền tệ'), 'USD');

    await waitFor(() => expect(screen.queryByText('Mua laptop')).not.toBeInTheDocument());
    expect(screen.getByText('MacBook USD')).toBeInTheDocument();
    const usdSummary = screen.getByLabelText('Tổng quan tiến độ');
    expect(await within(usdSummary).findByText(/1\.000,00/)).toBeInTheDocument();
    expect(within(usdSummary).getByText(/250,00/)).toBeInTheDocument();
    expect(
      await within(usdSummary).findByText(/Số liệu chỉ tính cho mục tiêu bằng USD/),
    ).toBeInTheDocument();
  });

  it('shows the savings recommendation in the selected goal currency', async () => {
    const user = userEvent.setup();
    const server = createServer([
      makeGoal(),
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
    await screen.findByText('Laptop mới');
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(within(panel).getAllByText(/4\.800\.000/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/10\.000\.000/)).toBeInTheDocument();
    expect(within(panel).getAllByText(/3 tháng/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('Laptop mới')).toBeInTheDocument();
    expect(within(panel).getAllByText('Đúng tiến độ')).toHaveLength(2);
    expect(within(panel).getAllByText(/Hạn chót 2027-04-30/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/không tự tạo khoản góp hay sửa mục tiêu/)).toBeInTheDocument();
    expect(callsFor(server, 'GET', '/insights/savings-recommendations?currency=VND')).toHaveLength(
      1,
    );

    await user.selectOptions(screen.getByLabelText('Lọc theo tiền tệ'), 'USD');

    await waitFor(() =>
      expect(
        callsFor(server, 'GET', '/insights/savings-recommendations?currency=USD'),
      ).toHaveLength(1),
    );
  });

  it('shows the insufficient-data message when the currency has no completed months', async () => {
    const server = createServer([makeGoal()]);
    server.setRecommendations(
      makeRecommendations({
        status: 'insufficient_data',
        monthlyBudget: null,
        unallocatedMonthly: null,
        allocatedMonthly: '0.00',
        capacity: {
          ...makeRecommendations().capacity,
          status: 'insufficient_data',
          reason: 'no_complete_months',
          monthsAnalyzed: 0,
          analyzedMonths: [],
          averageMonthlyIncome: null,
          averageMonthlyExpense: null,
          averageNetCashFlow: null,
          historicalSavingsRate: null,
          safetyBufferAmount: null,
          suggestedMonthlySaving: null,
          isPositive: false,
          confidence: 'low',
        },
        items: [
          makeRecommendationItem({
            recommendedMonthlySaving: null,
            estimatedCompletionDate: null,
            feasibility: 'INSUFFICIENT_DATA',
          }),
        ],
      }),
    );
    renderPage();

    await screen.findByText('Mua laptop');
    await screen.findByText(/Chưa có tháng nào đã kết thúc với giao dịch VND/);
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(within(panel).getByText('Chưa đủ dữ liệu')).toBeInTheDocument();
    expect(within(panel).getByText(/Chưa có ngân sách để phân bổ/)).toBeInTheDocument();
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

    // Deleting asks through the shared ConfirmDialog instead of window.confirm.
    const confirm = await screen.findByRole('dialog', { name: 'Xoá khoản góp' });
    expect(callsFor(server, 'DELETE', '/goals/goal-1/contributions/c1')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Xoá khoản góp' }));

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
    // A paused goal changes the allocation, so the advice is refetched.
    await waitFor(() =>
      expect(
        callsFor(server, 'GET', '/insights/savings-recommendations').length,
      ).toBeGreaterThanOrEqual(2),
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
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(screen.getByRole('button', { name: 'Lưu trữ Mua laptop' }));

    const confirm = await screen.findByRole('dialog', { name: 'Lưu trữ mục tiêu' });
    await user.click(within(confirm).getByRole('button', { name: 'Lưu trữ' }));

    await waitFor(() => expect(callsFor(server, 'DELETE', '/goals/goal-1')).toHaveLength(1));
  });

  it('does not archive when the user cancels the confirmation', async () => {
    const user = userEvent.setup();
    const server = createServer([makeGoal()]);
    renderPage();

    await screen.findByText('Mua laptop');
    await user.click(screen.getByRole('button', { name: 'Lưu trữ Mua laptop' }));

    const confirm = await screen.findByRole('dialog', { name: 'Lưu trữ mục tiêu' });
    await user.click(within(confirm).getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByRole('dialog', { name: 'Lưu trữ mục tiêu' })).not.toBeInTheDocument();
    expect(callsFor(server, 'DELETE', '/goals/goal-1')).toHaveLength(0);
  });
});
