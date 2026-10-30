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
  AnalyticsExpenseDto,
  AnalyticsIncomeDto,
  AnalyticsOverviewDto,
  AnalyticsPeriodComparisonDto,
  AnalyticsTrendsDto,
} from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for income & expense trends (M3a).
 *
 * Two throwaway users are registered so account isolation can be checked from
 * two browser contexts. Every figure is produced by the real API from the real
 * test database — no response is stubbed. The VND account holds a transfer pair
 * that must never be counted as income or expense, and a USD account proves the
 * currencies stay separate.
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

/** Noon local time on day 15 of the previous month, safely inside it. */
function previousMonthInstant(): string {
  const { year, month } = hcmYearMonth();
  return new Date(Date.UTC(year, month - 2, 15, 5, 0, 0)).toISOString();
}

async function expectOk(response: APIResponse, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
}

/**
 * The stat card whose label is exactly `label` (charts repeat some labels).
 * Only `<p>` labels are stat-card titles: the filter panel also contains the
 * category-type `<option>Thu nhập</option>`, which would otherwise match.
 */
function statCard(label: string) {
  return page
    .locator('.card')
    .filter({ has: page.locator('p', { hasText: new RegExp(`^${label}$`) }) })
    .first();
}

async function registerUser(label: string): Promise<APIRequestContext> {
  const api = await newRequest.newContext({ baseURL: E2E_API_ORIGIN });
  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: {
        email: `analytics.${label}.${RUN}@example.com`,
        password: PASSWORD,
        displayName: `Analytics ${label} E2E`,
      },
    }),
    `Register ${label}`,
  );
  return api;
}

