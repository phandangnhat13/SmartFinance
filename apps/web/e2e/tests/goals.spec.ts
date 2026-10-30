import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { SavingsRecommendationsDto } from '@smart-finance/shared-types';
import { E2E_API_ORIGIN, E2E_WEB_ORIGIN } from '../env.mjs';

/**
 * Browser E2E for Savings Goals.
 *
 * The spec registers its own throwaway user so its goals never mix with the
 * shared global-setup user. Goals, contributions and status changes all go
 * through the real UI and the real API; only the seed transactions behind the
 * savings recommendations are created directly through `POST /transactions`.
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

/**
 * Local noon (Asia/Ho_Chi_Minh) on a day of a past month, as a UTC instant.
 * 05:00Z is 12:00 in HCM, so the calendar month always matches.
 */
function hcmNoonInMonth(monthOffset: number, day: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day, 5, 0, 0),
  ).toISOString();
}

/** dd/mm/yyyy in Asia/Ho_Chi_Minh, offset by whole days (matches the UI). */
function hcmDisplay(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
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

  // Three completed months of real transactions so the savings advice has
  // figures to work with. The in-progress month is intentionally left empty.
  for (const monthOffset of [-1, -2, -3]) {
    await expectOk(
      await api.post('/api/v1/transactions', {
        data: {
          accountId,
          categoryId: income.id,
          type: 'INCOME',
          amount: '10000000',
          occurredAt: hcmNoonInMonth(monthOffset, 5),
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
          occurredAt: hcmNoonInMonth(monthOffset, 20),
          description: 'Chi tiêu E2E goals',
        },
      }),
      'Expense',
    );
  }

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

  // The recommendations panel reads real insights and is explicitly non-committal.
  const panel = page.getByLabel('Đề xuất tiết kiệm');
  await expect(panel.getByText(/4\.800\.000/).first()).toBeVisible();
  await expect(panel.getByText(/10\.000\.000/).first()).toBeVisible();
  await expect(panel.getByText(/4\.000\.000/).first()).toBeVisible();
  await expect(panel.getByText('Mua laptop E2E')).toBeVisible();
  await expect(panel.getByText(/không tự tạo khoản góp hay sửa mục tiêu/)).toBeVisible();

  // A simulation only previews another allocation; nothing is written.
  await panel.getByLabel('Mức tiết kiệm giả định mỗi tháng').fill('3000000');
  await panel.getByRole('button', { name: 'Mô phỏng' }).click();
  await expect(panel.getByText(/Đang mô phỏng với/)).toBeVisible();
  await expect(vndCard).toContainText(/còn thiếu 30\.000\.000/);
  await panel.getByRole('button', { name: 'Bỏ mô phỏng' }).click();
  await expect(panel.getByText(/Đang mô phỏng với/)).toBeHidden();

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

  // The recommendations follow the selected currency through the real API.
  const usdRecommendations = await page.request.get(
    '/api/v1/insights/savings-recommendations?currency=USD',
  );
  expect(usdRecommendations.ok()).toBeTruthy();
  const usdBody = (await usdRecommendations.json()) as SavingsRecommendationsDto;
  expect(usdBody.currency).toBe('USD');
  expect(usdBody.status).toBe('insufficient_data');
  expect(usdBody.capacity.monthsAnalyzed).toBe(0);
  await expect(page.getByLabel('Đề xuất tiết kiệm')).toContainText(
    'Chưa có tháng nào đã kết thúc với giao dịch USD.',
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

  await renamed.getByRole('button', { name: 'Lưu trữ Quỹ khẩn cấp 6 tháng' }).click();
  const archiveConfirm = page.getByRole('dialog', { name: 'Lưu trữ mục tiêu' });
  await expect(archiveConfirm).toBeVisible();
  await archiveConfirm.getByRole('button', { name: 'Lưu trữ' }).click();
  await expect(renamed).toHaveCount(0);

  // Archived goals stay readable when explicitly requested.
  await page.getByLabel('Hiện mục tiêu đã lưu trữ').check();
  const archived = page.locator('article').filter({ hasText: 'Quỹ khẩn cấp 6 tháng' });
  await expect(archived).toBeVisible();
  await expect(archived.getByText('Đã lưu trữ', { exact: true })).toBeVisible();
});

