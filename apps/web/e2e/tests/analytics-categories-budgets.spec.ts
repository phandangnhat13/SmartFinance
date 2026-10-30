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
  AnalyticsBudgetPaceDto,
  AnalyticsBudgetsDto,
  AnalyticsCategoriesDto,
  AnalyticsCategoryRowDto,
} from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for category & budget analytics (M3b).
 *
 * Two throwaway users are registered against the real API and the real E2E
 * database; nothing is stubbed. The fixture deliberately contains:
 * - two separate categories with the *same* display name (grouping by id),
 * - an archived category that still has historical transactions,
 * - a USD expense that must never enter the VND figures,
 * - budgets for the current and the previous month.
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

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

function previousMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** An instant guaranteed to be inside the current HCM calendar month. */
function currentMonthInstant(minutesAgo: number): string {
  const now = Date.now();
  const { year, month } = hcmDateParts();
  const monthStart = Date.UTC(year, month - 1, 1) - HCM_OFFSET_MS;
  return new Date(Math.max(monthStart + 60_000, now - minutesAgo * 60_000)).toISOString();
}

/** Noon local time on day 15 of the previous month, safely inside it. */
function previousMonthInstant(): string {
  const { year, month } = hcmDateParts();
  const previous = previousMonthOf(year, month);
  return new Date(Date.UTC(previous.year, previous.month - 1, 15, 5, 0, 0)).toISOString();
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
        email: `categories.${label}.${RUN}@example.com`,
        password: PASSWORD,
        displayName: `Category ${label} E2E`,
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

const ARCHIVED_NAME = 'Danh mục lưu trữ E2E';

let api: APIRequestContext;
let apiB: APIRequestContext;
let browserContext: BrowserContext;
let browserContextB: BrowserContext;
let page: Page;
let pageB: Page;
let foodCategoryId: string;
let foodCategoryName: string;
let incomeCategoryId: string;
let incomeCategoryName: string;
let sameCategoryAId: string;
let archivedCategoryId: string;
let budgetAllId: string;
let budgetFoodId: string;
let budgetSameNameId: string;
let budgetPreviousId: string;

const CURRENT = hcmDateParts();
const CURRENT_MONTH = monthKey(CURRENT.year, CURRENT.month);
const PREVIOUS = previousMonthOf(CURRENT.year, CURRENT.month);
const PREVIOUS_MONTH = monthKey(PREVIOUS.year, PREVIOUS.month);

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

  // A user category deliberately sharing the seeded system category's name:
  // the API must group by id, not by display name.
  sameCategoryAId = await createCategory(api, foodCategoryName);
  archivedCategoryId = await createCategory(api, ARCHIVED_NAME);

  const vndAccountId = await createAccount(api, 'Ví VND E2E', 'VND', '0');
  const usdAccountId = await createAccount(api, 'Ví USD E2E', 'USD', '100000000');

  const create = async (data: Record<string, unknown>, label: string) => {
    await expectOk(await api.post('/api/v1/transactions', { data }), label);
  };

  // Current month, VND: 4,000,000 income and 2,400,000 expense.
  await create(
    {
      accountId: vndAccountId,
      categoryId: incomeCategoryId,
      type: 'INCOME',
      amount: '4000000',
      occurredAt: currentMonthInstant(2),
      description: 'Thu nhập M3b E2E',
    },
    'Current income',
  );
  await create(
    {
      accountId: vndAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '2000000',
      occurredAt: currentMonthInstant(3),
      description: 'Ăn uống M3b E2E',
    },
    'Current food expense',
  );
  await create(
    {
      accountId: vndAccountId,
      categoryId: sameCategoryAId,
      type: 'EXPENSE',
      amount: '100000',
      occurredAt: currentMonthInstant(4),
      description: 'Trùng tên M3b E2E',
    },
    'Same-name expense',
  );
  await create(
    {
      accountId: vndAccountId,
      categoryId: archivedCategoryId,
      type: 'EXPENSE',
      amount: '300000',
      occurredAt: currentMonthInstant(6),
      description: 'Danh mục sẽ lưu trữ M3b E2E',
    },
    'Archived-category expense',
  );

  // Previous month, VND: 3,000,000 income and 1,000,000 food expense.
  await create(
    {
      accountId: vndAccountId,
      categoryId: incomeCategoryId,
      type: 'INCOME',
      amount: '3000000',
      occurredAt: previousMonthInstant(),
      description: 'Thu nhập tháng trước M3b E2E',
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
      description: 'Ăn uống tháng trước M3b E2E',
    },
    'Previous food expense',
  );

  // A different currency that must never be added into the VND figures.
  await create(
    {
      accountId: usdAccountId,
      categoryId: foodCategoryId,
      type: 'EXPENSE',
      amount: '9000000',
      occurredAt: currentMonthInstant(7),
      description: 'Chi tiêu USD M3b E2E',
    },
    'USD expense',
  );

  // Archive after the transaction exists: history must stay visible.
  await expectOk(
    await api.patch(`/api/v1/categories/${archivedCategoryId}`, {
      data: { isArchived: true },
    }),
    'Archive category',
  );

  const createBudget = async (data: Record<string, unknown>, label: string) => {
    const response = await api.post('/api/v1/budgets', { data });
    await expectOk(response, label);
    return ((await response.json()) as { budget: { id: string } }).budget.id;
  };

  budgetAllId = await createBudget(
    { name: 'Tổng chi M3b', month: CURRENT_MONTH, limitAmount: '5000000' },
    'All budget',
  );
  budgetFoodId = await createBudget(
    {
      name: 'Ăn uống M3b',
      categoryId: foodCategoryId,
      month: CURRENT_MONTH,
      limitAmount: '2000000',
    },
    'Food budget',
  );
  budgetSameNameId = await createBudget(
    {
      name: 'Trùng tên M3b',
      categoryId: sameCategoryAId,
      month: CURRENT_MONTH,
      limitAmount: '120000',
    },
    'Same-name budget',
  );
  budgetPreviousId = await createBudget(
    { name: 'Tổng chi tháng trước M3b', month: PREVIOUS_MONTH, limitAmount: '2000000' },
    'Previous budget',
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

function categoryRow(body: AnalyticsCategoriesDto, id: string | null): AnalyticsCategoryRowDto {
  const row = body.categories.find((item) => item.categoryId === id);
  if (!row) throw new Error(`Category row ${id} missing`);
  return row;
}

test('groups categories by id, keeps archived history and flags notable increases', async () => {
  const categoriesUrl =
    `/api/v1/analytics/categories?period=month&month=${CURRENT_MONTH}` +
    `&currency=VND&type=EXPENSE&months=6&categoryId=${foodCategoryId}`;
  const response = await page.request.get(categoriesUrl);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as AnalyticsCategoriesDto;

  expect(body).toMatchObject({
    currency: 'VND',
    type: 'EXPENSE',
    estimated: false,
    total: '2400000.00',
    previousTotal: '1000000.00',
    hasTransactions: true,
    monthsInPeriod: 1,
    notableIncreasePercent: 25,
  });
  expect(body.period).toMatchObject({ kind: 'month', label: CURRENT_MONTH });
  expect(body.previousPeriod).toMatchObject({ kind: 'month', label: PREVIOUS_MONTH });
  // The USD expense is excluded from the VND total.
  expect(body.categories.reduce((sum, row) => sum + Number(row.total), 0)).toBe(2_400_000);

  const food = categoryRow(body, foodCategoryId);
  expect(food).toMatchObject({
    categoryName: foodCategoryName,
    total: '2000000.00',
    previousTotal: '1000000.00',
    transactionCount: 1,
    sharePercent: 83.33,
    averageMonthly: '2000000.00',
    changeAmount: '1000000.00',
    changePercent: 100,
    direction: 'increase',
    notableIncrease: true,
    isNew: false,
    isRemoved: false,
  });

  // The seeded system "food" category and the user category that deliberately
  // reuses its name stay separate rows with separate ids.
  const sameNameRows = body.categories.filter((row) => row.categoryName === foodCategoryName);
  expect(sameNameRows).toHaveLength(2);
  expect(new Set(sameNameRows.map((row) => row.categoryId))).toEqual(
    new Set([foodCategoryId, sameCategoryAId]),
  );
  const userSameName = categoryRow(body, sameCategoryAId);
  expect(userSameName).toMatchObject({
    categoryName: foodCategoryName,
    total: '100000.00',
    transactionCount: 1,
    isNew: true,
    previousTotal: '0.00',
  });

  const archived = categoryRow(body, archivedCategoryId);
  expect(archived).toMatchObject({
    categoryName: ARCHIVED_NAME,
    isArchived: true,
    total: '300000.00',
    transactionCount: 1,
  });

  // The per-month series is bucketed in the user's timezone and left blank for
  // months without that category.
  const trend = body.trend;
  if (!trend) throw new Error('Category trend missing');
  expect(trend.categoryId).toBe(foodCategoryId);
  expect(trend.points).toHaveLength(6);
  const lastPoint = trend.points[trend.points.length - 1];
  expect(lastPoint).toMatchObject({
    month: CURRENT_MONTH,
    amount: '2000000.00',
    hasTransactions: true,
  });
  const previousPoint = trend.points.find((point) => point.month === PREVIOUS_MONTH);
  expect(previousPoint).toMatchObject({ amount: '1000000.00', hasTransactions: true });
  expect(trend.points.filter((point) => !point.hasTransactions).length).toBe(4);

  const incomeResponse = await page.request.get(
    `/api/v1/analytics/categories?period=month&month=${CURRENT_MONTH}` +
      `&currency=VND&type=INCOME&months=6`,
  );
  expect(incomeResponse.ok()).toBeTruthy();
  const incomeBody = (await incomeResponse.json()) as AnalyticsCategoriesDto;
  expect(incomeBody.total).toBe('4000000.00');
  expect(incomeBody.previousTotal).toBe('3000000.00');
  expect(incomeBody.categories).toHaveLength(1);
  expect(incomeBody.categories[0]).toMatchObject({
    categoryId: incomeCategoryId,
    categoryName: incomeCategoryName,
    total: '4000000.00',
    changePercent: 33.33,
    direction: 'increase',
  });

  // The page prints the same figures and the badges, not its own maths.
  await page.goto('/analytics?tab=categories');
  const categoryPanel = page.locator('section[aria-label="Phân tích theo danh mục"]');
  await expect(categoryPanel).toBeVisible();
  await expect(categoryPanel).toContainText(foodCategoryName);
  await expect(categoryPanel.getByText('Tăng ≥ 25%')).toBeVisible();
  const sameNameRowsInTable = categoryPanel
    .locator('tbody tr')
    .filter({ hasText: foodCategoryName });
  await expect(sameNameRowsInTable).toHaveCount(2);
  const archivedRow = categoryPanel.locator('tbody tr').filter({ hasText: ARCHIVED_NAME });
  await expect(archivedRow).toContainText('Đã lưu trữ');
  await expect(categoryPanel.getByText(/hai danh mục trùng tên vẫn được tính riêng/)).toBeVisible();
  await expect(categoryPanel.getByText(/Ngưỡng “tăng đáng chú ý” là 25%/)).toBeVisible();
  // Choosing a category in the panel requests its monthly series; the trend is
  // never interpolated across months where the category had no transaction.
  const trendResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes('/api/v1/analytics/categories?') &&
      candidate.url().includes(`categoryId=${foodCategoryId}`),
  );
  await categoryPanel.getByLabel('Danh mục xem xu hướng').selectOption(foodCategoryId);
  const trendBody = (await (await trendResponse).json()) as AnalyticsCategoriesDto;
  expect(trendBody.trend?.categoryId).toBe(foodCategoryId);
  await expect(
    categoryPanel.getByText(/Tháng không có giao dịch của danh mục được để trống/),
  ).toBeVisible();
  await expect(categoryPanel.locator('svg').first()).toBeVisible();
});

test('classifies budgets and reports pace without writing any data', async () => {
  const budgetsUrl = `/api/v1/analytics/budgets?month=${CURRENT_MONTH}&currency=VND`;
  const response = await page.request.get(budgetsUrl);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as AnalyticsBudgetsDto;

  expect(body).toMatchObject({
    currency: 'VND',
    month: CURRENT_MONTH,
    estimated: false,
    monthStatus: 'in_progress',
    assumesLimitCurrency: 'VND',
  });
  // The previous-month budget is not part of this month's list.
  expect(body.items.map((item) => item.id)).not.toContain(budgetPreviousId);
  expect(body.items).toHaveLength(3);
  expect(body.summary).toEqual({
    budgetCount: 3,
    exceededCount: 1,
    warningCount: 1,
    onTrackCount: 1,
    notStartedCount: 0,
    completedCount: 0,
  });

  const all = body.items.find((item) => item.id === budgetAllId);
  if (!all) throw new Error('All-scope budget missing');
  expect(all).toMatchObject({
    categoryId: null,
    limitAmount: '5000000.00',
    spent: '2400000.00',
    remaining: '2600000.00',
    usagePercent: 48,
    status: 'ON_TRACK',
    transactionCount: 3,
    periodStart: `${CURRENT_MONTH}-01`,
    totalDays: daysInMonth(CURRENT.year, CURRENT.month),
    daysElapsed: CURRENT.day,
    daysRemaining: daysInMonth(CURRENT.year, CURRENT.month) - CURRENT.day,
  });

  const food = body.items.find((item) => item.id === budgetFoodId);
  if (!food) throw new Error('Food budget missing');
  expect(food).toMatchObject({
    categoryId: foodCategoryId,
    categoryName: foodCategoryName,
    limitAmount: '2000000.00',
    spent: '2000000.00',
    remaining: '0.00',
    usagePercent: 100,
    status: 'EXCEEDED',
    transactionCount: 1,
    // The USD expense in the same category must not count.
  });
  expect(food.spent).toBe('2000000.00');

  const sameName = body.items.find((item) => item.id === budgetSameNameId);
  if (!sameName) throw new Error('Same-name budget missing');
  expect(sameName).toMatchObject({
    categoryId: sameCategoryAId,
    spent: '100000.00',
    status: 'WARNING',
    usagePercent: 83.33,
    warningThreshold: 80,
  });

  // Linear pace follows the documented formula exactly.
  for (const item of body.items) {
    expect(item.expectedSpend).not.toBeNull();
    const expected = (Number(item.limitAmount) * item.daysElapsed) / item.totalDays;
    expect(Math.abs(Number(item.expectedSpend) - expected)).toBeLessThan(0.01);
    const variance = Number(item.spent) - expected;
    expect(Math.abs(Number(item.variance) - variance)).toBeLessThan(0.01);
    if (item.expectedSpend && Number(item.expectedSpend) > 0) {
      const pace = (Number(item.spent) / Number(item.expectedSpend)) * 100;
      expect(item.pacePercent).not.toBeNull();
      expect(Math.abs((item.pacePercent ?? 0) - pace)).toBeLessThan(0.01);
    }
  }

  const previousPace = await page.request.get(
    `/api/v1/analytics/budget-pace?month=${PREVIOUS_MONTH}&currency=VND`,
  );
  expect(previousPace.ok()).toBeTruthy();
  const previousPaceBody = (await previousPace.json()) as AnalyticsBudgetPaceDto;
  const ended = previousPaceBody.items.find((item) => item.budgetId === budgetPreviousId);
  if (!ended) throw new Error('Previous budget pace missing');
  expect(ended).toMatchObject({
    status: 'COMPLETED',
    spent: '1000000.00',
    expectedSpend: '2000000.00',
    variance: '-1000000.00',
    pacePercent: 50,
    estimatedExhaustionDate: null,
    exhaustionProjection: 'period_ended',
  });

  // Reading analytics twice must not change transactions or budgets/alerts.
  const transactionsBefore = await page.request.get('/api/v1/transactions?limit=100');
  await expectOk(transactionsBefore, 'Transactions before');
  const idsBefore = (
    (await transactionsBefore.json()) as { items: Array<{ id: string }> }
  ).items.map((item) => item.id);
  const budgetsBefore = await page.request.get(`/api/v1/budgets?month=${CURRENT_MONTH}`);
  await expectOk(budgetsBefore, 'Budgets before');
  const budgetsBeforeBody = (await budgetsBefore.json()) as {
    items: Array<{ id: string; alerts: unknown[] }>;
  };

  await page.request.get(budgetsUrl);
  await page.request.get(`/api/v1/analytics/budget-pace?month=${CURRENT_MONTH}&currency=VND`);
  await page.request.get(
    `/api/v1/analytics/categories?period=month&month=${CURRENT_MONTH}&currency=VND`,
  );

  const budgetsAfter = await page.request.get(`/api/v1/budgets?month=${CURRENT_MONTH}`);
  await expectOk(budgetsAfter, 'Budgets after');
  const budgetsAfterBody = (await budgetsAfter.json()) as {
    items: Array<{ id: string; alerts: unknown[] }>;
  };
  expect(budgetsAfterBody).toEqual(budgetsBeforeBody);
  const transactionsAfter = await page.request.get('/api/v1/transactions?limit=100');
  const idsAfter = ((await transactionsAfter.json()) as { items: Array<{ id: string }> }).items.map(
    (item) => item.id,
  );
  expect(idsAfter).toEqual(idsBefore);

  // The page renders the statuses and pace wording from the API response.
  await page.goto('/analytics?tab=categories');
  const budgetPanel = page.locator('section[aria-label="Ngân sách tháng"]');
  await expect(budgetPanel).toBeVisible();
  await expect(
    budgetPanel.getByRole('heading', {
      name: `Ngân sách tháng ${monthLabel(CURRENT.year, CURRENT.month)}`,
    }),
  ).toBeVisible();
  await expect(budgetPanel.getByText('1 vượt hạn mức', { exact: true })).toBeVisible();
  await expect(budgetPanel.getByText('1 sắp chạm ngưỡng', { exact: true })).toBeVisible();
  await expect(budgetPanel.getByText('1 trong mức', { exact: true })).toBeVisible();

  const foodCard = budgetPanel.locator('li').filter({ hasText: 'Ăn uống M3b' });
  await expect(foodCard).toContainText('Vượt hạn mức');
  await expect(foodCard).toContainText('Hạn mức đã được sử dụng hết hoặc vượt');
  const sameNameCard = budgetPanel.locator('li').filter({ hasText: 'Trùng tên M3b' });
  await expect(sameNameCard).toContainText('Sắp chạm ngưỡng');
  const allCard = budgetPanel.locator('li').filter({ hasText: 'Tổng chi M3b' });
  await expect(allCard).toContainText('Trong mức');
  await expect(budgetPanel.getByText(/hạn mức được đọc theo VND/)).toBeVisible();
  await expect(budgetPanel.getByText(/Hệ thống không tự thay đổi ngân sách/)).toBeVisible();
  await expect(budgetPanel.getByText(/Mức chi tuyến tính đến hôm nay:/).first()).toBeVisible();
});

test('switches category type and shows the empty budget state for a new user', async () => {
  await page.goto('/analytics?tab=categories');
  const categoryPanel = page.locator('section[aria-label="Phân tích theo danh mục"]');
  await expect(categoryPanel).toContainText(foodCategoryName);

  const incomeResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/categories?') &&
      response.url().includes('type=INCOME'),
  );
  await page.getByLabel('Danh mục thu / chi').selectOption('INCOME');
  const incomeBody = (await (await incomeResponse).json()) as AnalyticsCategoriesDto;
  expect(incomeBody.type).toBe('INCOME');
  expect(incomeBody.total).toBe('4000000.00');

  await expect(
    categoryPanel.locator('tbody').getByText(incomeCategoryName, { exact: true }).first(),
  ).toBeVisible();
  await expect(categoryPanel).toContainText(/thu nhập/);
  // The expense categories are no longer listed.
  await expect(categoryPanel.getByText(ARCHIVED_NAME, { exact: true })).toHaveCount(0);

  // The same analytics page is genuinely empty for a brand-new user.
  await pageB.goto('/analytics?tab=categories');
  await expect(pageB.getByRole('heading', { name: 'Xu hướng thu nhập & chi tiêu' })).toBeVisible();
  const budgetPanelB = pageB.locator('section[aria-label="Ngân sách tháng"]');
  await expect(budgetPanelB).toBeVisible();
  await expect(
    budgetPanelB.getByText(
      `Chưa có ngân sách cho tháng ${monthLabel(CURRENT.year, CURRENT.month)}`,
    ),
  ).toBeVisible();
  await expect(budgetPanelB.getByRole('link', { name: 'Tạo ngân sách' })).toHaveAttribute(
    'href',
    '/budgets',
  );
  // With no transactions at all, the page reports "no data" rather than zeroes.
  await expect(
    pageB.locator('section[aria-label="Phân tích theo danh mục"]').getByText(/Không có giao dịch/),
  ).toBeVisible();
});

