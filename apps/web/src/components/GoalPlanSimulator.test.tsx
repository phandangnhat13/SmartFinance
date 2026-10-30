import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AdjustmentPreviewDto,
  GoalDto,
  GoalProgressDto,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalPlanSimulator } from './GoalPlanSimulator';

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

function makeProgress(overrides: Partial<GoalProgressDto> = {}): GoalProgressDto {
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
    progressStatus: 'AT_RISK',
    statusReason: 'Chậm hơn kế hoạch một khoản góp.',
    lastContributionAt: '2026-10-20T03:00:00.000Z',
    timeline: [],
    ...overrides,
  };
}

function makeSimulation(overrides: Partial<SingleGoalSimulationDto> = {}): SingleGoalSimulationDto {
  return {
    scenario: 'MONTHLY_AMOUNT',
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-30T03:00:00.000Z',
    goalId: 'goal-1',
    goalName: 'Mua laptop',
    current: {
      targetAmount: '12000000.00',
      savedAmount: '6000000.00',
      remainingAmount: '6000000.00',
      completionPercentage: 50,
      targetDate: '2027-06-30',
      monthsRemaining: 8,
      requiredMonthlySaving: '750000.00',
      monthlySaving: null,
      monthsToComplete: null,
      estimatedCompletionDate: null,
      deadlineMet: null,
    },
    simulated: {
      targetAmount: '12000000.00',
      savedAmount: '6000000.00',
      remainingAmount: '6000000.00',
      completionPercentage: 50,
      targetDate: '2027-06-30',
      monthsRemaining: 8,
      requiredMonthlySaving: '750000.00',
      monthlySaving: '2000000.00',
      monthsToComplete: 3,
      estimatedCompletionDate: '2027-01-31',
      deadlineMet: true,
    },
    difference: {
      targetAmount: '0.00',
      remainingAmount: '0.00',
      requiredMonthlySaving: '0.00',
      monthlySaving: null,
      completionDateShiftMonths: null,
    },
    capacity: { available: true, monthlySaving: '4000000.00', requiredWithinCapacity: true },
    feasibility: 'FEASIBLE',
    feasibilityReason: 'Với 2.000.000 ₫/tháng, mục tiêu hoàn thành trước hạn.',
    warnings: ['Chưa tính lãi suất.'],
    limitations: ['Mô phỏng chỉ đọc.'],
    ...overrides,
  };
}

function makePreview(overrides: Partial<AdjustmentPreviewDto> = {}): AdjustmentPreviewDto {
  return {
    goalId: 'goal-1',
    goalName: 'Mua laptop',
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    changes: [{ field: 'targetDate', oldValue: '2027-06-30', newValue: '2028-06-30' }],
    problems: [],
    warnings: ['Ngày đích mới xa hơn kế hoạch ban đầu.'],
    current: makeProgress(),
    projected: makeProgress({ targetDate: '2028-06-30', monthsRemaining: 20 }),
    canApply: true,
    ...overrides,
  };
}

interface RecordedCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
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

function renderSimulator(onApplied = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GoalPlanSimulator goal={makeGoal()} timezone="Asia/Ho_Chi_Minh" onApplied={onApplied} />
    </QueryClientProvider>,
  );
  return { onApplied };
}

function postCalls(calls: RecordedCall[], fragment: string) {
  return calls.filter((call) => call.method === 'POST' && call.path.includes(fragment));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GoalPlanSimulator — read-only simulation', () => {
  it('simulates a monthly amount and never writes', async () => {
    const user = userEvent.setup();
    const server = setupServer(() => json(makeSimulation()));
    renderSimulator();

    await user.type(screen.getByLabelText('Số tiền góp mỗi tháng'), '2000000');
    await user.click(screen.getByRole('button', { name: /Mô phỏng/ }));

    expect(await screen.findByText('Hiện tại so với giả định')).toBeInTheDocument();
    expect(postCalls(server.calls, '/savings/simulations')).toHaveLength(1);
    expect(postCalls(server.calls, '/savings/simulations')[0].body).toEqual({
      scenario: 'MONTHLY_AMOUNT',
      goalId: 'goal-1',
      monthlyAmount: '2000000',
    });
    expect(screen.getByText('Khả thi')).toBeInTheDocument();
    expect(
      screen.getByText('Với 2.000.000 ₫/tháng, mục tiêu hoàn thành trước hạn.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chưa tính lãi suất.')).toBeInTheDocument();
    expect(
      screen.getByText(/chỉ có thể áp dụng thay đổi ngày đích hoặc số tiền mục tiêu/),
    ).toBeInTheDocument();
    expect(postCalls(server.calls, '/savings/adjustments')).toHaveLength(0);
  });

  it('blocks a monthly amount that is zero or not a money value', async () => {
    const user = userEvent.setup();
    const server = setupServer(() => json(makeSimulation()));
    renderSimulator();

    await user.type(screen.getByLabelText('Số tiền góp mỗi tháng'), '0');
    await user.click(screen.getByRole('button', { name: /Mô phỏng/ }));

    expect(
      screen.getByText('Nhập mức góp lớn hơn 0, tối đa 2 chữ số thập phân'),
    ).toBeInTheDocument();
    expect(server.calls).toHaveLength(0);
  });

  it('shows the API error when the simulation is rejected', async () => {
    const user = userEvent.setup();
    setupServer(() =>
      json({ statusCode: 400, code: 'BAD_REQUEST', message: 'Mục tiêu đã lưu trữ' }, 400),
    );
    renderSimulator();

    await user.type(screen.getByLabelText('Số tiền góp mỗi tháng'), '2000000');
    await user.click(screen.getByRole('button', { name: /Mô phỏng/ }));

    expect(await screen.findByText('Mục tiêu đã lưu trữ')).toBeInTheDocument();
    expect(screen.queryByText('Hiện tại so với giả định')).not.toBeInTheDocument();
  });
});

