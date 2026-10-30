import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type {
  ContributionHistoryDto,
  GoalDto,
  GoalProgressDto,
  SavingsProgressStatus,
} from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalProgressPanel } from './GoalProgressPanel';

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

function makeGoal(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: 'goal-1',
    name: 'Mua laptop',
    description: null,
    targetAmount: '12000000.00',
    savedAmount: '6000000.00',
    remainingAmount: '6000000.00',
    percentage: 50,
    currency: 'VND',
    startDate: '2026-01-01',
    targetDate: '2027-06-30',
    status: 'ACTIVE',
    displayStatus: 'ACTIVE',
    isOverdue: false,
    monthsRemaining: 8,
    requiredMonthlySaving: '750000.00',
    contributions: [],
    ...overrides,
  };
}

function makeProgress(
  overrides: Partial<GoalProgressDto> = {},
  status: SavingsProgressStatus = 'ON_TRACK',
): GoalProgressDto {
  return {
    goalId: 'goal-1',
    name: 'Mua laptop',
    currency: 'VND',
    status: 'ACTIVE',
    displayStatus: 'ACTIVE',
    targetAmount: '12000000.00',
    savedAmount: '6000000.00',
    remainingAmount: '6000000.00',
    completionPercentage: 50,
    startDate: '2026-01-01',
    targetDate: '2027-06-30',
    monthsRemaining: 8,
    requiredMonthlySaving: '750000.00',
    expectedAmount: '9000000.00',
    expectedPercentage: 75,
    actualVsExpected: '-3000000.00',
    atRisk: true,
    aheadOfSchedule: false,
    pace: {
      monthsObserved: 10,
      averageMonthlyContribution: '600000.00',
      monthsToComplete: 10,
      estimatedCompletionDate: '2027-06-02',
      projectedAmountAtDeadline: '10800000.00',
      projectedHitsDeadline: false,
    },
    progressStatus: status,
    statusReason: 'Chậm hơn kế hoạch một khoản góp.',
    lastContributionAt: '2026-10-20T03:00:00.000Z',
    timeline: [
      { month: '2026-09', actualSaved: '5000000.00', expectedSaved: '7500000.00' },
      { month: '2026-10', actualSaved: '6000000.00', expectedSaved: '9000000.00' },
    ],
    ...overrides,
  };
}

function makeHistory(overrides: Partial<ContributionHistoryDto> = {}): ContributionHistoryDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    monthCount: 2,
    fromMonth: '2026-09',
    toMonth: '2026-10',
    goalId: 'goal-1',
    openingAmount: '4000000.00',
    totalAmount: '2000000.00',
    totalCount: 2,
    months: [
      { month: '2026-09', amount: '1500000.00', count: 1, cumulativeAmount: '5500000.00' },
      { month: '2026-10', amount: '500000.00', count: 1, cumulativeAmount: '6000000.00' },
    ],
    items: [
      {
        id: 'c-2',
        goalId: 'goal-1',
        goalName: 'Mua laptop',
        amount: '500000.00',
        contributedAt: '2026-10-20T03:00:00.000Z',
        note: 'Thưởng',
      },
      {
        id: 'c-1',
        goalId: 'goal-1',
        goalName: 'Mua laptop',
        amount: '1500000.00',
        contributedAt: '2026-09-10T03:00:00.000Z',
        note: null,
      },
    ],
    truncated: false,
    limitations: ['Chỉ tính các khoản góp trong 6 tháng gần nhất.'],
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
  options: {
    progress?: GoalProgressDto;
    history?: ContributionHistoryDto;
    progressError?: boolean;
  } = {},
) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input.toString();
      const url = new URL(raw, 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      urls.push(`${path}${url.search}`);
      if (path.startsWith('/savings/progress/')) {
        return options.progressError
          ? json({ statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục tiêu' }, 404)
          : json(options.progress ?? makeProgress());
      }
      if (path.startsWith('/savings/contribution-history')) {
        return json(options.history ?? makeHistory());
      }
      throw new Error(`Unexpected request ${path}`);
    }),
  );
  return { urls };
}

