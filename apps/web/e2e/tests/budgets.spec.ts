import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for the Stage 3 budget page: summary cards, the desktop table,
 * the mobile card list, and deletion through the shared ConfirmDialog instead
 * of a native window.confirm.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
const PASSWORD = 'E2ePassword123!';

function hcmYearMonth(): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const [year, month] = formatted.split('-').map(Number);
  return { year, month };
}

function currentMonthKey(): string {
  const { year, month } = hcmYearMonth();
  return `${year}-${String(month).padStart(2, '0')}`;
}

function nextMonthKey(): string {
  const { year, month } = hcmYearMonth();
  const ordinal = year * 12 + month;
  return `${Math.floor(ordinal / 12)}-${String((ordinal % 12) + 1).padStart(2, '0')}`;
}

function currentMonthInstant(minutesAgo: number): string {
  const now = Date.now();
  const { year, month } = hcmYearMonth();
  const monthStart = Date.UTC(year, month - 1, 1) - HCM_OFFSET_MS;
  return new Date(Math.max(monthStart + 60_000, now - minutesAgo * 60_000)).toISOString();
}

async function expectOk(response: APIResponse, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
}

let api: APIRequestContext;
let browserContext: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  api = await newRequest.newContext({ baseURL: E2E_API_ORIGIN });
  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: {
        email: `budgets.${RUN}@example.com`,
        password: PASSWORD,
        displayName: 'Budget E2E',
      },
    }),
    'Register',
  );

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = (
    (await categories.json()) as { items: Array<{ id: string; slug: string | null; type: string }> }
  ).items;
  const food = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!food) throw new Error('Seeded "food" category not found');

  const account = await api.post('/api/v1/accounts', {
    data: { name: 'Ví ngân sách E2E', type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(account, 'Account');
  const accountId = ((await account.json()) as { account: { id: string } }).account.id;

  const category = await api.post('/api/v1/categories', {
    data: { name: 'Trùng tên ngân sách E2E', type: 'EXPENSE' },
  });
  await expectOk(category, 'Custom category');
  const customCategoryId = ((await category.json()) as { category: { id: string } }).category.id;

  const createExpense = async (categoryId: string, amount: string, label: string) => {
    await expectOk(
      await api.post('/api/v1/transactions', {
        data: {
          accountId,
          categoryId,
          type: 'EXPENSE',
          amount,
          occurredAt: currentMonthInstant(2),
          description: label,
        },
      }),
      label,
    );
  };
  await createExpense(food.id, '2000000', 'Ăn uống ngân sách E2E');
  await createExpense(customCategoryId, '100000', 'Trùng tên ngân sách E2E');

  const month = currentMonthKey();
  const createBudget = async (data: Record<string, unknown>, label: string) => {
    await expectOk(await api.post('/api/v1/budgets', { data: { ...data, month } }), label);
  };
  await createBudget({ name: 'Tổng chi ngân sách E2E', limitAmount: '5000000' }, 'All budget');
  await createBudget(
    { name: 'Ăn uống ngân sách E2E', categoryId: food.id, limitAmount: '2000000' },
    'Food budget',
  );
  await createBudget(
    {
      name: 'Trùng tên ngân sách E2E',
      categoryId: customCategoryId,
      limitAmount: '120000',
    },
    'Custom budget',
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

function summaryCard(label: string) {
  return page
    .locator('.card')
    .filter({ has: page.locator('p', { hasText: new RegExp(`^${label}$`) }) })
    .first();
}

test('shows the month summary, statuses and a scannable desktop table', async () => {
  const month = currentMonthKey();
  await page.goto('/budgets');
  await expect(page.getByRole('heading', { name: 'Ngân sách', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tháng', { exact: true })).toHaveValue(month);

  await expect(summaryCard('Tổng hạn mức')).toContainText(/7\.120\.000/);
  await expect(summaryCard('Đã chi')).toContainText(/4\.200\.000/);
  await expect(summaryCard('Còn lại')).toContainText(/2\.920\.000/);
  await expect(summaryCard('Cần chú ý')).toContainText('2');
  await expect(summaryCard('Cần chú ý')).toContainText('1 vượt hạn mức · 1 sắp chạm');

  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  for (const header of ['Ngân sách', 'Hạn mức', 'Đã chi', 'Còn lại', 'Tiến độ', 'Trạng thái']) {
    await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
  }
  const budgetRow = table.locator('tbody tr').filter({ hasText: 'Tổng chi ngân sách E2E' });
  await expect(budgetRow).toContainText('Toàn bộ chi tiêu');
  await expect(budgetRow.getByText('Trong mức')).toBeVisible();
  await expect(
    table.locator('tbody tr').filter({ hasText: 'Ăn uống ngân sách E2E' }),
  ).toContainText('Vượt hạn mức');
  await expect(
    table.locator('tbody tr').filter({ hasText: 'Trùng tên ngân sách E2E' }).first(),
  ).toContainText('Sắp chạm');

  // Filtering narrows the list without changing the summary.
  await page.getByLabel('Trạng thái').selectOption('EXCEEDED');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr').first()).toContainText('Ăn uống ngân sách E2E');
  await expect(summaryCard('Tổng hạn mức')).toContainText(/7\.120\.000/);
  await page.getByLabel('Trạng thái').selectOption('all');
});

test('opens the edit form and closes it without writing', async () => {
  await page.goto('/budgets');
  await page.getByRole('button', { name: 'Sửa Ăn uống ngân sách E2E' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa ngân sách' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tên ngân sách')).toHaveValue('Ăn uống ngân sách E2E');
  await expect(dialog.getByLabel('Hạn mức')).toHaveValue('2000000.00');
  await dialog.getByRole('button', { name: 'Huỷ' }).click();
  await expect(dialog).toHaveCount(0);
});

test('keeps its structure while loading and recovers from a list error', async () => {
  const pattern = /\/api\/v1\/budgets\?month=/;
  await page.route(pattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto('/budgets');
  await expect(page.getByRole('status', { name: 'Đang tải ngân sách' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.unroute(pattern);

  await page.route(pattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'Lỗi máy chủ thử nghiệm' }),
    }),
  );
  await page.getByLabel('Tháng', { exact: true }).fill(nextMonthKey());
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Lỗi máy chủ thử nghiệm');
  await page.unroute(pattern);
  await alert.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Chưa có ngân sách cho tháng này')).toBeVisible();
});

test('deletes through the shared confirmation dialog, not window.confirm', async () => {
  const month = currentMonthKey();
  await page.goto('/budgets');

  const nativeDialogs: string[] = [];
  page.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });

  await page.getByRole('button', { name: 'Xoá Tổng chi ngân sách E2E' }).click();
  const dialog = page.getByRole('dialog', { name: 'Xoá ngân sách' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Tổng chi ngân sách E2E');

  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().includes('/api/v1/budgets/') &&
      response.ok(),
  );
  await dialog.getByRole('button', { name: 'Xoá ngân sách' }).click();
  await deleted;

  await expect(page.getByText('Tổng chi ngân sách E2E')).toHaveCount(0);
  expect(nativeDialogs).toEqual([]);

  const after = await page.request.get(`/api/v1/budgets?month=${month}`);
  expect(after.ok()).toBeTruthy();
  const remaining = ((await after.json()) as { items: Array<{ name: string }> }).items.map(
    (item) => item.name,
  );
  expect(remaining).not.toContain('Tổng chi ngân sách E2E');
});

test('uses the mobile card list without horizontal overflow', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/budgets');
  await expect(page.getByRole('heading', { name: 'Ngân sách', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Ăn uống ngân sách E2E').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sửa Ăn uống ngân sách E2E' })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
