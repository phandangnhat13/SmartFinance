import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { InsightsOverviewDto } from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for Financial Insights.
 *
 * The spec registers its own throwaway user so its transactions never leak into
 * the other specs that share the global-setup user (the alerts scan looks at
 * every transaction of that user). Every figure asserted here is produced by
 * the real API from the real database; nothing is stubbed.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
const PASSWORD = 'E2ePassword123!';

interface CategoryItem {
  id: string;
  slug: string | null;
  type: string;
}

function hcmYearMonth(): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const [year, month] = formatted.split('-').map(Number);
  return { year, month };
}

/** An instant guaranteed to be inside the current HCM calendar month. */
function currentMonthInstant(minutesAgo: number): string {
  const now = Date.now();
  const { year, month } = hcmYearMonth();
  const monthStart = Date.UTC(year, month - 1, 1) - HCM_OFFSET_MS;
  return new Date(Math.max(monthStart + 60_000, now - minutesAgo * 60_000)).toISOString();
}

/** Noon local time on day 15 of a past month, safely inside that month. */
function previousMonthInstant(): string {
  const { year, month } = hcmYearMonth();
  return new Date(Date.UTC(year, month - 2, 15, 5, 0, 0)).toISOString();
}

async function expectOk(response: APIResponse, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
}

/** The stat card whose label is exactly `label` (the chart legend repeats some labels). */
function statCard(label: string) {
  return page
    .locator('.card')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
}

let api: APIRequestContext;
let browserContext: BrowserContext;
let page: Page;
let vndAccountId: string;
let usdAccountId: string;
let foodCategoryId: string;
let incomeCategoryId: string;

test.beforeAll(async ({ browser }) => {
  api = await newRequest.newContext({ baseURL: E2E_API_ORIGIN });

  const email = `insights.e2e.${RUN}@example.com`;
  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: { email, password: PASSWORD, displayName: 'Insights E2E' },
    }),
    'Register',
  );

  const vnd = await api.post('/api/v1/accounts', {
    data: { name: 'Ví VND', type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(vnd, 'VND account');
  vndAccountId = ((await vnd.json()) as { account: { id: string } }).account.id;

  const usd = await api.post('/api/v1/accounts', {
    data: { name: 'Ví USD', type: 'BANK', initialBalance: '0', currency: 'USD' },
  });
  await expectOk(usd, 'USD account');
  usdAccountId = ((await usd.json()) as { account: { id: string } }).account.id;

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = ((await categories.json()) as { items: CategoryItem[] }).items;
  const food = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!food) throw new Error('Seeded "food" expense category not found');
  foodCategoryId = food.id;
  const incomeCategory = items.find((item) => item.type === 'INCOME');
  if (!incomeCategory) throw new Error('Seeded income category not found');
  incomeCategoryId = incomeCategory.id;

  const create = async (data: Record<string, unknown>, label: string) => {
    await expectOk(await api.post('/api/v1/transactions', { data }), label);
  };

  // Current month: income 5,000,000 and expense 2,000,000 VND.
  await create(
    {
      accountId: vndAccountId,
      categoryId: incomeCategoryId,
      type: 'INCOME',
      amount: '5000000',
      occurredAt: currentMonthInstant(2),
      description: 'Thu nhập E2E insights',
    },
    'Income',
  );
  await create(
    {
      accountId: vndAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '2000000',
      occurredAt: currentMonthInstant(3),
      description: 'Ăn uống E2E insights',
    },
    'Expense',
  );
  // Previous month: expense 1,000,000 VND, so the category grows by 100%.
  await create(
    {
      accountId: vndAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '1000000',
      occurredAt: previousMonthInstant(),
      description: 'Ăn uống tháng trước E2E insights',
    },
    'Previous expense',
  );
  // A different currency that must never be added into the VND figures.
  await create(
    {
      accountId: usdAccountId,
      categoryId: incomeCategoryId,
      type: 'INCOME',
      amount: '1000',
      occurredAt: currentMonthInstant(4),
      description: 'Thu nhập USD E2E insights',
    },
    'USD income',
  );

  browserContext = await browser.newContext({
    storageState: await api.storageState(),
    baseURL: E2E_WEB_ORIGIN,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  page = await browserContext.newPage();
});

test.afterAll(async () => {
  await browserContext?.close();
  await api?.dispose();
});

test('shows the month overview, category comparison and previous-month state', async () => {
  const { year, month } = hcmYearMonth();
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));

  await page.goto('/insights');
  await expect(page.getByRole('link', { name: 'Phân tích' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phân tích tài chính' })).toBeVisible();

  const monthInput = page.getByLabel('Tháng');
  await expect(monthInput).toHaveValue(currentMonth);
  await expect(page.getByText('Tháng đang diễn ra')).toBeVisible();

  const overviewResponse = await page.request.get(
    `/api/v1/insights/overview?month=${currentMonth}`,
  );
  expect(overviewResponse.ok()).toBeTruthy();
  const overview = (await overviewResponse.json()) as InsightsOverviewDto;
  expect(overview).toMatchObject({
    currency: 'VND',
    month: currentMonth,
    income: '5000000.00',
    expense: '2000000.00',
    net: '3000000.00',
    savingsRate: 60,
    transactionCount: 2,
    estimated: false,
  });

  await expect(statCard('Thu nhập')).toContainText(/5\.000\.000/);
  await expect(statCard('Thu nhập')).toContainText(/Tháng trước: 0/);
  await expect(statCard('Chi tiêu')).toContainText(/2\.000\.000/);
  await expect(statCard('Tỷ lệ tiết kiệm')).toContainText('60.0%');

  await expect(page.getByText('Ăn uống', { exact: true })).toBeVisible();
  await expect(page.getByText('Tăng đáng chú ý')).toBeVisible();
  await expect(page.getByText(/100\.0% tổng chi/)).toBeVisible();

  // The previous month has an expense but no income: the savings rate is null.
  const previous = `${previousMonth.getUTCFullYear()}-${String(
    previousMonth.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
  await monthInput.fill(previous);
  await expect(page.getByLabel('Tháng')).toHaveValue(previous);
  await expect(statCard('Tỷ lệ tiết kiệm')).toContainText('—');
  await expect(page.getByText('Tháng đã kết thúc')).toBeVisible();
  await expect(statCard('Chi tiêu')).toContainText(/1\.000\.000/);
});

test('switches currency without mixing VND and USD', async () => {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Phân tích tài chính' })).toBeVisible();
  // The currency options arrive with the first overview response.
  await expect(statCard('Tỷ lệ tiết kiệm')).toContainText('60.0%');

  const currency = page.getByLabel('Tiền tệ');
  await currency.selectOption('USD');

  const overviewResponse = await page.request.get(`/api/v1/insights/overview?currency=USD`);
  expect(overviewResponse.ok()).toBeTruthy();
  const overview = (await overviewResponse.json()) as InsightsOverviewDto;
  expect(overview).toMatchObject({
    currency: 'USD',
    income: '1000.00',
    expense: '0.00',
  });

  await expect(statCard('Thu nhập')).toContainText(/1\.000,00/);
  await expect(statCard('Chi tiêu')).toContainText(/0,00/);
  await expect(page.getByText(/Chưa có chi tiêu theo danh mục trong tháng này/)).toBeVisible();
});
