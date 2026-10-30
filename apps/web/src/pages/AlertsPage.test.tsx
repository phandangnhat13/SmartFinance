import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AlertScanSummaryDto, SpendingAlertDto } from '@smart-finance/shared-types';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsPage } from './AlertsPage';

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

const ALERT_ID = '11111111-1111-4111-8111-111111111111';
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222';

const largeFacts: Record<string, unknown> = {
  method: 'robust_z',
  amount: '300000.00',
  currency: 'VND',
  median: '60000.00',
  mad: '5000.00',
  robustZ: '6.1234',
  scoreClamped: false,
  ratio: '5.0000',
  historyCount: 10,
  historyDays: 10,
  lookbackDays: 180,
  thresholds: { minHistoryCount: 8, robustZ: 3.5, madZeroRatio: 3 },
};

function makeAlert(overrides: Partial<SpendingAlertDto> = {}): SpendingAlertDto {
  return {
    id: ALERT_ID,
    type: 'LARGE_TRANSACTION',
    severity: 'HIGH',
    status: 'OPEN',
    dedupeKey: `LARGE:${TRANSACTION_ID}`,
    transactionId: TRANSACTION_ID,
    relatedTransactionId: null,
    categoryId: null,
    categoryName: 'Ăn uống',
    periodStart: null,
    periodEnd: null,
    score: '6.1234',
    facts: largeFacts,
    explanation: 'Khoản chi 300.000 ₫ cao hơn hẳn mức chi thường lệ của bạn.',
    createdAt: '2026-10-30T02:00:00.000Z',
    updatedAt: '2026-10-30T02:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeScanSummary(overrides: Partial<AlertScanSummaryDto> = {}): AlertScanSummaryDto {
  return {
    status: 'completed',
    detected: 3,
    created: 2,
    alreadyPresent: 1,
    detectedByType: {
      LARGE_TRANSACTION: 2,
      CATEGORY_SPIKE: 1,
      POSSIBLE_DUPLICATE: 0,
    },
    scannedTransactions: 42,
    window: {
      currentMonth: '2026-10',
      currentDays: 30,
      referenceMonths: ['2026-07', '2026-08', '2026-09'],
    },
    limits: {
      lookbackDays: 180,
      candidateDays: 30,
      maxTransactions: 5000,
      maxLargeCandidates: 500,
      maxDuplicatePairs: 100,
      transactionsTruncated: false,
      largeCandidatesCapped: false,
      duplicateCapReached: false,
    },
    ...overrides,
  };
}

function paginated(
  items: SpendingAlertDto[],
  page = 1,
  totalPages = items.length > 0 ? 1 : 0,
  total = items.length,
) {
  return { items, page, limit: 20, total, totalPages };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return handler(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function callsTo(mock: ReturnType<typeof installFetch>, method: string): string[] {
  return mock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') === method)
    .map(([input]) => String(input));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlertsPage — list states', () => {
  it('shows a loading state and then the empty state', async () => {
    installFetch(() => json(paginated([])));
    renderPage();

    expect(screen.getByText('Đang tải cảnh báo...')).toBeInTheDocument();
    expect(await screen.findByText('Không có cảnh báo phù hợp')).toBeInTheDocument();
  });

  it('renders alerts with type, severity, status, time, category and related transaction', async () => {
    installFetch(() => json(paginated([makeAlert()])));
    renderPage();

    expect(await screen.findByText('Mức độ: Cao')).toBeInTheDocument();
    expect(screen.getByText('Trạng thái: Chưa xử lý')).toBeInTheDocument();
    expect(screen.getByText(/Phát hiện: /)).toBeInTheDocument();
    expect(screen.getByText('Danh mục: Ăn uống')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem giao dịch liên quan' })).toHaveAttribute(
      'href',
      `/transactions/${TRANSACTION_ID}/edit`,
    );
  });

  it('shows the API error and recovers after retrying', async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    installFetch(() => {
      listCalls += 1;
      if (listCalls === 1) {
        return json({ statusCode: 500, code: 'INTERNAL', message: 'Lỗi máy chủ' }, 500);
      }
      return json(paginated([makeAlert()]));
    });
    renderPage();

    expect(await screen.findByText('Lỗi máy chủ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Mức độ: Cao')).toBeInTheDocument();
  });
});

describe('AlertsPage — filters and pagination', () => {
  it('sends the selected filters, resets to page 1 and paginates', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(() => json(paginated([makeAlert()], 1, 2, 25)));
    renderPage();
    await screen.findByText('Mức độ: Cao');

    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'OPEN');
    await waitFor(() => expect(callsTo(fetchMock, 'GET').at(-1)).toContain('status=OPEN'));
    expect(callsTo(fetchMock, 'GET').at(-1)).toContain('page=1');

    await user.selectOptions(screen.getByLabelText('Loại cảnh báo'), 'CATEGORY_SPIKE');
    await waitFor(() => expect(callsTo(fetchMock, 'GET').at(-1)).toContain('type=CATEGORY_SPIKE'));
    expect(callsTo(fetchMock, 'GET').at(-1)).toContain('status=OPEN');
    expect(callsTo(fetchMock, 'GET').at(-1)).toContain('page=1');

    await user.click(screen.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(callsTo(fetchMock, 'GET').at(-1)).toContain('page=2'));
    expect(callsTo(fetchMock, 'GET').at(-1)).toContain('type=CATEGORY_SPIKE');
    expect(callsTo(fetchMock, 'GET').at(-1)).toContain('status=OPEN');
  });

  it('keeps the newest filter results when an older request resolves later', async () => {
    const user = userEvent.setup();
    const first = deferred<Response>();
    const second = deferred<Response>();
    installFetch((url) => (url.includes('status=DISMISSED') ? second.promise : first.promise));

    renderPage();
    expect(screen.getByText('Đang tải cảnh báo...')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'DISMISSED');
    second.resolve(
      json(paginated([makeAlert({ explanation: 'Nội dung mới của bộ lọc B.' })], 1, 1, 1)),
    );
    expect(await screen.findByText('Nội dung mới của bộ lọc B.')).toBeInTheDocument();

    first.resolve(
      json(paginated([makeAlert({ explanation: 'Nội dung cũ của bộ lọc A.' })], 1, 1, 1)),
    );
    await waitFor(() =>
      expect(screen.queryByText('Nội dung cũ của bộ lọc A.')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Nội dung mới của bộ lọc B.')).toBeInTheDocument();
  });
});

describe('AlertsPage — scan', () => {
  it('shows a completed scan summary and reloads the list with current filters', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith('/alerts/scan') && init?.method === 'POST') {
        return json({ scan: makeScanSummary() });
      }
      return json(paginated([makeAlert()]));
    });
    renderPage();
    await screen.findByText('Mức độ: Cao');

    await user.click(screen.getByRole('button', { name: 'Quét chi tiêu' }));

    const summary = await screen.findByRole('status');
    expect(within(summary).getByText(/Đã phát hiện 3 cảnh báo/)).toBeInTheDocument();
    expect(summary.textContent).toMatch(/Chi tiêu lớn:\s*2/);
    expect(summary.textContent).toMatch(/Tăng đột biến theo danh mục:\s*1/);
    expect(within(summary).getByText('Hoàn tất')).toBeInTheDocument();
    expect(within(summary).queryByText('Bị giới hạn')).not.toBeInTheDocument();

    await waitFor(() => expect(callsTo(fetchMock, 'GET').length).toBeGreaterThanOrEqual(2));
    expect(callsTo(fetchMock, 'GET').at(-1)).toContain('page=1');
  });

  it('never claims completeness for a truncated scan and names the limits reached', async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith('/alerts/scan') && init?.method === 'POST') {
        const summary = makeScanSummary({ status: 'truncated' });
        summary.limits.largeCandidatesCapped = true;
        return json({ scan: summary });
      }
      return json(paginated([makeAlert()]));
    });
    renderPage();
    await screen.findByText('Mức độ: Cao');

    await user.click(screen.getByRole('button', { name: 'Quét chi tiêu' }));

    const summary = await screen.findByRole('status');
    expect(within(summary).getByText('Bị giới hạn')).toBeInTheDocument();
    expect(within(summary).getByText('Lần quét này chưa đầy đủ.')).toBeInTheDocument();
    expect(
      within(summary).getByText(/Chỉ phân tích tối đa 500 khoản chi gần nhất/),
    ).toBeInTheDocument();
  });

  it('surfaces a rate limit with the Retry-After wait', async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith('/alerts/scan') && init?.method === 'POST') {
        return json({ statusCode: 429, code: 'RATE_LIMITED', message: 'ThrottlerException' }, 429, {
          'Retry-After': '60',
        });
      }
      return json(paginated([makeAlert()]));
    });
    renderPage();
    await screen.findByText('Mức độ: Cao');

    await user.click(screen.getByRole('button', { name: 'Quét chi tiêu' }));

    expect(
      await screen.findByText('Bạn đã quét quá nhiều lần. Vui lòng thử lại sau 60 giây.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('AlertsPage — detail and status changes', () => {
  it('renders facts, explains the actions and updates the status only after the API responds', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith(`/alerts/${ALERT_ID}/status`) && init?.method === 'PATCH') {
        return json({ alert: makeAlert({ status: 'DISMISSED' }) });
      }
      return json(paginated([makeAlert()]));
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Xem chi tiết/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/robust z-score/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/300\.000/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Đã xem:/)).toBeInTheDocument();
    expect(within(dialog).getByText(/không phải xác nhận gian lận/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Bỏ qua' }));

    expect(await within(dialog).findByText('Trạng thái: Bỏ qua')).toBeInTheDocument();
    const patchCall = callsTo(fetchMock, 'PATCH');
    expect(patchCall).toHaveLength(1);
    expect(patchCall[0]).toContain(`/alerts/${ALERT_ID}/status`);
    const patchInit = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
    expect(JSON.parse(String(patchInit?.body))).toEqual({ status: 'DISMISSED' });
    await waitFor(() => expect(callsTo(fetchMock, 'GET').length).toBeGreaterThanOrEqual(2));
  });

  it('keeps the previous status and shows the error when the update fails', async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith(`/alerts/${ALERT_ID}/status`) && init?.method === 'PATCH') {
        return json(
          { statusCode: 400, code: 'BAD_REQUEST', message: 'Không thể chuyển trạng thái' },
          400,
        );
      }
      return json(paginated([makeAlert()]));
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Xem chi tiết/ }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Bỏ qua' }));

    expect(await within(dialog).findByText('Không thể chuyển trạng thái')).toBeInTheDocument();
    expect(within(dialog).getByText('Trạng thái: Chưa xử lý')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Bỏ qua' })).toBeEnabled();
  });

  it('uses facts.robustZ instead of the clamped score', async () => {
    const user = userEvent.setup();
    const clamped = makeAlert({
      score: '999999.9999',
      facts: {
        ...largeFacts,
        robustZ: '1214000.1234',
        scoreClamped: true,
      },
    });
    installFetch(() => json(paginated([clamped])));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Xem chi tiết/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/1\.214\.000/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Điểm số lưu trong cơ sở dữ liệu đã chạm giới hạn/),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toContain('999999.9999');
  });

  it('treats a missing scoreClamped flag as not clamped for older alerts', async () => {
    const user = userEvent.setup();
    const legacyFacts: Record<string, unknown> = { ...largeFacts, robustZ: '4.2000' };
    delete legacyFacts.scoreClamped;
    installFetch(() => json(paginated([makeAlert({ score: '4.2000', facts: legacyFacts })])));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Xem chi tiết/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('4,2')).toBeInTheDocument();
  });

  it('does not crash when facts are missing or have the wrong types', async () => {
    const user = userEvent.setup();
    const broken = makeAlert({
      score: 'không phải số',
      facts: {
        amount: 12345,
        currency: 'đồng',
        median: { unexpected: true },
        robustZ: 'abc',
        scoreClamped: 'yes',
        ratio: null,
        thresholds: 'missing',
        historyCount: 'nhiều',
      },
    });
    installFetch(() => json(paginated([broken])));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Xem chi tiết/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(broken.explanation)).toBeInTheDocument();
    expect(within(dialog).getByText('Số tiền')).toBeInTheDocument();
    expect(within(dialog).getByText(/12\.345/)).toBeInTheDocument();
  });

  it('renders category spike and duplicate details without inventing fields', async () => {
    const user = userEvent.setup();
    const spike = makeAlert({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'CATEGORY_SPIKE',
      transactionId: null,
      score: null,
      categoryName: 'Di chuyển',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      facts: {
        method: 'matched_day_window',
        categoryName: 'Di chuyển',
        currency: 'VND',
        currentMonth: '2026-10',
        windowDays: 30,
        currentSpend: '1500000.00',
        currentTransactions: 6,
        baseline: '400000.00',
        ratio: '3.7500',
        referenceMonths: [
          { month: '2026-08', spend: '400000.00', transactions: 4, days: 30 },
          { month: '2026-09', spend: '420000.00', transactions: 5, days: 30 },
        ],
        excludedReferenceMonths: [{ month: '2026-07', reason: 'no_data' }],
        thresholds: {
          ratio: 1.5,
          minReferenceMonths: 2,
          minNonZeroReferenceMonths: 2,
          minCurrentTransactions: 2,
        },
      },
      explanation: 'Chi tiêu danh mục Di chuyển tăng so với các tháng trước.',
    });
    const duplicate = makeAlert({
      id: '44444444-4444-4444-8444-444444444444',
      type: 'POSSIBLE_DUPLICATE',
      severity: 'MEDIUM',
      transactionId: '55555555-5555-4555-8555-555555555555',
      relatedTransactionId: '66666666-6666-4666-8666-666666666666',
      score: null,
      explanation: 'Hai giao dịch giống nhau trong thời gian ngắn.',
      facts: {
        rule: 'same_account_amount_type_currency_within_window',
        amount: '250000.00',
        currency: 'VND',
        accountId: 'account-1',
        minutesApart: 5,
        descriptionSimilar: true,
        windowMinutes: 1440,
        occurredAt: '2026-10-29T03:00:00.000Z',
        relatedOccurredAt: '2026-10-29T03:05:00.000Z',
        note: 'Kiểm tra lại nếu bạn không nhập hai lần.',
      },
    });
    installFetch(() => json(paginated([spike, duplicate])));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Xem chi tiết: Tăng đột biến/ }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('10/2026')).toBeInTheDocument();
    expect(within(dialog).getByText(/1\.500\.000/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/400\.000/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Các tháng tham chiếu/)).toBeInTheDocument();
    expect(within(dialog).getByText(/không có dữ liệu/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    await user.click(await screen.findByRole('button', { name: /Xem chi tiết: Có thể trùng lặp/ }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Hai giao dịch bị nghi trùng/)).toBeInTheDocument();
    expect(within(dialog).getByText('Giao dịch chính:')).toBeInTheDocument();
    expect(within(dialog).getByText('Giao dịch liên quan:')).toBeInTheDocument();
    expect(within(dialog).getByText(/Kiểm tra lại nếu bạn không nhập hai lần/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Mô tả giống nhau/)).toBeInTheDocument();
  });
});