async function createVndAccount(api: APIRequestContext, name: string): Promise<string> {
  const response = await api.post('/api/v1/accounts', {
    data: { name, type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(response, `Account ${name}`);
  return ((await response.json()) as { account: { id: string } }).account.id;
}

let api: APIRequestContext;
let apiB: APIRequestContext;
let browserContext: BrowserContext;
let browserContextB: BrowserContext;
let page: Page;
let pageB: Page;
let incomeCategoryId: string;
let incomeCategoryName: string;
let foodCategoryId: string;
let foodCategoryName: string;

test.beforeAll(async ({ browser }) => {
  api = await registerUser('a');
  apiB = await registerUser('b');

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = ((await categories.json()) as { items: CategoryItem[] }).items;
  const food = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!food) throw new Error('Seeded "food" expense category not found');
  foodCategoryId = food.id;
  foodCategoryName = food.name;
  const income = items.find((item) => item.type === 'INCOME');
  if (!income) throw new Error('Seeded income category not found');
  incomeCategoryId = income.id;
  incomeCategoryName = income.name;

  const vndAccountId = await createVndAccount(api, 'Ví VND chính');
  const vndSavingsId = await createVndAccount(api, 'Ví VND tiết kiệm');

  const usd = await api.post('/api/v1/accounts', {
    data: { name: 'Ví USD', type: 'BANK', initialBalance: '0', currency: 'USD' },
  });
  await expectOk(usd, 'USD account');
  const usdAccountId = ((await usd.json()) as { account: { id: string } }).account.id;

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
      description: 'Thu nhập E2E analytics',
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
      description: 'Ăn uống E2E analytics',
    },
    'Expense',
  );
  // Previous month: income 4,000,000 and expense 1,000,000 VND.
  await create(
    {
      accountId: vndAccountId,
      categoryId: incomeCategoryId,
      type: 'INCOME',
      amount: '4000000',
      occurredAt: previousMonthInstant(),
      description: 'Thu nhập tháng trước E2E analytics',
    },
    'Previous income',
  );
  await create(
    {
      accountId: vndAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '1000000',
      occurredAt: previousMonthInstant(),
      description: 'Ăn uống tháng trước E2E analytics',
    },
    'Previous expense',
  );
  // A transfer pair inside the current month: it must never enter the figures.
  await expectOk(
    await api.post('/api/v1/transactions/transfers', {
      data: {
        fromAccountId: vndAccountId,
        toAccountId: vndSavingsId,
        amount: '500000',
        occurredAt: currentMonthInstant(1),
        description: 'Chuyển quỹ E2E analytics',
      },
    }),
    'Transfer',
  );
  // A different currency that must never be added into the VND figures.
  await create(
    {
      accountId: usdAccountId,
      categoryId: incomeCategoryId,
      type: 'INCOME',
      amount: '1000',
      occurredAt: currentMonthInstant(4),
      description: 'Thu nhập USD E2E analytics',
    },
    'USD income',
  );

  // A second user with their own money, used to prove account isolation.
  const otherAccountId = await createVndAccount(apiB, 'Ví người dùng B');
  await expectOk(
    await apiB.post('/api/v1/transactions', {
      data: {
        accountId: otherAccountId,
        categoryId: incomeCategoryId,
        type: 'INCOME',
        amount: '9000000',
        occurredAt: currentMonthInstant(5),
        description: 'Thu nhập người dùng B',
      },
    }),
    'User B income',
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

test('opens from the sidebar and shows the period overview and charts', async () => {
  const { year, month } = hcmYearMonth();
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;

  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Xu hướng' }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole('heading', { name: 'Xu hướng thu nhập & chi tiêu' })).toBeVisible();

  const monthInput = page.getByLabel('Tháng', { exact: true });
  await expect(monthInput).toHaveValue(currentMonth);

  await expect(statCard('Thu nhập')).toContainText(/5\.000\.000/);
  await expect(statCard('Thu nhập')).toContainText(/\+25\.0%/);
  await expect(statCard('Chi tiêu')).toContainText(/2\.000\.000/);
  await expect(statCard('Chi tiêu')).toContainText('+100.0%');
  await expect(statCard('Dòng tiền ròng')).toContainText(/3\.000\.000/);
  await expect(statCard('Tỷ lệ tiết kiệm')).toContainText('60.0%');
  // The transfer pair must not inflate the count: only the two real rows count.
  await expect(statCard('Số giao dịch').locator('p').nth(1)).toHaveText('2');

  // The default tab shows the comparison, which lives with the overview KPIs.
  await expect(page.getByText('So sánh với kỳ trước')).toBeVisible();
  await expect(page.getByText('Thay đổi chi tiêu theo danh mục')).toBeVisible();
  await expect(page.getByText(foodCategoryName, { exact: true }).first()).toBeVisible();

  // Only the active tab is rendered; charts require opening the trends tab.
  await expect(page.locator('section[aria-label="Biểu đồ thu nhập và chi tiêu"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Xu hướng' }).click();
  await expect(page).toHaveURL(/\/analytics\?tab=trends$/);
  await expect(
    page.locator('section[aria-label="Biểu đồ thu nhập và chi tiêu"] svg').first(),
  ).toBeVisible();
  await expect(
    page.locator('section[aria-label="Biểu đồ dòng tiền ròng"] svg').first(),
  ).toBeVisible();
  await expect(page.getByText('Thu nhập và chi tiêu theo tháng')).toBeVisible();
  await expect(page.getByText('Dòng tiền ròng theo tháng')).toBeVisible();

  // Months inside the window without any transaction say so instead of showing 0.
  await expect(page.getByText('Không có dữ liệu').first()).toBeVisible();

  // Back/Forward follow the tab URL without a full reload.
  await page.goBack();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByText('So sánh với kỳ trước')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/analytics\?tab=trends$/);
  await expect(page.getByText('Dòng tiền ròng theo tháng')).toBeVisible();

  // The category breakdown lives on its own tab.
  await page.getByRole('tab', { name: 'Danh mục' }).click();
  await expect(page).toHaveURL(/\/analytics\?tab=categories$/);
  await expect(page.getByText('Cơ cấu nguồn thu theo danh mục')).toBeVisible();
  await expect(page.getByText(incomeCategoryName, { exact: true }).first()).toBeVisible();

  // Arrow keys move selection and focus like a standard tablist.
  await page.getByRole('tab', { name: 'Danh mục' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Xu hướng' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/\/analytics\?tab=trends$/);
  await expect(page.getByText('Dòng tiền ròng theo tháng')).toBeVisible();

  const overviewResponse = await page.request.get(
    `/api/v1/analytics/overview?period=month&currency=VND&month=${currentMonth}`,
  );
  expect(overviewResponse.ok()).toBeTruthy();
  const overview = (await overviewResponse.json()) as AnalyticsOverviewDto;
  expect(overview).toMatchObject({
    currency: 'VND',
    income: '5000000.00',
    expense: '2000000.00',
    net: '3000000.00',
    savingsRate: 60,
    transactionCount: 2,
    hasTransactions: true,
    estimated: false,
  });
  expect(overview.period).toMatchObject({ kind: 'month', label: currentMonth });
  expect(overview.previous.income).toBe('4000000.00');
  expect(overview.previous.expense).toBe('1000000.00');
  expect(overview.changes.income.percent).toBe(25);
  expect(overview.changes.expense.percent).toBe(100);
  expect(overview.availableCurrencies).toEqual(expect.arrayContaining(['VND', 'USD']));

  const trendsResponse = await page.request.get(
    `/api/v1/analytics/trends?months=6&month=${currentMonth}&currency=VND`,
  );
  expect(trendsResponse.ok()).toBeTruthy();
  const trends = (await trendsResponse.json()) as AnalyticsTrendsDto;
  expect(trends.points).toHaveLength(6);
  expect(trends.points[trends.points.length - 1]).toMatchObject({
    month: currentMonth,
    income: '5000000.00',
    expense: '2000000.00',
    net: '3000000.00',
    hasTransactions: true,
  });
  expect(trends.points.filter((point) => !point.hasTransactions)).toHaveLength(4);

  const incomeResponse = await page.request.get(
    `/api/v1/analytics/income?months=12&month=${currentMonth}&currency=VND`,
  );
  expect(incomeResponse.ok()).toBeTruthy();
  const income = (await incomeResponse.json()) as AnalyticsIncomeDto;
  expect(income).toMatchObject({
    total: '9000000.00',
    averageMonthly: '4500000.00',
    monthsWithIncome: 2,
  });
  expect(income.highest).toMatchObject({ month: currentMonth, amount: '5000000.00' });
  expect(income.sources).toHaveLength(1);
  expect(income.sources[0]).toMatchObject({
    categoryName: incomeCategoryName,
    total: '9000000.00',
    sharePercent: 100,
  });
  const expenseResponse = await page.request.get(
    `/api/v1/analytics/expenses?months=12&month=${currentMonth}&currency=VND`,
  );
  expect(expenseResponse.ok()).toBeTruthy();
  const expenses = (await expenseResponse.json()) as AnalyticsExpenseDto;
  expect(expenses).toMatchObject({
    total: '3000000.00',
    averageMonthly: '1500000.00',
    monthsWithExpense: 2,
  });
  expect(expenses.volatilityPercent).not.toBeNull();

  const comparisonResponse = await page.request.get(
    `/api/v1/analytics/period-comparison?period=month&currency=VND&month=${currentMonth}`,
  );
  expect(comparisonResponse.ok()).toBeTruthy();
  const comparison = (await comparisonResponse.json()) as AnalyticsPeriodComparisonDto;
  expect(comparison.current.income).toBe('5000000.00');
  expect(comparison.previous.income).toBe('4000000.00');
  expect(comparison.notableCategoryChanges[0]).toMatchObject({
    categoryName: foodCategoryName,
    direction: 'increase',
    changeAmount: '1000000.00',
    changePercent: 100,
  });
});

test('deep-links a tab and makes no request for unopened tabs', async () => {
  const analyticsRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/analytics/') || url.includes('/api/v1/ai/analytics/')) {
      analyticsRequests.push(url);
    }
  });

  await page.goto('/analytics?tab=categories');
  await expect(page).toHaveURL(/\/analytics\?tab=categories$/);
  await expect(page.getByText('Phân tích theo danh mục')).toBeVisible();

  await expect
    .poll(() => analyticsRequests.some((url) => url.includes('/analytics/categories?')))
    .toBe(true);
  // The categories tab loads its own panels plus the shared overview shell.
  expect(analyticsRequests.some((url) => url.includes('/analytics/trends?'))).toBe(false);
  expect(analyticsRequests.some((url) => url.includes('/analytics/forecast?'))).toBe(false);
  expect(analyticsRequests.some((url) => url.includes('/financial-health'))).toBe(false);
  expect(analyticsRequests.some((url) => url.includes('/ai/analytics/'))).toBe(false);

  await page.getByRole('tab', { name: 'Phân tích AI' }).click();
  await expect(page.getByLabel('Trợ lý phân tích AI')).toBeVisible();
  await expect
    .poll(() => analyticsRequests.some((url) => url.includes('/ai/analytics/summary')))
    .toBe(true);
  expect(analyticsRequests.some((url) => url.includes('/analytics/trends?'))).toBe(false);
});

test('changes the chart window and the comparison period', async () => {
  const { year, month } = hcmYearMonth();
  const quarter = Math.ceil(month / 3);
  const currentQuarter = `${year}-Q${quarter}`;
  // The previous month may or may not fall in the same quarter as today.
  const previousMonthNumber = month === 1 ? 12 : month - 1;
  const previousInQuarter = Math.ceil(previousMonthNumber / 3) === quarter;
  const quarterIncome = previousInQuarter ? 9000000 : 5000000;
  const quarterExpense = previousInQuarter ? 3000000 : 2000000;

  await page.goto('/analytics');
  await expect(statCard('Thu nhập')).toContainText(/5\.000\.000/);

  // The chart window control lives on the tab that renders the charts.
  await page.getByRole('tab', { name: 'Xu hướng' }).click();
  await expect(page.getByText('Thu nhập và chi tiêu theo tháng')).toBeVisible();
  const trendsResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/trends?') && response.url().includes('months=12'),
  );
  await page.getByLabel('Khoảng biểu đồ & phân tích tháng').selectOption('12');
  const trendsBody = (await (await trendsResponse).json()) as AnalyticsTrendsDto;
  expect(trendsBody.points).toHaveLength(12);
  await expect(page.getByText(/12 tháng gần nhất/).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  const quarterResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/overview?') &&
      response.url().includes('period=quarter'),
  );
  await page.getByLabel('Kỳ phân tích').selectOption('quarter');
  await expect(page.getByLabel('Quý', { exact: true })).toHaveValue(currentQuarter);

  const overview = (await (await quarterResponse).json()) as AnalyticsOverviewDto;
  expect(overview.period).toMatchObject({ kind: 'quarter', label: currentQuarter });
  expect(overview.income).toBe(`${quarterIncome}.00`);
  expect(overview.expense).toBe(`${quarterExpense}.00`);

  await expect(page.getByText(`Kỳ ${currentQuarter} (`)).toBeVisible();
  await expect(statCard('Thu nhập')).toContainText(
    new Intl.NumberFormat('vi-VN').format(quarterIncome),
  );
  await expect(statCard('Dòng tiền ròng')).toContainText(
    new Intl.NumberFormat('vi-VN').format(quarterIncome - quarterExpense),
  );
});