test('tracks progress, simulates a plan and applies a confirmed adjustment', async () => {
  await page.goto('/goals');
  await page.getByLabel('Lọc theo tiền tệ').selectOption('VND');
  await expect(page.getByRole('heading', { name: 'Mục tiêu tiết kiệm' })).toBeVisible();

  // 1–2. A goal with a deadline, then real contributions through the UI.
  await page.getByRole('button', { name: 'Thêm mục tiêu' }).first().click();
  await page.getByLabel('Tên mục tiêu', { exact: true }).fill('Du lịch E2E');
  await page.getByLabel('Số tiền mục tiêu', { exact: true }).fill('24000000');
  await page.getByLabel('Ngày đích (tuỳ chọn)').fill(hcmDate(120));
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();

  const card = page.locator('article').filter({ hasText: 'Du lịch E2E' });
  await expect(card).toBeVisible();
  for (const amount of ['2000000', '3000000']) {
    await card.getByRole('button', { name: 'Góp thêm' }).click();
    await page.getByLabel('Số tiền', { exact: true }).fill(amount);
    await page.getByRole('button', { name: 'Ghi nhận' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(card).toContainText(/5\.000\.000/);

  // 3–4. The dashboard totals come from GET /savings/progress.
  const summary = page.getByLabel('Tổng quan tiến độ');
  await expect(summary.getByText(/Số liệu chỉ tính cho mục tiêu bằng VND/)).toBeVisible();
  const progressResponse = await page.request.get('/api/v1/savings/progress?currency=VND');
  expect(progressResponse.ok()).toBeTruthy();
  const progress = (await progressResponse.json()) as {
    currency: string;
    summary: { totalTargetAmount: string; totalSavedAmount: string };
    goals: { goalId: string; name: string; savedAmount: string }[];
  };
  expect(progress.currency).toBe('VND');
  const progressGoal = progress.goals.find((goal) => goal.name === 'Du lịch E2E');
  if (!progressGoal) throw new Error('The new goal is missing from the progress payload');
  expect(Number(progressGoal.savedAmount)).toBe(5_000_000);

  // 5–6. Per-goal actual versus expected, plus the monthly history.
  await card.getByRole('button', { name: 'Chi tiết' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Thực tế so với kế hoạch')).toBeVisible();
  await expect(dialog.getByText('Kỳ vọng theo kế hoạch')).toBeVisible();
  await expect(dialog.getByText('Chênh lệch thực tế − kỳ vọng')).toBeVisible();
  await expect(dialog.getByText('Lịch sử góp')).toBeVisible();
  await expect(dialog.getByText('Tốc độ góp thực tế')).toBeVisible();

  const simulator = dialog.getByLabel('Mô phỏng kế hoạch');
  await expect(simulator.getByText(/không có khoản góp nào được tạo/)).toBeVisible();

  const goalsBefore = await page.request.get('/api/v1/goals?includeArchived=false');
  const goalId = (
    (await goalsBefore.json()) as { items: { id: string; name: string }[] }
  ).items.find((goal) => goal.name === 'Du lịch E2E')?.id;
  if (!goalId) throw new Error('Goal id not found');
  const before = (await (await page.request.get(`/api/v1/goals/${goalId}`)).json()) as {
    goal: { targetAmount: string; targetDate: string; contributions: unknown[] };
  };

  // 7. A read-only monthly simulation; no write, no contribution.
  await simulator.getByLabel('Số tiền góp mỗi tháng').fill('5000000');
  await simulator.getByRole('button', { name: 'Mô phỏng' }).click();
  await expect(simulator.getByText('Hiện tại so với giả định')).toBeVisible();
  expect(
    (await (await page.request.get(`/api/v1/goals/${goalId}`)).json()) as {
      goal: { targetAmount: string; targetDate: string };
    },
  ).toMatchObject({ goal: { targetAmount: before.goal.targetAmount } });

  // 8–9. Simulate a new deadline, preview it and confirm it explicitly.
  await simulator.getByRole('tab', { name: 'Ngày đích' }).click();
  await simulator.getByLabel('Ngày đích mới').fill(hcmDate(240));
  await simulator.getByRole('button', { name: 'Mô phỏng' }).click();
  await expect(simulator.getByText('Hiện tại so với giả định')).toBeVisible();
  await simulator.getByRole('button', { name: 'Xem trước thay đổi' }).click();

  const confirm = page.getByRole('dialog', { name: 'Xác nhận điều chỉnh mục tiêu' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(new RegExp(hcmDisplay(120)))).toBeVisible();
  await expect(confirm.getByText(new RegExp(hcmDisplay(240)))).toBeVisible();
  await expect(confirm.getByText(/Các khoản góp đã ghi nhận không thay đổi/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Xác nhận áp dụng' }).click();

  await expect(
    dialog.getByText('Đã cập nhật mục tiêu. Các khoản góp đã ghi nhận được giữ nguyên.'),
  ).toBeVisible();

  // 10. Only the deadline changed; the contributions were preserved.
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`/api/v1/goals/${goalId}`)).json()) as {
        goal: { targetDate: string; targetAmount: string; contributions: unknown[] };
      };
      return {
        targetDate: body.goal.targetDate,
        targetAmount: body.goal.targetAmount,
        contributions: body.goal.contributions.length,
      };
    })
    .toEqual({
      targetDate: hcmDate(240),
      targetAmount: before.goal.targetAmount,
      contributions: before.goal.contributions.length,
    });

  await expect(card).toContainText(new RegExp(`Hạn ${hcmDisplay(240)}`));
});