// `request.newContext()` inherits the runner's storageState, so an anonymous
// context has to clear it explicitly.
const ANONYMOUS_STATE = { cookies: [], origins: [] };

test('requires authentication and rejects invalid analytics filters', async () => {
  const anonymous = await newRequest.newContext({
    baseURL: E2E_API_ORIGIN,
    storageState: ANONYMOUS_STATE,
  });
  try {
    expect(
      (await anonymous.get(`/api/v1/analytics/categories?period=month&currency=VND`)).status(),
    ).toBe(401);
    expect((await anonymous.get(`/api/v1/analytics/budgets?month=${CURRENT_MONTH}`)).status()).toBe(
      401,
    );
    expect((await anonymous.get('/api/v1/analytics/budget-pace')).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  expect(
    (await page.request.get(`/api/v1/analytics/categories?type=BOGUS&currency=VND`)).status(),
  ).toBe(400);
  expect(
    (await page.request.get(`/api/v1/analytics/categories?months=5&currency=VND`)).status(),
  ).toBe(400);
  expect(
    (await page.request.get(`/api/v1/analytics/budgets?month=2026-13&currency=VND`)).status(),
  ).toBe(400);
  expect((await page.request.get(`/api/v1/analytics/budget-pace?month=not-a-month`)).status()).toBe(
    400,
  );
});
