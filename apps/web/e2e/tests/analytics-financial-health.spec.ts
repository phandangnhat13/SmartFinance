import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { FinancialHealthDto, FinancialHealthHistoryDto } from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for the financial health score (M3d).
 *
 * Three throwaway users hit the real API and E2E database:
 *  - A is healthy: six complete months, budgets, an on-track goal and a small
 *    USD account used only for the currency switch;
 *  - B has no data at all, so every group must stay unscored;
 *  - C overspends, has no balance and an overdue goal, so the panel must show
 *    actionable suggestions without changing anything.
 *
 * The panel must read as a rule-based internal indicator: the formula is shown,
 * missing data is never rendered as a zero, and nothing here is a credit score.
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

function firstDayOfMonth(delta: number): string {
  const { year, month } = hcmDateParts();
  const target = shiftMonth(year, month, delta);
  return `${monthKey(target.year, target.month)}-01`;
}

/** Last calendar day of a month offset from the current one. */
function lastDayOfMonth(delta: number): string {
  const { year, month } = hcmDateParts();
  const target = shiftMonth(year, month, delta);
  const day = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
  return `${monthKey(target.year, target.month)}-${String(day).padStart(2, '0')}`;
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
        email: `health.${label}.${RUN}@example.com`,
        password: PASSWORD,
        displayName: `Health ${label} E2E`,
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
  type: 'EXPENSE' | 'INCOME',
): Promise<string> {
  const response = await api.post('/api/v1/categories', { data: { name, type } });
  await expectOk(response, `Category ${name}`);
  return ((await response.json()) as { category: { id: string } }).category.id;
}

async function createBudget(
  api: APIRequestContext,
  name: string,
  month: string,
  limitAmount: string,
): Promise<void> {
  await expectOk(
    await api.post('/api/v1/budgets', { data: { name, month, limitAmount } }),
    `Budget ${name}`,
  );
}

async function createGoal(
  api: APIRequestContext,
  data: { name: string; targetAmount: string; startDate: string; targetDate: string },
): Promise<string> {
  const response = await api.post('/api/v1/goals', { data: { ...data, currency: 'VND' } });
  await expectOk(response, `Goal ${data.name}`);
  return ((await response.json()) as { goal: { id: string } }).goal.id;
}

async function contribute(api: APIRequestContext, goalId: string, amount: string): Promise<void> {
  await expectOk(
    await api.post(`/api/v1/goals/${goalId}/contributions`, {
      data: { amount, contributedAt: new Date().toISOString() },
    }),
    `Contribution ${goalId}`,
  );
}

interface TransactionInput {
  accountId: string;
  categoryId: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  occurredAt: string;
  description: string;
  currency?: string;
}

async function addTransaction(
  api: APIRequestContext,
  data: TransactionInput,
  label: string,
): Promise<void> {
  await expectOk(await api.post('/api/v1/transactions', { data }), label);
}

let apiA: APIRequestContext;
let apiB: APIRequestContext;
let apiC: APIRequestContext;
let contextA: BrowserContext;
let contextB: BrowserContext;
let contextC: BrowserContext;
let pageA: Page;
let pageB: Page;
let pageC: Page;

const CURRENT = hcmDateParts();
const CURRENT_MONTH = monthKey(CURRENT.year, CURRENT.month);
const LAST_COMPLETE = shiftMonth(CURRENT.year, CURRENT.month, -1);

/** The five groups, in the order the engine reports them. */
const GROUPS = ['cash-flow', 'budget', 'savings', 'stability', 'forecast-risk'] as const;

