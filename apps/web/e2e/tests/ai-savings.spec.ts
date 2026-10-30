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
 * Browser E2E for the AI savings assistant (M2e §12).
 *
 * The API is pointed at the local AI stub, which also implements the
 * Anthropic-shaped `/v1/messages` endpoint, so this spec exercises the real
 * provider adapter and the assistant UI without a key or network egress.
 * Every figure on screen is still computed by the backend: the stub only writes
 * prose with no digits, which is exactly what the strict validator allows.
 *
 * The nine steps mirror the spec: open goals → read the explanation → ask why a
 * goal is at risk → get an answer built from real data → ask about an
 * alternative monthly amount → see the deterministic simulation → read the
 * explanation → open the adjustment confirmation → prove nothing was written
 * before the user confirms.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = 'E2ePassword123!';
const GOAL_NAME = 'Du lịch AI E2E';

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

/** Local noon (Asia/Ho_Chi_Minh) on a day of a past month, as a UTC instant. */
function hcmNoonInMonth(monthOffset: number, day: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day, 5, 0, 0),
  ).toISOString();
}

async function expectOk(response: APIResponse, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
}

let api: APIRequestContext;
let browserContext: BrowserContext;
let page: Page;
let goalId = '';

/** The fields the assistant must never touch without an explicit confirmation. */
async function goalSnapshot() {
  const response = await page.request.get(`/api/v1/goals/${goalId}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    goal: {
      targetAmount: string;
      targetDate: string | null;
      monthlySaving: string | null;
      contributions: unknown[];
    };
  };
  return {
    targetAmount: body.goal.targetAmount,
    targetDate: body.goal.targetDate,
    monthlySaving: body.goal.monthlySaving,
    contributions: body.goal.contributions.length,
  };
}

test.beforeAll(async ({ browser }) => {
  api = await newRequest.newContext({ baseURL: E2E_API_ORIGIN });

  const email = `ai.savings.e2e.${RUN}@example.com`;
  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: { email, password: PASSWORD, displayName: 'AI Savings E2E' },
    }),
    'Register',
  );

  const account = await api.post('/api/v1/accounts', {
    data: { name: 'Ví AI', type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(account, 'Account');
  const accountId = ((await account.json()) as { account: { id: string } }).account.id;

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = ((await categories.json()) as { items: CategoryItem[] }).items;
  const income = items.find((item) => item.type === 'INCOME');
  const expense = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!income || !expense) throw new Error('Seeded categories are required for this spec');

  // Three completed months of real money: 10M in, 4M out → a 4.8M monthly
  // budget (net 6M with the fixed 20% safety buffer).
  for (const monthOffset of [-1, -2, -3]) {
    await expectOk(
      await api.post('/api/v1/transactions', {
        data: {
          accountId,
          categoryId: income.id,
          type: 'INCOME',
          amount: '10000000',
          occurredAt: hcmNoonInMonth(monthOffset, 5),
          description: 'Thu nhập AI E2E',
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
          description: 'Chi tiêu AI E2E',
        },
      }),
      'Expense',
    );
  }

  // Backdated start date and a close deadline make the goal genuinely late, so
  // the "why is it behind?" question has real data to answer from.
  const created = await api.post('/api/v1/goals', {
    data: {
      name: GOAL_NAME,
      targetAmount: '24000000',
      startDate: hcmDate(-120),
      targetDate: hcmDate(60),
    },
  });
  await expectOk(created, 'Goal');
  goalId = ((await created.json()) as { goal: { id: string } }).goal.id;

  await expectOk(
    await api.post(`/api/v1/goals/${goalId}/contributions`, {
      data: { amount: '2000000', contributedAt: hcmDate(-2) },
    }),
    'Contribution',
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

test('explains, simulates and only changes data after an explicit confirmation', async () => {
  // 1. Open the goals page, where the assistant lives.
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Mục tiêu tiết kiệm' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: GOAL_NAME })).toBeVisible();
  const initial = await goalSnapshot();

  // 2. The explanation separates calculated facts from AI-written prose.
  const panel = page.getByLabel('Trợ lý tiết kiệm AI');
  await expect(panel.getByText('Vì sao có kế hoạch này')).toBeVisible();
  await expect(panel.getByText('AI viết').first()).toBeVisible();
  await expect(
    panel.getByText(/Nội dung do AI \(anthropic · claude-opus-5-5\) viết/),
  ).toBeVisible();
  await expect(
    panel.getByText('Kế hoạch tháng này dựa trên dòng tiền đã ghi nhận của bạn.'),
  ).toBeVisible();

  // The numbers come from M2c capacity, never from the model.
  await expect(panel.getByText('4.800.000 ₫').first()).toBeVisible();
  await expect(panel.getByText('10.000.000 ₫').first()).toBeVisible();
  await expect(panel.getByText('4.000.000 ₫').first()).toBeVisible();
  await expect(panel.getByText(GOAL_NAME)).toBeVisible();
  await expect(panel.getByText('Chậm tiến độ').first()).toBeVisible();

  // 3. Ask why the goal is behind. The model is called, but it can only explain
  //    the context the backend built.
  const chat = panel.getByTestId('ai-chat');
  await chat
    .getByLabel('Câu hỏi cho trợ lý')
    .fill(`Tại sao mục tiêu ${GOAL_NAME} lại chậm tiến độ?`);
  await chat.getByRole('button', { name: 'Gửi' }).click();

  // 4. The answer carries backend evidence: the real status and reason.
  const log = panel.getByTestId('ai-chat-log');
  await expect(log.getByText(/Mình chỉ giải thích và mô phỏng/)).toBeVisible();
  await expect(log.getByText(new RegExp(`Tiến độ ${GOAL_NAME}: AT_RISK`))).toBeVisible();
  await expect(log.getByText('AI viết')).toBeVisible();

  // 5. Ask about an alternative monthly amount.
  const scenario = panel.getByTestId('ai-scenario');
  await scenario
    .getByLabel('Kịch bản muốn mô phỏng')
    .fill(`Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu ${GOAL_NAME} thì sao?`);
  await scenario.getByRole('button', { name: 'Mô phỏng', exact: true }).click();

  // 6. The result is the deterministic M2d simulation, labelled hypothetical.
  const result = scenario.getByTestId('ai-scenario-result');
  await expect(result.getByText(`Mức góp mỗi tháng · ${GOAL_NAME}`)).toBeVisible();
  await expect(result.getByText('Giả định – chưa áp dụng')).toBeVisible();
  await expect(
    result.getByRole('table', { name: 'So sánh kế hoạch hiện tại và kế hoạch giả định' }),
  ).toBeVisible();
  await expect(result.getByText('Cần góp mỗi tháng')).toBeVisible();
  await expect(result.getByText('3.000.000 ₫').first()).toBeVisible();

  // 7. The explanation is AI prose about a simulation the backend calculated.
  await expect(result.getByText('AI viết')).toBeVisible();
  await expect(result.getByText(/Mình chỉ giải thích và mô phỏng/)).toBeVisible();
  await expect(result.getByText(/^Đây là mô phỏng, chưa có thay đổi nào được lưu/)).toBeVisible();

  // Nothing has been written so far.
  expect(await goalSnapshot()).toEqual(initial);

  // 8. Reviewing the adjustment goes through the existing M2d confirmation.
  await result.getByRole('button', { name: 'Xem và xác nhận điều chỉnh' }).click();
  const detail = page.getByRole('dialog', { name: GOAL_NAME });
  await expect(detail).toBeVisible();

  const before = initial;
  const simulator = detail.getByLabel('Mô phỏng kế hoạch');
  // A monthly amount is only a what-if; the writable fields are the deadline and
  // the target, so the review path uses a new deadline.
  await simulator.getByRole('tab', { name: 'Ngày đích' }).click();
  await simulator.getByLabel('Ngày đích mới').fill(hcmDate(240));
  await simulator.getByRole('button', { name: 'Mô phỏng', exact: true }).click();
  await expect(simulator.getByText('Hiện tại so với giả định')).toBeVisible();
  await simulator.getByRole('button', { name: 'Xem trước thay đổi' }).click();

  const confirm = page.getByRole('dialog', { name: 'Xác nhận điều chỉnh mục tiêu' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/Các khoản góp đã ghi nhận không thay đổi/)).toBeVisible();

  // 9. Still nothing is written while the confirmation is open, and cancelling
  //    leaves the goal exactly as it was.
  expect(await goalSnapshot()).toEqual(before);
  await confirm.getByRole('button', { name: 'Huỷ' }).click();
  await expect(confirm).toBeHidden();
  expect(await goalSnapshot()).toEqual(before);
});
