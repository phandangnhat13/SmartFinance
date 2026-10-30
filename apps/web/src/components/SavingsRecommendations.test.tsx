import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  SavingsRecommendationItemDto,
  SavingsRecommendationsDto,
} from '@smart-finance/shared-types';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavingsRecommendations } from './SavingsRecommendations';

function makeItem(
  overrides: Partial<SavingsRecommendationItemDto> = {},
): SavingsRecommendationItemDto {
  return {
    goalId: 'goal-1',
    goalName: 'Mua laptop',
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
      makeItem(),
      makeItem({
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
        explanation: 'Đề xuất 2.500.000 VND/tháng để hoàn thành trước 2027-12-30.',
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
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupServer(respond: (url: URL) => Response = () => json(makeRecommendations())): {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: `${url.pathname}${url.search}`,
    });
    return respond(url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

function renderSection(currency = 'VND') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SavingsRecommendations currency={currency} timezone="Asia/Ho_Chi_Minh" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SavingsRecommendations — states', () => {
  it('shows a loading state before the advice arrives', async () => {
    setupServer();
    renderSection();

    expect(screen.getByText('Đang tính đề xuất tiết kiệm...')).toBeInTheDocument();
    expect(await screen.findByText('Mua laptop')).toBeInTheDocument();
  });

  it('shows the API error and recovers on retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    setupServer(() => {
      calls += 1;
      return calls === 1
        ? json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500)
        : json(makeRecommendations());
    });
    renderSection();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Mua laptop')).toBeInTheDocument();
  });

  it('renders the capacity, the months used and the safety buffer', async () => {
    setupServer();
    renderSection();

    await screen.findByText('Mua laptop');
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(within(panel).getAllByText(/4\.800\.000/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/10\.000\.000/)).toBeInTheDocument();
    expect(within(panel).getByText(/4\.000\.000/)).toBeInTheDocument();
    expect(within(panel).getByText('3 tháng')).toBeInTheDocument();
    expect(within(panel).getByText('2026-07, 2026-08, 2026-09')).toBeInTheDocument();
    expect(within(panel).getByText('Độ tin cậy cao')).toBeInTheDocument();
    expect(within(panel).getByText(/dự phòng an toàn/)).toBeInTheDocument();
    expect(within(panel).getByText(/1\.200\.000/)).toBeInTheDocument();
  });

  it('lists every goal with its allocation, feasibility and priority reason', async () => {
    setupServer();
    renderSection();

    await screen.findByText('Mua laptop');
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(within(panel).getByText('Mua laptop')).toBeInTheDocument();
    expect(within(panel).getByText('Quỹ dự phòng')).toBeInTheDocument();
    expect(within(panel).getAllByText('Đúng tiến độ')).toHaveLength(2);
    expect(within(panel).getAllByText(/Hạn chót 2027-04-30/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/Dự kiến hoàn thành/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/xếp theo thứ tự hạn gần nhất/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/Ngân sách/)).toBeInTheDocument();
  });

  it('warns about a goal that is at risk or not feasible', async () => {
    setupServer(() =>
      json(
        makeRecommendations({
          items: [
            makeItem({ recommendedMonthlySaving: '1000000.00', feasibility: 'AT_RISK' }),
            makeItem({
              goalId: 'goal-2',
              goalName: 'Quỹ dự phòng',
              recommendedMonthlySaving: '0.00',
              estimatedCompletionDate: null,
              feasibility: 'NOT_FEASIBLE',
              priority: 2,
            }),
          ],
        }),
      ),
    );
    renderSection();

    await screen.findByText('Mua laptop');
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(within(panel).getByText('Có nguy cơ trễ hạn')).toBeInTheDocument();
    expect(
      within(panel).getByText(/thấp hơn mức cần thiết nên mục tiêu này có thể trễ hạn/),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Không khả thi')).toBeInTheDocument();
    expect(within(panel).getByText(/khó có thể hoàn thành đúng hạn/)).toBeInTheDocument();
  });

  it('explains an infeasible cash flow instead of inventing a capacity', async () => {
    setupServer(() =>
      json(
        makeRecommendations({
          status: 'no_capacity',
          monthlyBudget: '0.00',
          unallocatedMonthly: '0.00',
          capacity: {
            ...makeRecommendations().capacity,
            status: 'no_capacity',
            averageNetCashFlow: '-1000000.00',
            suggestedMonthlySaving: '0.00',
            safetyBufferAmount: '0.00',
            isPositive: false,
            confidence: 'medium',
          },
          items: [
            makeItem({
              recommendedMonthlySaving: '0.00',
              estimatedCompletionDate: null,
              feasibility: 'NOT_FEASIBLE',
            }),
          ],
        }),
      ),
    );
    renderSection();

    await screen.findByText('Mua laptop');
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(
      within(panel).getByText(/không dương, nên hiện chưa thể đề xuất mức tiết kiệm/),
    ).toBeInTheDocument();
  });

  it('shows the insufficient-data message with no fabricated numbers', async () => {
    setupServer(() =>
      json(
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
            makeItem({
              recommendedMonthlySaving: null,
              estimatedCompletionDate: null,
              feasibility: 'INSUFFICIENT_DATA',
            }),
          ],
        }),
      ),
    );
    renderSection();

    await screen.findByText('Mua laptop');
    const panel = screen.getByLabelText('Đề xuất tiết kiệm');
    expect(
      within(panel).getByText(/Chưa có tháng nào đã kết thúc với giao dịch VND/),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Chưa đủ dữ liệu')).toBeInTheDocument();
    expect(within(panel).getByText(/Chưa có ngân sách để phân bổ/)).toBeInTheDocument();
    expect(within(panel).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('asks for the given currency only', async () => {
    const { calls } = setupServer(() => json(makeRecommendations({ currency: 'USD' })));
    renderSection('USD');

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe('/api/v1/insights/savings-recommendations?currency=USD');
  });
});