test.beforeAll(async ({ browser }) => {
  apiA = await registerUser('a');
  apiB = await registerUser('b');
  apiC = await registerUser('c');

  const categories = await apiA.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const seeded = ((await categories.json()) as { items: CategoryItem[] }).items;
  const food = seeded.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!food) throw new Error('Seeded "food" expense category not found');

  /* --- user A: healthy profile ------------------------------------------- */
  const incomeA = await createCategory(apiA, 'Thu nhập E2E M3d', 'INCOME');
  const otherA = await createCategory(apiA, 'Chi khác E2E M3d', 'EXPENSE');
  const walletA = await createAccount(apiA, 'Ví sức khỏe E2E', 'VND', '20000000');
  const usdA = await createAccount(apiA, 'Ví USD sức khỏe E2E', 'USD', '100000');

  // Six complete months: income 10M, expense 7M (30% savings rate).
  for (let ago = 6; ago >= 1; ago -= 1) {
    const occurredAt = monthInstant(-ago);
    await addTransaction(
      apiA,
      {
        accountId: walletA,
        categoryId: incomeA,
        type: 'INCOME',
        amount: '10000000',
        occurredAt,
        description: `Thu nhập M3d tháng -${ago}`,
      },
      `Income -${ago}`,
    );
    await addTransaction(
      apiA,
      {
        accountId: walletA,
        categoryId: food.id,
        type: 'EXPENSE',
        amount: '2000000',
        occurredAt,
        description: `Ăn uống M3d tháng -${ago}`,
      },
      `Food -${ago}`,
    );
    await addTransaction(
      apiA,
      {
        accountId: walletA,
        categoryId: otherA,
        type: 'EXPENSE',
        amount: '5000000',
        occurredAt,
        description: `Chi khác M3d tháng -${ago}`,
      },
      `Other -${ago}`,
    );
  }

  // Current month: income 2M, expense 1M against a 10M budget.
  await addTransaction(
    apiA,
    {
      accountId: walletA,
      categoryId: incomeA,
      type: 'INCOME',
      amount: '2000000',
      occurredAt: currentMonthInstant(2),
      description: 'Thu nhập hiện tại M3d',
    },
    'Current income',
  );
  await addTransaction(
    apiA,
    {
      accountId: walletA,
      categoryId: food.id,
      type: 'EXPENSE',
      amount: '1000000',
      occurredAt: currentMonthInstant(3),
      description: 'Chi hiện tại M3d',
    },
    'Current expense',
  );
  // A USD expense only so the currency selector offers USD; the VND score
  // must ignore it completely.
  await addTransaction(
    apiA,
    {
      accountId: usdA,
      categoryId: food.id,
      type: 'EXPENSE',
      amount: '50000',
      currency: 'USD',
      occurredAt: monthInstant(-2),
      description: 'Chi USD M3d',
    },
    'USD expense',
  );

  await createBudget(apiA, 'Tổng chi M3d', CURRENT_MONTH, '10000000');
  for (const ago of [1, 2, 3]) {
    const month = shiftMonth(CURRENT.year, CURRENT.month, -ago);
    await createBudget(
      apiA,
      `Tổng chi M3d tháng -${ago}`,
      monthKey(month.year, month.month),
      '10000000',
    );
  }

  const goalA = await createGoal(apiA, {
    name: 'Quỹ dự phòng E2E M3d',
    targetAmount: '12000000',
    startDate: firstDayOfMonth(-6),
    targetDate: lastDayOfMonth(6),
  });
  await contribute(apiA, goalA, '7000000');

  /* --- user C: needs attention ------------------------------------------- */
  const incomeC = await createCategory(apiC, 'Thu nhập E2E M3d C', 'INCOME');
  const expenseC = await createCategory(apiC, 'Chi tiêu E2E M3d C', 'EXPENSE');
  const walletC = await createAccount(apiC, 'Ví E2E M3d C', 'VND', '0');

  for (let ago = 3; ago >= 1; ago -= 1) {
    const occurredAt = monthInstant(-ago);
    await addTransaction(
      apiC,
      {
        accountId: walletC,
        categoryId: incomeC,
        type: 'INCOME',
        amount: '10000000',
        occurredAt,
        description: `Thu nhập M3d C tháng -${ago}`,
      },
      `C income -${ago}`,
    );
    await addTransaction(
      apiC,
      {
        accountId: walletC,
        categoryId: expenseC,
        type: 'EXPENSE',
        amount: '11000000',
        occurredAt,
        description: `Chi M3d C tháng -${ago}`,
      },
      `C expense -${ago}`,
    );
  }
  await addTransaction(
    apiC,
    {
      accountId: walletC,
      categoryId: expenseC,
      type: 'EXPENSE',
      amount: '1500000',
      occurredAt: currentMonthInstant(4),
      description: 'Chi hiện tại M3d C',
    },
    'C current expense',
  );
  await createBudget(apiC, 'Hạn mức M3d C', CURRENT_MONTH, '1000000');
  await createGoal(apiC, {
    name: 'Mục tiêu quá hạn M3d C',
    targetAmount: '5000000',
    startDate: firstDayOfMonth(-4),
    targetDate: lastDayOfMonth(-1),
  });

  const open = async (api: APIRequestContext) =>
    browser.newContext({
      storageState: await api.storageState(),
      baseURL: E2E_WEB_ORIGIN,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });

  contextA = await open(apiA);
  contextB = await open(apiB);
  contextC = await open(apiC);
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  pageC = await contextC.newPage();
});

