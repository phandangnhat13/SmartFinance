import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavingsProgressDto } from '@smart-finance/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavingsProgressDashboard } from './SavingsProgressDashboard';

function makeProgress(overrides: Partial<SavingsProgressDto> = {}): SavingsProgressDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    today: '2026-10-30',
    generatedAt: '2026-10-30T03:00:00.000Z',
    asOf: '2026-10-30',
    summary: {
      currency: 'VND',
      activeGoals: 3,
      onTrack: 2,
      atRisk: 1,
      overdue: 0,
      completed: 1,
      paused: 0,
      insufficientData: 0,
      totalTargetAmount: '30000000.00',
      totalSavedAmount: '6000000.00',
      totalRemainingAmount: '24000000.00',
      overallPercentage: 20,
    },
    goals: [],
    excluded: { archived: 0 },
    rules: ['Mục tiêu hoàn thành được xếp trước.'],
    limitations: ['Chỉ tính cho một loại tiền tệ.'],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupServer(respond: (url: URL) => Response) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input.toString();
      const url = new URL(raw, 'http://localhost');
      urls.push(`${url.pathname.replace(/^\/api\/v1/, '')}${url.search}`);
      return respond(url);
    }),
  );
  return { urls };
}

function renderDashboard(currency = 'VND') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SavingsProgressDashboard currency={currency} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SavingsProgressDashboard', () => {
  it('shows the loading state and then the server totals for one currency', async () => {
    const server = setupServer(() => json(makeProgress()));
    renderDashboard();

    expect(screen.getByText('Đang tính tiến độ tiết kiệm...')).toBeInTheDocument();
    expect(await screen.findByText('30.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('6.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('24.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText(/Số liệu chỉ tính cho mục tiêu bằng VND/)).toBeInTheDocument();
    expect(server.urls).toEqual(['/savings/progress?currency=VND']);
  });

  it('renders the status counts, the archived note and the rules', async () => {
    setupServer(() => json(makeProgress({ excluded: { archived: 2 } })));
    renderDashboard();

    expect(await screen.findByText('Đúng tiến độ: 2')).toBeInTheDocument();
    expect(screen.getByText('Chậm tiến độ: 1')).toBeInTheDocument();
    expect(screen.getByText('Hoàn thành: 1')).toBeInTheDocument();
    expect(screen.queryByText(/Quá hạn:/)).not.toBeInTheDocument();
    expect(screen.getByText('Đã ẩn 2 mục tiêu lưu trữ khỏi tổng quan.')).toBeInTheDocument();
    expect(screen.getByText('Mục tiêu hoàn thành được xếp trước.')).toBeInTheDocument();
  });

  it('never converts: USD figures keep their own currency', async () => {
    const server = setupServer(() =>
      json(
        makeProgress({
          currency: 'USD',
          summary: {
            ...makeProgress().summary,
            currency: 'USD',
            totalTargetAmount: '1000.00',
            totalSavedAmount: '250.00',
            totalRemainingAmount: '750.00',
            overallPercentage: 25,
          },
        }),
      ),
    );
    renderDashboard('USD');

    expect(await screen.findByText('1.000,00 US$')).toBeInTheDocument();
    expect(screen.getByText('250,00 US$')).toBeInTheDocument();
    expect(screen.getByText('750,00 US$')).toBeInTheDocument();
    expect(screen.getByText(/Số liệu chỉ tính cho mục tiêu bằng USD/)).toBeInTheDocument();
    expect(server.urls).toEqual(['/savings/progress?currency=USD']);
  });

  it('explains the empty currency instead of inventing figures', async () => {
    setupServer(() =>
      json(
        makeProgress({
          summary: {
            ...makeProgress().summary,
            activeGoals: 0,
            onTrack: 0,
            atRisk: 0,
            completed: 0,
            totalTargetAmount: '0.00',
            totalSavedAmount: '0.00',
            totalRemainingAmount: '0.00',
            overallPercentage: 0,
          },
        }),
      ),
    );
    renderDashboard();

    expect(
      await screen.findByText(/Chưa có mục tiêu nào đang theo dõi trong tiền tệ này/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Đúng tiến độ:/)).not.toBeInTheDocument();
  });

  it('shows the API error and refetches on retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    setupServer(() => {
      calls += 1;
      return calls === 1
        ? json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500)
        : json(makeProgress());
    });
    renderDashboard();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('30.000.000 ₫')).toBeInTheDocument();
  });
});
