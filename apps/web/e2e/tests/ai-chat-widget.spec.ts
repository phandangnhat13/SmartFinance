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
 * Browser E2E for the floating AI chat widget and persisted conversation
 * history.
 *
 * The API talks to the local AI stub, so this exercises the real conversation
 * endpoints, ownership scoping and the widget UI without network egress. Every
 * turn is stored server-side; reloading the page must reopen the same
 * conversation from `/ai/conversations`.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = 'E2ePassword123!';
const FIRST_QUESTION = 'Ngân sách nào đang vượt hạn mức trong tháng này?';
const FOLLOW_UP = 'Chi tiêu tháng này thế nào?';
const RENAMED_TITLE = 'Cuộc trò chuyện đã đổi tên';

interface CategoryItem {
  id: string;
  slug: string | null;
  type: string;
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

test.beforeAll(async ({ browser }) => {
  api = await newRequest.newContext({ baseURL: E2E_API_ORIGIN });

  await expectOk(
    await api.post('/api/v1/auth/register', {
      data: {
        email: `ai.widget.e2e.${RUN}@example.com`,
        password: PASSWORD,
        displayName: 'AI Widget E2E',
      },
    }),
    'Register',
  );

  const account = await api.post('/api/v1/accounts', {
    data: { name: 'Ví chat AI', type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(account, 'Account');
  const accountId = ((await account.json()) as { account: { id: string } }).account.id;

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = ((await categories.json()) as { items: CategoryItem[] }).items;
  const income = items.find((item) => item.type === 'INCOME');
  const expense = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!income || !expense) throw new Error('Seeded categories are required for this spec');

  // Three completed months give the analyst real figures to explain.
  for (const monthOffset of [-3, -2, -1]) {
    await expectOk(
      await api.post('/api/v1/transactions', {
        data: {
          accountId,
          categoryId: income.id,
          type: 'INCOME',
          amount: '10000000',
          occurredAt: hcmNoonInMonth(monthOffset, 5),
          description: 'Thu nhập chat AI E2E',
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
          description: 'Chi tiêu chat AI E2E',
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

test('persists a conversation, reopens it, renames it and deletes it', async () => {
  await page.goto('/dashboard');

  const launcher = page.getByTestId('ai-chat-launcher');
  await expect(launcher).toBeVisible();
  await launcher.click();

  const widget = page.getByTestId('ai-chat-widget');
  await expect(widget).toBeVisible();
  await expect(widget.getByTestId('ai-chat-input')).toBeVisible();

  // Send the first question. With no open conversation the widget creates one.
  await widget.getByTestId('ai-chat-input').fill(FIRST_QUESTION);
  await widget.getByTestId('ai-chat-send').click();

  const log = widget.getByTestId('ai-chat-log');
  await expect(log.getByText(FIRST_QUESTION)).toBeVisible();
  await expect(log.getByTestId('ai-chat-reply')).toHaveCount(1);
  await expect(log.getByText(/Mình chỉ giải thích số liệu hệ thống đã tính/)).toBeVisible();

  // Reload: the conversation is on the server and its title is the first
  // question, so it appears in the history view.
  await page.reload();
  await launcher.click();
  await widget.getByRole('button', { name: 'Lịch sử trò chuyện' }).click();
  const list = widget.getByTestId('ai-conversation-list');
  await expect(list.getByText(FIRST_QUESTION)).toBeVisible();
  await expect(list.getByText('Trợ lý phân tích')).toBeVisible();

  // Reopen it and continue: this must not create a second conversation.
  await list.getByText(FIRST_QUESTION).click();
  await expect(log.getByText(FIRST_QUESTION)).toBeVisible();
  await expect(log.getByText(/Mình chỉ giải thích số liệu hệ thống đã tính/)).toBeVisible();

  await widget.getByTestId('ai-chat-input').fill(FOLLOW_UP);
  await widget.getByTestId('ai-chat-send').click();
  await expect(log.getByText(FOLLOW_UP)).toBeVisible();
  await expect(log.getByTestId('ai-chat-reply')).toHaveCount(2);

  await widget.getByRole('button', { name: 'Lịch sử trò chuyện' }).click();
  await expect(list.locator('li')).toHaveCount(1);

  // Rename it and confirm the new title survives a reload.
  await widget.getByRole('button', { name: `Đổi tên ${FIRST_QUESTION}` }).click();
  await page.getByLabel('Tiêu đề mới').fill(RENAMED_TITLE);
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(list.getByText(RENAMED_TITLE)).toBeVisible();

  await page.reload();
  await launcher.click();
  await widget.getByRole('button', { name: 'Lịch sử trò chuyện' }).click();
  await expect(widget.getByTestId('ai-conversation-list').getByText(RENAMED_TITLE)).toBeVisible();

  // Search is server-side; a title that matches nothing says so.
  const search = widget.getByTestId('ai-conversation-search');
  await search.fill('không có cuộc trò chuyện này');
  await expect(widget.getByText('Không tìm thấy cuộc trò chuyện nào khớp tiêu đề.')).toBeVisible();
  await search.fill('đã đổi tên');
  await expect(widget.getByTestId('ai-conversation-list').getByText(RENAMED_TITLE)).toBeVisible();
  await search.fill('');
  await expect(widget.getByTestId('ai-conversation-list').getByText(RENAMED_TITLE)).toBeVisible();

  // Deleting asks first, then removes the conversation and its messages.
  await widget.getByRole('button', { name: `Xoá ${RENAMED_TITLE}` }).click();
  await expect(page.getByText(/cùng toàn bộ tin nhắn/)).toBeVisible();
  await page.getByRole('button', { name: 'Xoá', exact: true }).click();
  await expect(
    widget.getByText('Chưa có cuộc trò chuyện nào. Hãy bắt đầu một cuộc trò chuyện mới.'),
  ).toBeVisible();

  await page.reload();
  await launcher.click();
  await widget.getByRole('button', { name: 'Lịch sử trò chuyện' }).click();
  await expect(
    widget.getByText('Chưa có cuộc trò chuyện nào. Hãy bắt đầu một cuộc trò chuyện mới.'),
  ).toBeVisible();
});

test('opens from a page action with a visible context and does not send', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/analytics');

  await page.getByRole('button', { name: 'Hỏi AI về biểu đồ' }).click();

  const widget = page.getByTestId('ai-chat-widget');
  await expect(widget).toBeVisible();

  const indicator = widget.getByTestId('ai-chat-context');
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText('Diễn biến 6 tháng gần nhất');
  await expect(indicator).toContainText('Đơn vị VND');

  // The question is only a draft: nothing was sent and no conversation exists.
  await expect(widget.getByTestId('ai-chat-input')).toHaveValue(
    'Giải thích biểu đồ thu nhập và chi tiêu của tôi trong 6 tháng gần đây.',
  );
  await expect(widget.getByTestId('ai-chat-log')).toHaveCount(0);

  // The context can be removed without touching the draft.
  await widget.getByRole('button', { name: 'Bỏ ngữ cảnh' }).click();
  await expect(indicator).toBeHidden();
  await expect(widget.getByTestId('ai-chat-input')).not.toHaveValue('');
});

test('fits a phone viewport and keeps its message area scrollable', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');

  await page.getByTestId('ai-chat-launcher').click();
  const widget = page.getByTestId('ai-chat-widget');
  await expect(widget).toBeVisible();

  const box = await widget.boundingBox();
  if (!box) throw new Error('The chat widget has no bounding box');
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.height).toBeLessThanOrEqual(844);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);

  // The panel has its own scroll area and a fixed composer, so it never grows
  // the page or pushes the input off screen.
  const messages = await widget.getByTestId('ai-chat-messages').boundingBox();
  if (!messages) throw new Error('The message area has no bounding box');
  expect(messages.height).toBeGreaterThan(0);
  await expect(widget.getByTestId('ai-chat-input')).toBeInViewport();
  await expect(widget.getByTestId('ai-chat-send')).toBeInViewport();

  // Minimising keeps a small launcher on screen instead of a full panel.
  await widget.getByRole('button', { name: 'Thu nhỏ trò chuyện AI' }).click();
  await expect(widget).toBeHidden();
  await expect(page.getByRole('button', { name: 'Mở rộng trò chuyện AI' })).toBeInViewport();
  await page.getByRole('button', { name: 'Mở rộng trò chuyện AI' }).click();
  await expect(widget).toBeVisible();
});