test.afterAll(async () => {
  await contextA?.close();
  await contextB?.close();
  await contextC?.close();
  await apiA?.dispose();
  await apiB?.dispose();
  await apiC?.dispose();
});

async function fetchHealth(page: Page, currency: string): Promise<FinancialHealthDto> {
  const response = await page.request.get(
    `/api/v1/analytics/financial-health?currency=${currency}`,
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as FinancialHealthDto;
}

test('returns a weighted score with every group, weight and the public formula', async () => {
  const body = await fetchHealth(pageA, 'VND');

  expect(body.currency).toBe('VND');
  expect(body.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(body.estimated).toBe(true);
  expect(body.formula).toContain('trọng số');
  expect(body.scoringRules.length).toBeGreaterThan(0);

  expect(body.groups.map((group) => group.key)).toEqual([...GROUPS]);
  expect(body.groups.map((group) => group.weight)).toEqual([25, 20, 20, 20, 15]);
  expect(body.groups.every((group) => group.status === 'scored')).toBe(true);
  expect(body.groups.map((group) => group.score)).toEqual([100, 100, 100, 80, 90]);

  expect(body.overall).toMatchObject({
    status: 'scored',
    score: 95,
    classification: 'EXCELLENT',
    availableWeight: 100,
    totalWeight: 100,
  });

  const cashFlow = body.groups.find((group) => group.key === 'cash-flow');
  expect(cashFlow?.evidence.map((item) => item.key)).toContain('savings_rate');
  expect(cashFlow?.evidence.find((item) => item.key === 'savings_rate')?.value).toBe('30%');

  // A healthy profile needs no corrective advice.
  expect(body.recommendations).toEqual([]);
  expect(body.dataQuality.monthsWithData).toBe(6);
  expect(body.dataQuality.scoredGroups).toBe(5);
  expect(body.historyAvailable).toBe(false);
});

test('rebuilds only cash-flow and budget for history and withholds a total', async () => {
  const response = await pageA.request.get(
    '/api/v1/analytics/financial-health/history?currency=VND&months=6',
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as FinancialHealthHistoryDto;

  expect(body.method).toBe('recomputed');
  expect(body.availableGroups).toEqual(['cash-flow', 'budget']);
  expect(body.overall).toBeNull();
  expect(body.months).toHaveLength(6);
  expect(body.limitations.length).toBeGreaterThan(0);

  // Cash flow is rebuilt for every complete month; budgets exist for the last
  // three, so the older months report missing data instead of a zero.
  expect(body.months.every((point) => point.cashFlow.score === 100)).toBe(true);
  expect(body.months.slice(3).map((point) => point.budget.score)).toEqual([100, 100, 100]);
  expect(body.months.slice(0, 3).every((point) => point.budget.score === null)).toBe(true);
});

test('renders the score, evidence, formula, history and the non-credit-score note', async () => {
  await pageA.goto('/analytics');
  const panel = pageA.getByRole('region', { name: 'Sức khỏe tài chính' });
  await expect(panel).toBeVisible();

  await expect(panel.getByText(/95\/100/).first()).toBeVisible();
  await expect(panel.getByText('Xuất sắc').first()).toBeVisible();
  await expect(panel.getByText(/100% trọng số khả dụng/).first()).toBeVisible();
  await expect(panel.getByText('Sức khỏe tài chính', { exact: true })).toBeVisible();

  const cashFlow = panel.locator('[aria-label="Nhóm Sức khỏe dòng tiền"]');
  await expect(cashFlow).toBeVisible();
  await expect(cashFlow).toContainText('100/100');
  await expect(cashFlow).toContainText('Trọng số 25%');
  await expect(cashFlow.getByText('Tỷ lệ tiết kiệm', { exact: true })).toBeVisible();
  await expect(cashFlow.getByText(/30%/).first()).toBeVisible();

  // The formula is public and the panel never looks like a gauge or a score dial.
  await expect(panel.getByText(/Điểm tổng =/)).toBeVisible();
  await expect(panel.getByText(/lần lượt được 50\/42\/32\/20 điểm/)).toBeVisible();
  await expect(panel.getByText(/Chỉ tính điểm tổng khi có ít nhất 3 nhóm/)).toBeVisible();
  await expect(panel.getByRole('note')).toContainText(/không phải điểm tín dụng/);
  await expect(panel.getByRole('progressbar')).toHaveCount(0);

  await expect(
    panel.getByText(
      'Không có gợi ý nào từ dữ liệu hiện tại. Điểm sẽ được tính lại khi dữ liệu thay đổi.',
    ),
  ).toBeVisible();

  await expect(panel.getByText('Lịch sử điểm (tính lại)')).toBeVisible();
  await expect(panel.getByText(/Chỉ nhóm Dòng tiền và Ngân sách tái tạo được/)).toBeVisible();
  await expect(
    panel.getByText(monthLabel(LAST_COMPLETE.year, LAST_COMPLETE.month)).first(),
  ).toBeVisible();
});

test('switches currency and withholds the total instead of scoring missing groups', async () => {
  await pageA.goto('/analytics');
  const panel = pageA.getByRole('region', { name: 'Sức khỏe tài chính' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/95\/100/).first()).toBeVisible();

  const responsePromise = pageA.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/analytics/financial-health?') &&
      response.url().includes('currency=USD'),
  );
  await pageA.locator('#analyticsCurrency').selectOption('USD');
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as FinancialHealthDto;

  // Budgets carry no currency in this model, so only that group survives the
  // switch; everything derived from VND transactions is withheld.
  expect(body.overall.status).toBe('insufficient_data');
  expect(body.overall.availableWeight).toBeLessThan(60);
  expect(body.groups.find((group) => group.key === 'cash-flow')?.score).toBeNull();
  expect(body.groups.find((group) => group.key === 'savings')?.score).toBeNull();
  expect(body.groups.find((group) => group.key === 'forecast-risk')?.score).toBeNull();

  await expect(panel.getByText('USD', { exact: true })).toBeVisible();
  await expect(panel.getByText('Chưa đủ dữ liệu để tính điểm tổng')).toBeVisible();
  await expect(panel.getByText('0/100', { exact: true })).toHaveCount(0);
});

test('explains a missing-data profile without inventing a score', async () => {
  await pageB.goto('/analytics');
  const panel = pageB.getByRole('region', { name: 'Sức khỏe tài chính' });
  await expect(panel).toBeVisible();

  await expect(panel.getByText('Chưa đủ dữ liệu để tính điểm tổng')).toBeVisible();
  await expect(panel.getByText(/0 nhóm, 0%/)).toBeVisible();
  await expect(panel.getByText('0/100', { exact: true })).toHaveCount(0);
  await expect(
    panel.getByText(/Nhóm thiếu dữ liệu không bao giờ được tính là 0 điểm/).first(),
  ).toBeVisible();
  await expect(panel.getByRole('note')).toContainText(/không phải điểm tín dụng/);
});

test('shows actionable suggestions for a struggling profile and changes nothing', async () => {
  const budgetsBefore = await (
    await pageC.request.get(`/api/v1/budgets?month=${CURRENT_MONTH}`)
  ).json();
  const transactionsBefore = (
    (await (await pageC.request.get('/api/v1/transactions?limit=100')).json()) as {
      items: Array<{ id: string }>;
    }
  ).items.map((item) => item.id);
  const goalsBefore = (
    (await (await pageC.request.get('/api/v1/goals?includeArchived=false')).json()) as {
      items: Array<{ id: string; savedAmount: string; status: string }>;
    }
  ).items.map((goal) => ({ id: goal.id, savedAmount: goal.savedAmount, status: goal.status }));

  const body = await fetchHealth(pageC, 'VND');
  expect(body.overall).toMatchObject({
    status: 'scored',
    score: 5,
    classification: 'NEEDS_ATTENTION',
  });
  expect(body.recommendations.map((item) => item.id)).toEqual([
    'cash-flow-savings-rate',
    'budget-exceeded',
    'savings-overdue',
    'stability-emergency-fund',
    'forecast-negative',
  ]);
  expect(body.recommendations.every((item) => item.requiresConfirmation)).toBe(true);

  await pageC.goto('/analytics');
  const panel = pageC.getByRole('region', { name: 'Sức khỏe tài chính' });
  await expect(panel).toBeVisible();

  await expect(panel.getByText('Cần cải thiện').first()).toBeVisible();
  await expect(panel.getByText(/5\/100/).first()).toBeVisible();
  await expect(panel.getByText('Gợi ý hành động')).toBeVisible();
  await expect(panel.locator('[aria-label^="Gợi ý: "]')).toHaveCount(5);

  const exceeded = panel.locator('[aria-label="Gợi ý: Đưa chi tiêu trở lại trong hạn mức"]');
  await expect(exceeded).toBeVisible();
  await expect(exceeded.getByText('Ưu tiên cao')).toBeVisible();
  await expect(exceeded.getByText(/Giảm ít nhất/)).toBeVisible();
  await expect(exceeded.getByText(/Ngân sách/)).toBeVisible();
  await expect(
    exceeded.getByText(/không tự thay đổi giao dịch, ngân sách hay mục tiêu/),
  ).toBeVisible();

  await expect(panel.locator('[aria-label="Gợi ý: Tăng tỷ lệ tiết kiệm lên 20%"]')).toBeVisible();

  const budgetsAfter = await (
    await pageC.request.get(`/api/v1/budgets?month=${CURRENT_MONTH}`)
  ).json();
  const transactionsAfter = (
    (await (await pageC.request.get('/api/v1/transactions?limit=100')).json()) as {
      items: Array<{ id: string }>;
    }
  ).items.map((item) => item.id);
  const goalsAfter = (
    (await (await pageC.request.get('/api/v1/goals?includeArchived=false')).json()) as {
      items: Array<{ id: string; savedAmount: string; status: string }>;
    }
  ).items.map((goal) => ({ id: goal.id, savedAmount: goal.savedAmount, status: goal.status }));

  expect(budgetsAfter).toEqual(budgetsBefore);
  expect(transactionsAfter).toEqual(transactionsBefore);
  expect(goalsAfter).toEqual(goalsBefore);
});