test('handles a custom period with no data and a zero baseline', async () => {
  await page.goto('/analytics');
  await expect(statCard('Thu nhập')).toContainText(/5\.000\.000/);

  await page.getByLabel('Kỳ phân tích').selectOption('custom');
  // Setting "to" first makes the range invalid until "from" is set, so the page
  // blocks the request instead of asking the API for a reversed range.
  await page.getByLabel('Đến ngày').fill('2001-01-31');
  await expect(page.getByText(/Khoảng ngày chưa hợp lệ/)).toBeVisible();

  const customResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/overview?') &&
      response.url().includes('period=custom') &&
      // Selecting "custom" first requests the period with the current month's
      // dates, so match the dates actually typed to avoid that earlier response.
      response.url().includes('from=2001-01-01') &&
      response.url().includes('to=2001-01-31'),
  );
  await page.getByLabel('Từ ngày').fill('2001-01-01');
  const overviewResponse = await customResponse;
  expect(overviewResponse.ok()).toBeTruthy();

  await expect(page.getByText(/Chưa có giao dịch thu hoặc chi trong kỳ/)).toBeVisible();
  await expect(statCard('Thu nhập')).toContainText(/0\s*₫/);
  await expect(statCard('Tỷ lệ tiết kiệm')).toContainText('—');

  const overview = (await overviewResponse.json()) as AnalyticsOverviewDto;
  expect(overview).toMatchObject({
    income: '0.00',
    expense: '0.00',
    net: '0.00',
    savingsRate: null,
    transactionCount: 0,
    hasTransactions: false,
  });
  expect(overview.changes.income.percent).toBeNull();
  expect(overview.changes.savingsRatePoints).toBeNull();
  expect(overview.previous.hasTransactions).toBe(false);

  // A period in the future is rejected by the API, not silently clamped.
  const future = await page.request.get(
    `/api/v1/analytics/overview?period=month&month=${new Date().getUTCFullYear() + 1}-01&currency=VND`,
  );
  expect(future.status()).toBe(400);
});