describe('SavingsRecommendations — simulation', () => {
  function simulatedRespond(url: URL): Response {
    if (url.searchParams.get('assumedMonthlySaving') === '3000000') {
      return json(
        makeRecommendations({
          simulated: true,
          simulatedMonthlySaving: '3000000.00',
          monthlyBudget: '3000000.00',
          allocatedMonthly: '3000000.00',
          unallocatedMonthly: '0.00',
          items: [
            makeItem(),
            makeItem({
              goalId: 'goal-2',
              goalName: 'Quỹ dự phòng',
              recommendedMonthlySaving: '1000000.00',
              feasibility: 'AT_RISK',
              priority: 2,
            }),
          ],
        }),
      );
    }
    return json(makeRecommendations());
  }

  it('re-runs the allocation for the assumed amount and says nothing is recorded', async () => {
    const user = userEvent.setup();
    const { calls } = setupServer(simulatedRespond);
    renderSection();

    await screen.findByText('Mua laptop');
    await user.type(screen.getByLabelText('Mức tiết kiệm giả định mỗi tháng'), '3000000');
    await user.click(screen.getByRole('button', { name: 'Mô phỏng' }));

    expect(await screen.findByText(/Đang mô phỏng với/)).toBeInTheDocument();
    expect(screen.getByText(/không mục tiêu hay khoản góp nào được ghi lại/)).toBeInTheDocument();
    expect(screen.getByText('Có nguy cơ trễ hạn')).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('assumedMonthlySaving=3000000'))).toBe(true);
    // The section only ever reads; it never writes a goal or a contribution.
    expect(calls.every((call) => call.method === 'GET')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Bỏ mô phỏng' }));
    await waitFor(() => expect(screen.queryByText(/Đang mô phỏng với/)).not.toBeInTheDocument());
    expect(calls.at(-1)?.url).toBe('/api/v1/insights/savings-recommendations?currency=VND');
  });

  it('refuses an invalid simulated amount without calling the API again', async () => {
    const user = userEvent.setup();
    const { calls } = setupServer();
    renderSection();

    await screen.findByText('Mua laptop');
    await user.type(screen.getByLabelText('Mức tiết kiệm giả định mỗi tháng'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Mô phỏng' }));

    expect(
      await screen.findByText('Nhập số tiền lớn hơn 0, tối đa 2 chữ số thập phân'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });
});
