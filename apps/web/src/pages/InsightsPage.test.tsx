import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  InsightsCategoriesDto,
  InsightsMonthlyDto,
  InsightsOverviewDto,
} from '@smart-finance/shared-types';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMonthRange } from '../lib/date';
import { InsightsPage } from './InsightsPage';

// The chart is covered by the real-browser E2E suite; in jsdom Recharts cannot
// measure its container, so keep the DOM small and deterministic here.
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    Bar: () => null,
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

function makeOverview(overrides: Partial<InsightsOverviewDto> = {}): InsightsOverviewDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2025-01',
    monthStatus: 'complete',
    periodStart: '2025-01-01',
    periodEnd: '2025-01-31',
    income: '5000000.00',
    expense: '2300000.00',
    net: '2700000.00',
    savingsRate: 54,
    transactionCount: 3,
    estimated: false,
    previous: {
      month: '2024-12',
      income: '0.00',
      expense: '1000000.00',
      net: '-1000000.00',
      savingsRate: null,
      incomeChangePercent: null,
      expenseChangePercent: 130,
    },
    availableCurrencies: ['VND', 'USD'],
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
        month: '2024-12',
        monthStatus: 'complete',
        income: '0.00',
        expense: '1000000.00',
        net: '-1000000.00',
        savingsRate: null,
        transactionCount: 1,
        hasTransactions: true,
      },
      {
        month: '2025-01',
        monthStatus: 'complete',
        income: '5000000.00',
        expense: '2300000.00',
        net: '2700000.00',
        savingsRate: 54,
        transactionCount: 3,
        hasTransactions: true,
      },
    ],
    ...overrides,
  };
}