function renderPanel(goal = makeGoal(), onChanged = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GoalProgressPanel goal={goal} onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onChanged };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GoalProgressPanel', () => {
  it('shows the actual versus expected figures computed by the API', async () => {
    const server = setupServer();
    renderPanel();

    expect(await screen.findByText('Đúng tiến độ')).toBeInTheDocument();
    expect(screen.getByText('Chậm hơn kế hoạch một khoản góp.')).toBeInTheDocument();
    expect(screen.getByText('9.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('-3.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('Đang chậm hơn kế hoạch')).toBeInTheDocument();
    expect(screen.getByText('600.000 ₫/tháng')).toBeInTheDocument();
    expect(screen.getByText('02/06/2027')).toBeInTheDocument();
    expect(server.urls).toContain('/savings/progress/goal-1');
    expect(server.urls).toContain('/savings/contribution-history?goalId=goal-1&months=6');
  });

  it('renders the monthly history with a cumulative total', async () => {
    setupServer();
    renderPanel();

    await screen.findByText('Thực tế so với kế hoạch');
    const table = screen.getByRole('table', {
      name: /Số tiền đã góp theo từng tháng/,
    });
    expect(within(table).getByText('2026-09')).toBeInTheDocument();
    expect(within(table).getByText('1.500.000 ₫')).toBeInTheDocument();
    expect(within(table).getByText('5.500.000 ₫')).toBeInTheDocument();
    expect(within(table).getByText('6.000.000 ₫')).toBeInTheDocument();
    expect(screen.getAllByText(/20\/10\/2026/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/· Thưởng/)).toBeInTheDocument();
  });

  it('offers the read-only simulator for an active goal', async () => {
    setupServer();
    renderPanel();

    expect(await screen.findByLabelText('Mô phỏng kế hoạch')).toBeInTheDocument();
    expect(screen.getByText(/không có khoản góp nào được tạo/)).toBeInTheDocument();
  });

  it('never offers to simulate an archived goal', async () => {
    setupServer();
    renderPanel(makeGoal({ status: 'ARCHIVED', displayStatus: 'ARCHIVED' }));

    expect(
      await screen.findByText(/Mục tiêu đã lưu trữ nên không thể mô phỏng/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Mô phỏng kế hoạch')).not.toBeInTheDocument();
  });

  it('shows the API error when the goal is not accessible', async () => {
    setupServer({ progressError: true });
    renderPanel();

    expect(await screen.findByText('Không tìm thấy mục tiêu')).toBeInTheDocument();
    expect(screen.queryByText('Thực tế so với kế hoạch')).not.toBeInTheDocument();
  });

  it('explains a goal with no deadline instead of inventing figures', async () => {
    setupServer({
      progress: makeProgress(
        {
          targetDate: null,
          monthsRemaining: null,
          requiredMonthlySaving: null,
          expectedAmount: null,
          expectedPercentage: null,
          actualVsExpected: null,
          atRisk: null,
          aheadOfSchedule: null,
          pace: {
            monthsObserved: 3,
            averageMonthlyContribution: null,
            monthsToComplete: null,
            estimatedCompletionDate: null,
            projectedAmountAtDeadline: null,
            projectedHitsDeadline: null,
          },
        },
        'INSUFFICIENT_DATA',
      ),
    });
    renderPanel(makeGoal({ targetDate: null, monthsRemaining: null }));

    expect(await screen.findByText('Chưa đủ dữ liệu')).toBeInTheDocument();
    expect(screen.getByText('Mục tiêu chưa có ngày đích')).toBeInTheDocument();
    expect(screen.getByText('Cần thêm dữ liệu khoản góp')).toBeInTheDocument();
  });
});
