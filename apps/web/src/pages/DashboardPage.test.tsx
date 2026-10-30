import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AnalyticsSummaryDto,
  BudgetProgressDto,
  ComparisonDto,
  PaginatedDto,
  SpendingAlertDto,
  TransactionDto,
} from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CHAT_OPEN_EVENT, type AiChatOpenDetail } from '../lib/ai-chat-events';
import { DashboardPage } from './DashboardPage';

// Recharts cannot measure a container in jsdom; the real chart is covered by
// the Playwright suite. Keeping the tree small makes the text easy to assert.
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    // The gradient definitions are raw SVG children; dropping the chart keeps
    // jsdom from warning about their casing. The real chart runs in Playwright.
    AreaChart: () => null,
    Area: () => null,
    CartesianGrid: () => null,
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

function makeSummary(overrides: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    from: '2025-01-01',
    to: '2025-01-31',
    income: '5000000.00',
    expense: '2300000.00',
    net: '2700000.00',
    transactionCount: 3,
    ...overrides,
  };
}

function makeComparison(): ComparisonDto {
  return {
    current: makeSummary(),
    previous: makeSummary({
      income: '4000000.00',
      expense: '2000000.00',
      net: '2000000.00',
      transactionCount: 2,
    }),
    incomeChangePercent: 25,
    expenseChangePercent: 15,
  };
}

function makeBudget(overrides: Partial<BudgetProgressDto> = {}): BudgetProgressDto {
  return {
    id: 'b1',
    name: 'Tổng chi tháng 1',
    categoryId: null,
    categoryName: null,
    periodStart: '2025-01-01',
    periodEnd: '2025-01-31',
    limitAmount: '3000000.00',
    spent: '3200000.00',
    remaining: '-200000.00',
    percentage: 106.67,
    status: 'EXCEEDED',
    alerts: [],
    ...overrides,
  };
}

