import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type {
  AnalyticsForecastDto,
  AnalyticsForecastExpensesDto,
} from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for financial forecasting (M3c).
 *
 * Two throwaway users hit the real API and E2E database. User A has six
 * complete months of flat VND history, current-month activity, a USD account and
 * an internal transfer; user B has no data at all. The UI must show model and
 * data quality, and must never present a forecast as an actual figure.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
const PASSWORD = 'E2ePassword123!';

interface CategoryItem {
  id: string;
  name: string;
  slug: string | null;
  type: string;
}

function hcmDateParts(): { year: number; month: number; day: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = formatted.split('-').map(Number);
  return { year, month, day };
}

/** Shifts a year/month pair by `delta` months, keeping the result normalised. */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const ordinal = year * 12 + (month - 1) + delta;
  return { year: Math.floor(ordinal / 12), month: (ordinal % 12) + 1 };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

/** Noon HCM on day 15 of a month offset from the current one. */
function monthInstant(delta: number): string {
  const { year, month } = hcmDateParts();
  const target = shiftMonth(year, month, delta);
  return new Date(Date.UTC(target.year, target.month - 1, 15, 5, 0, 0)).toISOString();
}

/** An instant guaranteed to be inside the current HCM calendar month. */
function currentMonthInstant(minutesAgo: number): string {
  const now = Date.now();
  const { year, month } = hcmDateParts();
  const monthStart = Date.UTC(year, month - 1, 1) - HCM_OFFSET_MS;
  return new Date(Math.max(monthStart + 60_000, now - minutesAgo * 60_000)).toISOString();
}

async function expectOk(response: APIResponse, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
}

async function registerUser(label: string): Promise<APIRequestContext> {
  const api = await newRequest.newContext({ baseURL: E2E_API_ORIGIN });
  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: {
        email: `forecast.${label}.${RUN}@example.com`,
        password: PASSWORD,
        displayName: `Forecast ${label} E2E`,
      },
    }),
    `Register ${label}`,
  );
  return api;
}

async function createAccount(
  api: APIRequestContext,
  name: string,
  currency: string,
  initialBalance: string,
): Promise<string> {
  const response = await api.post('/api/v1/accounts', {
    data: { name, type: 'CASH', initialBalance, currency },
  });
  await expectOk(response, `Account ${name}`);
  return ((await response.json()) as { account: { id: string } }).account.id;
}

async function createCategory(
  api: APIRequestContext,
  name: string,
  type: 'EXPENSE' | 'INCOME' = 'EXPENSE',
): Promise<string> {
  const response = await api.post('/api/v1/categories', { data: { name, type } });
  await expectOk(response, `Category ${name}`);
  return ((await response.json()) as { category: { id: string } }).category.id;
}

let api: APIRequestContext;
let apiB: APIRequestContext;
let browserContext: BrowserContext;
let browserContextB: BrowserContext;
let page: Page;
let pageB: Page;

let foodCategoryId: string;
let otherCategoryId: string;
let oneOffCategoryId: string;

const CURRENT = hcmDateParts();
const CURRENT_MONTH = monthKey(CURRENT.year, CURRENT.month);
const NEXT = [1, 2, 3].map((delta) => shiftMonth(CURRENT.year, CURRENT.month, delta));