test('switches currency without mixing VND and USD', async () => {
  await page.goto('/analytics');
  await expect(statCard('Thu nhập')).toContainText(/5\.000\.000/);

  const currency = page.getByLabel('Tiền tệ');
  const usdResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/overview?') &&
      response.url().includes('currency=USD'),
  );
  await currency.selectOption('USD');
  const overview = (await (await usdResponse).json()) as AnalyticsOverviewDto;
  expect(overview).toMatchObject({
    currency: 'USD',
    income: '1000.00',
    expense: '0.00',
    net: '1000.00',
    savingsRate: 100,
    transactionCount: 1,
  });
  expect(overview.changes.income.percent).toBeNull();

  await expect(statCard('Thu nhập')).toContainText(/1\.000,00/);
  await expect(statCard('Thu nhập')).not.toContainText(/5\.000\.000/);
  await expect(statCard('Chi tiêu')).toContainText(/0,00/);
});

test('keeps each user’s figures isolated across browser sessions', async () => {
  await pageB.goto('/analytics');
  await expect(pageB.getByRole('heading', { name: 'Xu hướng thu nhập & chi tiêu' })).toBeVisible();
  await expect(statCardB('Thu nhập')).toContainText(/9\.000\.000/);
  await expect(statCardB('Thu nhập')).not.toContainText(/5\.000\.000/);

  const bOverview = await pageB.request.get('/api/v1/analytics/overview?period=month');
  expect(bOverview.ok()).toBeTruthy();
  expect(((await bOverview.json()) as AnalyticsOverviewDto).income).toBe('9000000.00');

  // The first user's figures are unchanged by the second user's data.
  const aOverview = await page.request.get('/api/v1/analytics/overview?period=month');
  expect(aOverview.ok()).toBeTruthy();
  expect(((await aOverview.json()) as AnalyticsOverviewDto).income).toBe('5000000.00');
});

/** Same as {@link statCard}, bound to the second browser context. */
function statCardB(label: string) {
  return pageB
    .locator('.card')
    .filter({ has: pageB.locator('p', { hasText: new RegExp(`^${label}$`) }) })
    .first();
}