function makeAlert(overrides: Partial<SpendingAlertDto> = {}): SpendingAlertDto {
  return {
    id: 'a1',
    type: 'CATEGORY_SPIKE',
    severity: 'HIGH',
    status: 'OPEN',
    dedupeKey: 'category-spike:food:2025-01',
    transactionId: null,
    relatedTransactionId: null,
    categoryId: 'food',
    categoryName: 'Ăn uống',
    periodStart: '2025-01-01',
    periodEnd: '2025-01-31',
    score: '3.20',
    facts: { currency: 'VND' },
    explanation: 'Chi tiêu danh mục Ăn uống cao hơn mức thường ngày của bạn.',
    createdAt: '2025-01-20T03:00:00.000Z',
    updatedAt: '2025-01-20T03:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<TransactionDto> = {}): TransactionDto {
  return {
    id: 't1',
    accountId: 'acc1',
    accountName: 'Tiền mặt',
    categoryId: 'salary',
    categoryName: 'Lương',
    type: 'INCOME',
    amount: '5000000.00',
    currency: 'VND',
    description: 'Lương tháng 1',
    note: null,
    occurredAt: '2025-01-05T02:00:00.000Z',
    transferGroupId: null,
    transferDirection: null,
    createdAt: '2025-01-05T03:00:00.000Z',
    ...overrides,
  };
}

function page<T>(items: T[]): PaginatedDto<T> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchHandler = (url: string) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return handler(url);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

interface DataOverrides {
  summary?: () => AnalyticsSummaryDto;
  comparison?: () => ReturnType<typeof makeComparison>;
  budgets?: () => { items: BudgetProgressDto[] };
  alerts?: () => Response | PaginatedDto<SpendingAlertDto>;
  recent?: () => PaginatedDto<TransactionDto>;
}

function installDataFetch(overrides: DataOverrides = {}) {
  return installFetch((url) => {
    if (url.includes('/analytics/summary')) return json((overrides.summary ?? makeSummary)());
    if (url.includes('/analytics/by-category'))
      return json({
        from: '2025-01-01',
        to: '2025-01-31',
        total: '2300000.00',
        items: [
          { categoryId: 'food', categoryName: 'Ăn uống', total: '1500000.00', percentage: 65.22 },
        ],
      });
    if (url.includes('/analytics/trend'))
      return json({
        from: '2024-08-01',
        to: '2025-01-31',
        interval: 'month',
        points: [
          { period: '2024-12-01', income: '4000000.00', expense: '2000000.00' },
          { period: '2025-01-01', income: '5000000.00', expense: '2300000.00' },
        ],
      });
    if (url.includes('/analytics/comparison'))
      return json((overrides.comparison ?? makeComparison)());
    if (url.includes('/transactions'))
      return json((overrides.recent ?? (() => page([makeTransaction()])))());
    if (url.includes('/budgets'))
      return json((overrides.budgets ?? (() => ({ items: [makeBudget()] })))());
    if (url.includes('/alerts')) {
      const alerts = overrides.alerts ?? (() => page([makeAlert()]));
      const result = alerts();
      return result instanceof Response ? result : json(result);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function statCard(label: string): HTMLElement {
  const card = screen.getByText(label, { selector: 'p' }).closest('.card');
  if (!card) throw new Error(`No card found for ${label}`);
  return card as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardPage — overview', () => {
  it('shows the three headline figures, the insights and the supporting sections', async () => {
    const fetchMock = installDataFetch();
    renderPage();

    expect(screen.getByLabelText('Đang tải tổng quan')).toBeInTheDocument();

    const insightsRegion = await screen.findByRole('region', { name: 'Điểm cần chú ý' });

    expect(within(statCard('Dòng tiền ròng')).getByText(/2\.700\.000/)).toBeInTheDocument();
    expect(within(statCard('Thu nhập')).getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(within(statCard('Thu nhập')).getByText(/so với kỳ trước \+25\.0%/)).toBeInTheDocument();
    expect(within(statCard('Chi tiêu')).getByText(/2\.300\.000/)).toBeInTheDocument();

    // Alerts first, then the budget, then the period comparison: at most three.
    expect(within(insightsRegion).getByText('Cảnh báo · Cao')).toBeInTheDocument();
    expect(within(insightsRegion).getByText('Tăng đột biến theo danh mục')).toBeInTheDocument();
    expect(
      within(insightsRegion).getByText(
        'Chi tiêu danh mục Ăn uống cao hơn mức thường ngày của bạn.',
      ),
    ).toBeInTheDocument();
    expect(
      within(insightsRegion).getByText('Đã vượt hạn mức: Tổng chi tháng 1'),
    ).toBeInTheDocument();
    expect(within(insightsRegion).getByText('Chi tiêu tăng 15.0%')).toBeInTheDocument();
    expect(within(insightsRegion).getAllByRole('link', { name: 'Xem chi tiết' })).toHaveLength(3);

    const chart = screen.getByRole('region', { name: 'Xu hướng thu chi 6 tháng' });
    expect(within(chart).getByText('Thu nhập và chi tiêu 6 tháng')).toBeInTheDocument();
    expect(within(chart).getByRole('button', { name: /Hỏi AI về biểu đồ/ })).toBeInTheDocument();

    const categories = screen.getByRole('region', { name: 'Chi tiêu theo danh mục tháng này' });
    expect(within(categories).getByText('Ăn uống')).toBeInTheDocument();

    const budgets = screen.getByRole('region', { name: 'Ngân sách tháng này' });
    expect(await within(budgets).findByText('Tổng chi tháng 1')).toBeInTheDocument();

    expect(screen.getByText('1 giao dịch mới nhất')).toBeInTheDocument();
    expect(screen.getByText('Lương tháng 1')).toBeInTheDocument();

    // The alert list is a supplementary, read-only request scoped to open alerts.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/alerts?status=OPEN&limit=10'),
        ),
      ).toBe(true),
    );
  });

  it('pre-fills the AI composer from an insight without sending anything', async () => {
    installDataFetch();
    const received: AiChatOpenDetail[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent<AiChatOpenDetail>).detail);
    window.addEventListener(AI_CHAT_OPEN_EVENT, listener);
    try {
      renderPage();
      const insightsRegion = await screen.findByRole('region', { name: 'Điểm cần chú ý' });
      const user = userEvent.setup();

      await user.click(within(insightsRegion).getAllByRole('button', { name: /Hỏi AI/ })[0]);

      expect(received).toHaveLength(1);
      expect(received[0].assistantType).toBe('ANALYTICS');
      expect(received[0].prompt).toContain('Giải thích cảnh báo "Tăng đột biến theo danh mục"');
    } finally {
      window.removeEventListener(AI_CHAT_OPEN_EVENT, listener);
    }
  });

  it('says so when there is nothing to flag instead of inventing an insight', async () => {
    installDataFetch({
      alerts: () => page([]),
      budgets: () => ({ items: [makeBudget({ status: 'OK', percentage: 40 })] }),
      comparison: () => ({
        ...makeComparison(),
        incomeChangePercent: null,
        expenseChangePercent: 0,
      }),
    });
    renderPage();

    const insightsRegion = await screen.findByRole('region', { name: 'Điểm cần chú ý' });
    expect(
      within(insightsRegion).getByText(/Chưa có dấu hiệu bất thường từ dữ liệu đã ghi/),
    ).toBeInTheDocument();
    expect(
      within(insightsRegion).queryByRole('button', { name: /Hỏi AI/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps the overview when the supplementary alerts request fails', async () => {
    installDataFetch({
      alerts: () => json({ statusCode: 500, message: 'Lỗi máy chủ' }, 500),
      budgets: () => ({ items: [makeBudget({ status: 'OK', percentage: 40 })] }),
      comparison: () => ({ ...makeComparison(), expenseChangePercent: 0 }),
    });
    renderPage();

    expect(await screen.findByRole('region', { name: 'Điểm cần chú ý' })).toBeInTheDocument();
    expect(within(statCard('Thu nhập')).getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa có dấu hiệu bất thường từ dữ liệu đã ghi/)).toBeInTheDocument();
  });

  it('explains an empty month while still showing real six-month data', async () => {
    installDataFetch({
      summary: () =>
        makeSummary({ income: '0.00', expense: '0.00', net: '0.00', transactionCount: 0 }),
      alerts: () => page([]),
      budgets: () => ({ items: [] }),
      recent: () => page([]),
    });
    renderPage();

    expect(await screen.findByText('Chưa có giao dịch trong tháng này')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Xu hướng thu chi 6 tháng' })).toBeInTheDocument();
    expect(screen.getByText('Chưa có ngân sách tháng này.')).toBeInTheDocument();
  });
});