test.beforeAll(async ({ browser }) => {
  api = await registerUser('a');
  apiB = await registerUser('b');

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = ((await categories.json()) as { items: CategoryItem[] }).items;
  const food = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!food) throw new Error('Seeded "food" expense category not found');
  foodCategoryId = food.id;
  const income = items.find((item) => item.type === 'INCOME');
  if (!income) throw new Error('Seeded income category not found');

  otherCategoryId = await createCategory(api, 'Chi khác E2E M3c');
  oneOffCategoryId = await createCategory(api, 'Chi một lần E2E M3c');

  const mainAccountId = await createAccount(api, 'Ví dự báo E2E', 'VND', '5000000');
  const savingsAccountId = await createAccount(api, 'Tiết kiệm dự báo E2E', 'VND', '0');
  const usdAccountId = await createAccount(api, 'Ví USD dự báo E2E', 'USD', '1000000');

  const create = async (data: Record<string, unknown>, label: string) => {
    await expectOk(await api.post('/api/v1/transactions', { data }), label);
  };

  // Six complete months of flat VND history: income 10M, expense 3M.
  for (let ago = 6; ago >= 1; ago -= 1) {
    const occurredAt = monthInstant(-ago);
    await create(
      {
        accountId: mainAccountId,
        categoryId: income.id,
        type: 'INCOME',
        amount: '10000000',
        occurredAt,
        description: `Thu nhập M3c tháng -${ago}`,
      },
      `History income -${ago}`,
    );
    await create(
      {
        accountId: mainAccountId,
        categoryId: foodCategoryId,
        type: 'EXPENSE',
        amount: '1500000',
        occurredAt,
        description: `Ăn uống M3c tháng -${ago}`,
      },
      `History food -${ago}`,
    );
    await create(
      {
        accountId: mainAccountId,
        categoryId: otherCategoryId,
        type: 'EXPENSE',
        amount: ago === 1 ? '1400000' : '1500000',
        occurredAt,
        description: `Chi khác M3c tháng -${ago}`,
      },
      `History other -${ago}`,
    );
  }

  // A category that exists in one month only: no per-category forecast.
  await create(
    {
      accountId: mainAccountId,
      categoryId: oneOffCategoryId,
      type: 'EXPENSE',
      amount: '100000',
      occurredAt: monthInstant(-1),
      description: 'Chi một lần M3c',
    },
    'One-off category',
  );

  // Current month: income 2M, expense 1M.
  await create(
    {
      accountId: mainAccountId,
      categoryId: income.id,
      type: 'INCOME',
      amount: '2000000',
      occurredAt: currentMonthInstant(2),
      description: 'Thu nhập hiện tại M3c',
    },
    'Current income',
  );
  await create(
    {
      accountId: mainAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '400000',
      occurredAt: currentMonthInstant(3),
      description: 'Ăn uống hiện tại M3c',
    },
    'Current food',
  );
  await create(
    {
      accountId: mainAccountId,
      categoryId: otherCategoryId,
      type: 'EXPENSE',
      amount: '600000',
      occurredAt: currentMonthInstant(4),
      description: 'Chi khác hiện tại M3c',
    },
    'Current other',
  );

  // Internal transfer: same currency, moves money between the user's accounts.
  await expectOk(
    await api.post('/api/v1/transactions/transfers', {
      data: {
        fromAccountId: mainAccountId,
        toAccountId: savingsAccountId,
        amount: '1000000',
        occurredAt: currentMonthInstant(5),
        description: 'Chuyển tiền nội bộ M3c',
      },
    }),
    'Internal transfer',
  );

  // USD activity that must never enter the VND forecast.
  await create(
    {
      accountId: usdAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '9000000',
      currency: 'USD',
      occurredAt: monthInstant(-2),
      description: 'Chi USD M3c',
    },
    'USD expense',
  );

  browserContext = await browser.newContext({
    storageState: await api.storageState(),
    baseURL: E2E_WEB_ORIGIN,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  page = await browserContext.newPage();

  browserContextB = await browser.newContext({
    storageState: await apiB.storageState(),
    baseURL: E2E_WEB_ORIGIN,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  pageB = await browserContextB.newPage();
});

test.afterAll(async () => {
  await browserContext?.close();
  await browserContextB?.close();
  await api?.dispose();
  await apiB?.dispose();
});

test('returns a transparent forecast with the remaining current month', async () => {
  const response = await page.request.get(
    `/api/v1/analytics/forecast?currency=VND&horizon=current_month`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as AnalyticsForecastDto;

  expect(body.currency).toBe('VND');
  expect(body.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(body.horizon).toBe('current_month');
  expect(body.horizonMonths).toEqual([CURRENT_MONTH]);
  expect(body.status).toBe('ok');
  expect(body.estimated).toBe(true);
  expect(body.income.model).toBe('historical_average');
  expect(body.expense.monthlyAverage).toBe('3000000.00');
  expect(body.dataQuality.monthsWithData).toBe(6);
  expect(body.income.months[0]).toMatchObject({
    month: CURRENT_MONTH,
    amount: '8000000.00',
    isPartial: true,
  });
  expect(body.expense.months[0]).toMatchObject({
    month: CURRENT_MONTH,
    amount: '2000000.00',
    isPartial: true,
  });
  expect(body.net.base).toBe('6000000.00');

  // 5,000,000 opening + 62,000,000 income − 19,000,000 expense (the transfer
  // between two VND accounts cancels out); the USD row is excluded.
  expect(body.monthEndBalance.currentBalance).toBe('48000000.00');
  expect(body.monthEndBalance.projectedBalance).toBe('54000000.00');

  // The single-month category is omitted rather than forecast from one point.
  expect(body.categoryForecasts.map((item) => item.categoryName)).not.toContain(
    'Chi một lần E2E M3c',
  );
});

test('exposes the expenses slice and isolates the USD currency', async () => {
  const expenses = await page.request.get('/api/v1/analytics/forecast/expenses?currency=VND');
  expect(expenses.ok()).toBeTruthy();
  const expenseBody = (await expenses.json()) as AnalyticsForecastExpensesDto;
  expect(expenseBody.slice).toBe('expenses');
  expect(expenseBody.expense.monthlyAverage).toBe('3000000.00');

  const usd = await page.request.get('/api/v1/analytics/forecast?currency=USD&horizon=1m');
  expect(usd.ok()).toBeTruthy();
  const usdBody = (await usd.json()) as AnalyticsForecastDto;
  expect(usdBody.currency).toBe('USD');
  expect(usdBody.status).toBe('insufficient_data');
  // No USD income at all; the single USD expense month counts as data but is
  // below the three-month modelling floor.
  expect(usdBody.reason).toBe('no_income');
  expect(usdBody.income.reason).toBe('no_income');
  expect(usdBody.expense.reason).toBe('too_few_months');
  expect(usdBody.expense.months).toEqual([]);
});

test('renders actual and forecast figures with explicit labels and data quality', async () => {
  await page.goto('/analytics?tab=trends');
  const panel = page.getByRole('region', { name: 'Dự báo tài chính' });
  await expect(panel).toBeVisible();

  await expect(panel.getByText('Giá trị dự báo, không phải số liệu thực tế')).toBeVisible();
  await expect(panel.getByText('Đủ dữ liệu dự báo')).toBeVisible();
  await expect(panel.getByText(/Mô hình: Trung bình lịch sử/).first()).toBeVisible();
  await expect(panel.getByText(/Tin cậy cao/).first()).toBeVisible();
  await expect(panel.getByText(/6\/12 tháng đã kết thúc có dữ liệu/)).toBeVisible();
  await expect(panel.getByText('Còn lại của tháng', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('Số dư cuối tháng dự kiến')).toBeVisible();
  await expect(panel.getByText(/Chỉ tính giao dịch thu nhập/)).toBeVisible();
  await expect(panel.getByText(/không dùng AI\/LLM/i).first()).toBeVisible();
  await expect(
    panel.getByRole('table', { name: 'Dự báo chi tiêu theo danh mục' }).getByText('Ăn uống'),
  ).toBeVisible();
});

test('re-requests the forecast when the horizon changes', async () => {
  await page.goto('/analytics?tab=trends');
  const panel = page.getByRole('region', { name: 'Dự báo tài chính' });
  await expect(panel).toBeVisible();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/forecast?') &&
      response.url().includes('horizon=3m'),
  );
  await panel.getByLabel('Khoảng dự báo').selectOption('3m');
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as AnalyticsForecastDto;
  expect(body.horizon).toBe('3m');
  expect(body.horizonMonths).toEqual(NEXT.map((month) => monthKey(month.year, month.month)));

  await expect(panel.getByText(monthLabel(NEXT[0].year, NEXT[0].month)).first()).toBeVisible();
  await expect(panel.getByText(monthLabel(NEXT[2].year, NEXT[2].month)).first()).toBeVisible();
  await expect(panel.getByText('Dự báo').first()).toBeVisible();
  await expect(panel.getByText('Giá trị dự báo, không phải số liệu thực tế')).toBeVisible();
});

test('withholds the forecast for a user without complete months', async () => {
  await pageB.goto('/analytics?tab=trends');
  const panel = pageB.getByRole('region', { name: 'Dự báo tài chính' });
  await expect(panel).toBeVisible();

  await expect(panel.getByText('Chưa thể dự báo').first()).toBeVisible();
  await expect(panel.getByText('Chưa đủ dữ liệu').first()).toBeVisible();
  await expect(panel.getByText(/Chưa có tháng nào đã kết thúc/)).toBeVisible();
  await expect(panel.getByText('Giá trị dự báo, không phải số liệu thực tế')).toBeVisible();
  await expect(panel.getByText('Số dư cuối tháng dự kiến')).toHaveCount(0);
});