function makeCategories(overrides: Partial<InsightsCategoriesDto> = {}): InsightsCategoriesDto {
  return {
    currency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    month: '2025-01',
    previousMonth: '2024-12',
    monthStatus: 'complete',
    total: '2300000.00',
    previousTotal: '1000000.00',
    changePercent: 130,
    estimated: false,
    thresholds: { notableIncreasePercent: 25 },
    items: [
      {
        categoryId: 'food',
        categoryName: 'Ăn uống',
        total: '2000000.00',
        sharePercent: 86.96,
        transactionCount: 2,
        previousTotal: '1000000.00',
        changeAmount: '1000000.00',
        changePercent: 100,
        notableIncrease: true,
        isNewSpending: false,
      },
      {
        categoryId: 'transport',
        categoryName: 'Đi lại',
        total: '300000.00',
        sharePercent: 13.04,
        transactionCount: 1,
        previousTotal: '0.00',
        changeAmount: '300000.00',
        changePercent: null,
        notableIncrease: false,
        isNewSpending: true,
      },
    ],
    ...overrides,
  };
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

function installDataFetch(
  overrides: {
    overview?: () => InsightsOverviewDto;
    monthly?: () => InsightsMonthlyDto;
    categories?: () => InsightsCategoriesDto;
  } = {},
) {
  return installFetch((url) => {
    if (url.includes('/insights/overview')) return json((overrides.overview ?? makeOverview)());
    if (url.includes('/insights/monthly')) return json((overrides.monthly ?? makeMonthly)());
    if (url.includes('/insights/categories'))
      return json((overrides.categories ?? makeCategories)());
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InsightsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getCalls(mock: ReturnType<typeof installFetch>): string[] {
  return mock.mock.calls.map(([input]) => String(input));
}

function statCard(label: string): HTMLElement {
  const card = screen.getByText(label, { selector: 'p' }).closest('.card');
  if (!card) throw new Error(`No card found for ${label}`);
  return card as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InsightsPage — loading and errors', () => {
  it('shows the loading state before the computed figures arrive', async () => {
    installDataFetch();
    renderPage();

    expect(screen.getByText('Đang tính toán phân tích...')).toBeInTheDocument();
    expect(await screen.findByText(/Tổng chi tháng này/)).toBeInTheDocument();
  });

  it('shows the API error and recovers after retrying', async () => {
    const user = userEvent.setup();
    let failing = true;
    const fetchMock = installFetch((url) => {
      if (failing) {
        return json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500);
      }
      if (url.includes('/insights/overview')) return json(makeOverview());
      if (url.includes('/insights/monthly')) return json(makeMonthly());
      return json(makeCategories());
    });
    renderPage();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText(/Tổng chi tháng này/)).toBeInTheDocument();
    await waitFor(() => expect(getCalls(fetchMock).length).toBeGreaterThanOrEqual(6));
  });
});

describe('InsightsPage — overview and comparison', () => {
  it('renders income, expense, net cash flow, savings rate and previous-month comparisons', async () => {
    installDataFetch();
    renderPage();

    await screen.findByText(/Tổng chi tháng này/);

    const income = statCard('Thu nhập');
    expect(within(income).getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(within(income).getByText(/Tháng trước: 0/)).toBeInTheDocument();

    const expense = statCard('Chi tiêu');
    expect(within(expense).getByText(/2\.300\.000/)).toBeInTheDocument();
    expect(within(expense).getByText(/\+130\.0%/)).toBeInTheDocument();

    const net = statCard('Dòng tiền ròng');
    expect(within(net).getByText(/2\.700\.000/)).toBeInTheDocument();
    expect(within(net).getByText(/3 giao dịch/)).toBeInTheDocument();

    const savings = statCard('Tỷ lệ tiết kiệm');
    expect(within(savings).getByText('54.0%')).toBeInTheDocument();

    expect(screen.getByText('Tháng đã kết thúc')).toBeInTheDocument();
    expect(screen.getByText(/danh mục tăng từ 25% được đánh dấu/)).toBeInTheDocument();
    expect(screen.getByText(/Tất cả chỉ số là dữ liệu thực tế/)).toBeInTheDocument();
  });

  it('shows a dash and an explanation when the month has expenses but no income', async () => {
    installDataFetch({
      overview: () =>
        makeOverview({
          income: '0.00',
          expense: '900000.00',
          net: '-900000.00',
          savingsRate: null,
          transactionCount: 1,
        }),
    });
    renderPage();

    await screen.findByText(/Tổng chi tháng này/);
    const savings = statCard('Tỷ lệ tiết kiệm');
    expect(within(savings).getByText('—')).toBeInTheDocument();
    expect(
      within(savings).getByText('Tháng này chưa có thu nhập để tính tỷ lệ.'),
    ).toBeInTheDocument();
    expect(within(statCard('Dòng tiền ròng')).getByText(/−900\.000|900\.000/)).toBeInTheDocument();
  });

  it('marks the current month as still running', async () => {
    installDataFetch({
      overview: () => makeOverview({ monthStatus: 'in_progress' }),
      monthly: () =>
        makeMonthly({
          months: [
            {
              month: '2025-01',
              monthStatus: 'in_progress',
              income: '5000000.00',
              expense: '2300000.00',
              net: '2700000.00',
              savingsRate: 54,
              transactionCount: 3,
              hasTransactions: true,
            },
          ],
        }),
    });
    renderPage();

    await screen.findByText(/Tổng chi tháng này/);
    expect(screen.getByText('Tháng đang diễn ra')).toBeInTheDocument();
    expect(screen.getByText('(đang diễn ra)')).toBeInTheDocument();
  });
});

describe('InsightsPage — monthly series and categories', () => {
  it('lists every month, including months without transactions', async () => {
    installDataFetch({
      monthly: () =>
        makeMonthly({
          months: [
            {
              month: '2024-11',
              monthStatus: 'complete',
              income: '0.00',
              expense: '0.00',
              net: '0.00',
              savingsRate: null,
              transactionCount: 0,
              hasTransactions: false,
            },
            ...makeMonthly().months,
          ],
        }),
    });
    renderPage();

    await screen.findByText(/Tổng chi tháng này/);
    expect(screen.getByText('không có giao dịch')).toBeInTheDocument();
    expect(screen.getByText('11/2024')).toBeInTheDocument();
    expect(screen.getByText('12/2024')).toBeInTheDocument();
    expect(screen.getByText('01/2025')).toBeInTheDocument();
  });

  it('shows category shares and flags notable and new spending', async () => {
    installDataFetch();
    renderPage();

    await screen.findByText(/Tổng chi tháng này/);
    expect(screen.getByText('Ăn uống')).toBeInTheDocument();
    expect(screen.getByText('Tăng đáng chú ý')).toBeInTheDocument();
    expect(screen.getByText('Đi lại')).toBeInTheDocument();
    expect(screen.getByText('Chi tiêu mới')).toBeInTheDocument();
    expect(screen.getByText(/87\.0% tổng chi/)).toBeInTheDocument();
    expect(screen.getAllByText(/\+130\.0%/).length).toBeGreaterThan(0);
  });
});

describe('InsightsPage — filters and empty states', () => {
  it('requests the selected month and currency', async () => {
    const user = userEvent.setup();
    const fetchMock = installDataFetch();
    renderPage();
    await screen.findByText(/Tổng chi tháng này/);

    const initialMonth = currentMonthRange('Asia/Ho_Chi_Minh').month;
    await waitFor(() =>
      expect(
        getCalls(fetchMock).some(
          (url) => url.includes(`month=${initialMonth}`) && url.includes('currency=VND'),
        ),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText('Tháng'), { target: { value: '2024-12' } });
    await waitFor(() =>
      expect(getCalls(fetchMock).some((url) => url.includes('month=2024-12&currency=VND'))).toBe(
        true,
      ),
    );
    expect(
      getCalls(fetchMock).some((url) => url.includes('/insights/monthly?month=2024-12&months=6')),
    ).toBe(true);

    await user.selectOptions(screen.getByLabelText('Tiền tệ'), 'USD');
    await waitFor(() =>
      expect(getCalls(fetchMock).some((url) => url.includes('month=2024-12&currency=USD'))).toBe(
        true,
      ),
    );
  });

  it('shows empty states for a month with no transactions', async () => {
    installDataFetch({
      overview: () =>
        makeOverview({
          income: '0.00',
          expense: '0.00',
          net: '0.00',
          savingsRate: null,
          transactionCount: 0,
        }),
      categories: () =>
        makeCategories({
          total: '0.00',
          previousTotal: '0.00',
          changePercent: null,
          items: [],
        }),
      monthly: () =>
        makeMonthly({
          months: [
            {
              month: '2025-01',
              monthStatus: 'complete',
              income: '0.00',
              expense: '0.00',
              net: '0.00',
              savingsRate: null,
              transactionCount: 0,
              hasTransactions: false,
            },
          ],
        }),
    });
    renderPage();

    expect(await screen.findByText(/Chưa có giao dịch trong tháng/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Thêm giao dịch/ })).toHaveAttribute(
      'href',
      '/transactions/new',
    );
    expect(screen.getByText('Chưa có chi tiêu theo danh mục trong tháng này.')).toBeInTheDocument();
  });
});