describe('GoalPlanSimulator — adjustment', () => {
  it('previews, confirms and applies only the deadline', async () => {
    const user = userEvent.setup();
    const server = setupServer((method, path) => {
      if (path.endsWith('/savings/simulations'))
        return json(makeSimulation({ scenario: 'DEADLINE' }));
      if (path.endsWith('/savings/adjustments/preview')) return json(makePreview());
      if (path.endsWith('/savings/adjustments/apply'))
        return json({ goal: makeGoal({ targetDate: '2028-06-30' }), progress: makeProgress() });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const { onApplied } = renderSimulator();

    await user.click(screen.getByRole('tab', { name: 'Ngày đích' }));
    fireEvent.change(screen.getByLabelText('Ngày đích mới'), {
      target: { value: '2028-06-30' },
    });
    await user.click(screen.getByRole('button', { name: /Mô phỏng/ }));

    expect(postCalls(server.calls, '/savings/simulations')[0].body).toEqual({
      scenario: 'DEADLINE',
      goalId: 'goal-1',
      targetDate: '2028-06-30',
    });

    await user.click(await screen.findByRole('button', { name: 'Xem trước thay đổi' }));

    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh mục tiêu' });
    expect(postCalls(server.calls, '/savings/adjustments/preview')[0].body).toEqual({
      goalId: 'goal-1',
      targetDate: '2028-06-30',
    });
    expect(within(dialog).getByText(/30\/06\/2027/)).toBeInTheDocument();
    expect(within(dialog).getByText(/30\/06\/2028/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Các khoản góp đã ghi nhận không thay đổi/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Ngày đích mới xa hơn kế hoạch ban đầu.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận áp dụng' }));

    await waitFor(() =>
      expect(postCalls(server.calls, '/savings/adjustments/apply')).toHaveLength(1),
    );
    expect(postCalls(server.calls, '/savings/adjustments/apply')[0].body).toEqual({
      goalId: 'goal-1',
      targetDate: '2028-06-30',
    });
    expect(
      await screen.findByText('Đã cập nhật mục tiêu. Các khoản góp đã ghi nhận được giữ nguyên.'),
    ).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the confirm button disabled when the preview is not applicable', async () => {
    const user = userEvent.setup();
    setupServer((_method, path) => {
      if (path.endsWith('/savings/simulations'))
        return json(makeSimulation({ scenario: 'TARGET_AMOUNT' }));
      if (path.endsWith('/savings/adjustments/preview'))
        return json(
          makePreview({
            changes: [{ field: 'targetAmount', oldValue: '12000000.00', newValue: '7000000.00' }],
            problems: ['Số tiền mục tiêu không hợp lệ với kế hoạch hiện tại.'],
            warnings: [],
            canApply: false,
          }),
        );
      throw new Error(`Unexpected ${path}`);
    });
    renderSimulator();

    await user.click(screen.getByRole('tab', { name: 'Số tiền mục tiêu' }));
    await user.type(screen.getByLabelText('Số tiền mục tiêu mới'), '7000000');
    await user.click(screen.getByRole('button', { name: /Mô phỏng/ }));
    await user.click(await screen.findByRole('button', { name: 'Xem trước thay đổi' }));

    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh mục tiêu' });
    expect(
      within(dialog).getByText('Số tiền mục tiêu không hợp lệ với kế hoạch hiện tại.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Xác nhận áp dụng' })).toBeDisabled();
  });

  it('refuses a new target below what has been saved before calling the API', async () => {
    const user = userEvent.setup();
    const server = setupServer(() => json(makeSimulation()));
    renderSimulator();

    await user.click(screen.getByRole('tab', { name: 'Số tiền mục tiêu' }));
    await user.type(screen.getByLabelText('Số tiền mục tiêu mới'), '1000000');
    await user.click(screen.getByRole('button', { name: /Mô phỏng/ }));

    expect(
      screen.getByText('Số tiền mục tiêu không được thấp hơn số đã tiết kiệm'),
    ).toBeInTheDocument();
    expect(server.calls).toHaveLength(0);
  });
});
