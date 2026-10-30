import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { InsightsMonthlyDto } from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for Savings Goals.
 *
 * The spec registers its own throwaway user so its goals never mix with the
 * shared global-setup user. Goals, contributions and status changes all go
 * through the real UI and the real API; only the seed transactions behind the
 * reference panel are created directly through `POST /transactions`.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = 'E2ePassword123!';

interface CategoryItem {
  id: string;
  slug: string | null;
  type: string;
}

/** Calendar date (YYYY-MM-DD) in Asia/Ho_Chi_Minh, offset by whole days. */
function hcmDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
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

  const email = `goals.e2e.${RUN}@example.com`;
  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: { email, password: PASSWORD, displayName: 'Goals E2E' },
    }),
    'Register',
  );

  const account = await api.post('/api/v1/accounts', {
    data: { name: 'Ví VND', type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(account, 'Account');
  const accountId = ((await account.json()) as { account: { id: string } }).account.id;

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = ((await categories.json()) as { items: CategoryItem[] }).items;
  const income = items.find((item) => item.type === 'INCOME');
  const expense = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!income || !expense) throw new Error('Seeded categories are required for this spec');

  const occurredAt = new Date(Date.now() - 3 * 60_000).toISOString();
  // One month of real transactions so the reference panel has figures to show.
  await expectOk(
    await api.post('/api/v1/transactions', {
      data: {
        accountId,
        categoryId: income.id,
        type: 'INCOME',
        amount: '10000000',
        occurredAt,
        description: 'Thu nhập E2E goals',
      },
    }),
    'Income',
  );
  await expectOk(
    await api.post('/api/v1/transactions', {
      data: {
        accountId,
        categoryId: expense.id,
        type: 'EXPENSE',
        amount: '4000000',
        occurredAt,
        description: 'Chi tiêu E2E goals',
      },
    }),
    'Expense',
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

test('creates goals in two currencies, records savings and keeps currencies separate', async () => {
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Mục tiêu tiết kiệm' })).toBeVisible();
  await expect(page.getByText('Chưa có mục tiêu')).toBeVisible();

  await page.getByRole('button', { name: 'Thêm mục tiêu' }).first().click();
  await page.getByLabel('Tên mục tiêu', { exact: true }).fill('Mua laptop E2E');
  await page.getByLabel('Mô tả (tuỳ chọn)').fill('Laptop cho công việc');
  await page.getByLabel('Số tiền mục tiêu', { exact: true }).fill('30000000');
  await page.getByLabel('Ngày đích (tuỳ chọn)').fill(hcmDate(180));
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();

  const vndCard = page.locator('article').filter({ hasText: 'Mua laptop E2E' });
  await expect(vndCard).toBeVisible();
  await expect(vndCard.getByText('Đang thực hiện')).toBeVisible();
  await expect(vndCard.getByText(/Laptop cho công việc/)).toBeVisible();
  await expect(vndCard).toContainText(/còn thiếu 30\.000\.000/);
  await expect(vndCard).toContainText(/Cần tiết kiệm/);

  // The reference panel reads real insights and is explicitly non-committal.
  const panel = page.getByLabel('Số liệu tham khảo');
  await expect(panel.getByText(/10\.000\.000/)).toBeVisible();
  await expect(panel.getByText(/4\.000\.000/)).toBeVisible();
  await expect(panel.getByText('60.0%')).toBeVisible();
  await expect(panel.getByText(/không được cộng tự động vào số tiền đã tiết kiệm/)).toBeVisible();

  await vndCard.getByRole('button', { name: 'Góp thêm' }).click();
  await page.getByLabel('Số tiền', { exact: true }).fill('6000000');
  await page.getByRole('button', { name: 'Ghi nhận' }).click();

  await expect(vndCard).toContainText(/6\.000\.000/);
  await expect(vndCard).toContainText('20%');
  await expect(vndCard).toContainText(/còn thiếu 24\.000\.000/);

  // A second goal in USD: nothing is converted into the VND totals.
  await page.getByRole('button', { name: 'Thêm mục tiêu' }).first().click();
  await page.getByLabel('Tên mục tiêu', { exact: true }).fill('MacBook USD E2E');
  await page.getByLabel('Số tiền mục tiêu', { exact: true }).fill('1000');
  await page.getByLabel('Tiền tệ', { exact: true }).selectOption('USD');
  await page.getByLabel('Ngày đích (tuỳ chọn)').fill(hcmDate(120));
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();

  // The page switches to the new goal's currency, so it is visible right away.
  const usdCard = page.locator('article').filter({ hasText: 'MacBook USD E2E' });
  await expect(usdCard).toBeVisible();
  await expect(page.getByLabel('Lọc theo tiền tệ')).toHaveValue('USD');
  await expect(usdCard.getByRole('button', { name: 'Góp thêm' })).toBeVisible();

  await usdCard.getByRole('button', { name: 'Góp thêm' }).click();
  await page.getByLabel('Số tiền', { exact: true }).fill('250');
  await page.getByRole('button', { name: 'Ghi nhận' }).click();
  await expect(usdCard).toContainText(/250,00/);
  await expect(usdCard).toContainText('25%');

  // The VND figure never picked up the USD contribution.
  await page.getByLabel('Lọc theo tiền tệ').selectOption('VND');
  await expect(vndCard).toBeVisible();
  await expect(vndCard).toContainText(/6\.000\.000/);
  await expect(page.locator('article').filter({ hasText: 'MacBook USD E2E' })).toHaveCount(0);

  const summary = page.getByLabel('Tổng quan tiến độ');
  await expect(summary.getByText(/Số liệu chỉ tính cho mục tiêu bằng VND/)).toBeVisible();
  await page.getByLabel('Lọc theo tiền tệ').selectOption('USD');
  await expect(summary.getByText(/Số liệu chỉ tính cho mục tiêu bằng USD/)).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Mua laptop E2E' })).toHaveCount(0);

  // The reference panel follows the selected currency through the real API.
  const usdInsights = await page.request.get('/api/v1/insights/monthly?currency=USD&months=6');
  expect(usdInsights.ok()).toBeTruthy();
  const usdBody = (await usdInsights.json()) as InsightsMonthlyDto;
  expect(usdBody.currency).toBe('USD');
  expect(usdBody.months.every((month) => month.hasTransactions === false)).toBe(true);
  await expect(page.getByLabel('Số liệu tham khảo')).toContainText(
    'Chưa có giao dịch USD để tính số liệu tham khảo.',
  );
});

test('pauses, completes and archives a goal from the UI', async () => {
  await page.goto('/goals');
  await page.getByLabel('Lọc theo tiền tệ').selectOption('VND');
  await expect(page.getByRole('heading', { name: 'Mục tiêu tiết kiệm' })).toBeVisible();

  await page.getByRole('button', { name: 'Thêm mục tiêu' }).first().click();
  await page.getByLabel('Tên mục tiêu', { exact: true }).fill('Quỹ khẩn cấp E2E');
  await page.getByLabel('Số tiền mục tiêu', { exact: true }).fill('5000000');
  await page.getByLabel('Ngày đích (tuỳ chọn)').fill(hcmDate(120));
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();

  const card = page.locator('article').filter({ hasText: 'Quỹ khẩn cấp E2E' });
  await expect(card).toBeVisible();

  // Edit the name through the form.
  await card.getByRole('button', { name: 'Sửa Quỹ khẩn cấp E2E' }).click();
  await page.getByLabel('Tên mục tiêu', { exact: true }).fill('Quỹ khẩn cấp 6 tháng');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();

  const renamed = page.locator('article').filter({ hasText: 'Quỹ khẩn cấp 6 tháng' });
  await expect(renamed).toBeVisible();

  await renamed.getByRole('button', { name: 'Chi tiết' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Còn thiếu')).toBeVisible();
  await expect(dialog.getByText('Cần tiết kiệm/tháng')).toBeVisible();
  await expect(dialog.getByText('Chưa ghi nhận khoản góp nào.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Tạm dừng' }).click();
  await expect(renamed.getByText('Tạm dừng', { exact: true })).toBeVisible();
  await expect(renamed.getByText(/Đang tạm dừng nên không yêu cầu/)).toBeVisible();
  await expect(renamed.getByRole('button', { name: 'Góp thêm' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(renamed.getByText('Đang thực hiện', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await expect(renamed.getByText('Hoàn thành', { exact: true })).toBeVisible();
  await expect(renamed.getByText(/đã hoàn thành/)).toBeVisible();
  await expect(renamed.getByRole('button', { name: 'Góp thêm' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Đóng' }).click();

  page.once('dialog', (confirmation) => void confirmation.accept());
  await renamed.getByRole('button', { name: 'Lưu trữ Quỹ khẩn cấp 6 tháng' }).click();
  await expect(renamed).toHaveCount(0);

  // Archived goals stay readable when explicitly requested.
  await page.getByLabel('Hiện mục tiêu đã lưu trữ').check();
  const archived = page.locator('article').filter({ hasText: 'Quỹ khẩn cấp 6 tháng' });
  await expect(archived).toBeVisible();
  await expect(archived.getByText('Đã lưu trữ', { exact: true })).toBeVisible();
});
