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
 * Stage 3 layout checks at the six reference viewports. Each page must avoid
 * horizontal page scroll, keep its primary content visible, and render chart
 * containers with real dimensions. The 360px pass also exercises the tab bar
 * with mouse and keyboard plus URL sync and history.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = 'E2ePassword123!';
const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

function hcmParts(): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const [year, month] = formatted.split('-').map(Number);
  return { year, month };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const ordinal = year * 12 + (month - 1) + delta;
  return { year: Math.floor(ordinal / 12), month: (ordinal % 12) + 1 };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function pastMonthInstant(delta: number, day: number): string {
  const { year, month } = hcmParts();
  const target = shiftMonth(year, month, delta);
  return new Date(Date.UTC(target.year, target.month - 1, day, 5, 0, 0)).toISOString();
}

function currentMonthInstant(minutesAgo: number): string {
  const now = Date.now();
  const { year, month } = hcmParts();
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
        email: `responsive.${RUN}@example.com`,
        password: PASSWORD,
        displayName: 'Layout E2E',
      },
    }),
    'Register',
  );

  const categories = await api.get('/api/v1/categories');
  await expectOk(categories, 'Categories');
  const items = (
    (await categories.json()) as {
      items: Array<{ id: string; slug: string | null; type: string }>;
    }
  ).items;
  const income = items.find((item) => item.type === 'INCOME');
  const expense = items.find((item) => item.slug === 'food' && item.type === 'EXPENSE');
  if (!income || !expense) throw new Error('Seeded categories are required for this spec');

  const account = await api.post('/api/v1/accounts', {
    data: { name: 'Ví bố cục', type: 'CASH', initialBalance: '0', currency: 'VND' },
  });
  await expectOk(account, 'Account');
  const accountId = ((await account.json()) as { account: { id: string } }).account.id;

  const add = async (data: Record<string, unknown>, label: string) => {
    await expectOk(await api.post('/api/v1/transactions', { data }), label);
  };
  for (const delta of [-3, -2, -1]) {
    await add(
      {
        accountId,
        categoryId: income.id,
        type: 'INCOME',
        amount: '10000000',
        occurredAt: pastMonthInstant(delta, 5),
        description: 'Thu nhập quá khứ bố cục',
      },
      'Past income',
    );
    await add(
      {
        accountId,
        categoryId: expense.id,
        type: 'EXPENSE',
        amount: '4000000',
        occurredAt: pastMonthInstant(delta, 20),
        description: 'Chi tiêu quá khứ bố cục',
      },
      'Past expense',
    );
  }
  await add(
    {
      accountId,
      categoryId: income.id,
      type: 'INCOME',
      amount: '9000000',
      occurredAt: currentMonthInstant(6),
      description: 'Thu nhập tháng này bố cục',
    },
    'Current income',
  );
  await add(
    {
      accountId,
      categoryId: expense.id,
      type: 'EXPENSE',
      amount: '2500000',
      occurredAt: currentMonthInstant(5),
      description: 'Chi tiêu tháng này bố cục',
    },
    'Current expense',
  );

  const { year, month } = hcmParts();
  await expectOk(
    await api.post('/api/v1/budgets', {
      data: {
        name: 'Ngân sách ăn uống bố cục',
        categoryId: expense.id,
        month: monthKey(year, month),
        limitAmount: '3000000',
      },
    }),
    'Budget',
  );

  // The savings assistant only renders when the currency has a goal.
  await expectOk(
    await api.post('/api/v1/goals', {
      data: { name: 'Mục tiêu bố cục', targetAmount: '10000000', currency: 'VND' },
    }),
    'Goal',
  );

  browserContext = await browser.newContext({
    storageState: await api.storageState(),
    baseURL: E2E_WEB_ORIGIN,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: VIEWPORTS[0]!,
  });
  page = await browserContext.newPage();
});

test.afterAll(async () => {
  await browserContext?.close();
  await api?.dispose();
});

/** Resizing replays the sidebar/main padding transition; measure the settled frame. */
async function waitForLayoutToSettle() {
  await page.evaluate(async () => {
    const transitions = document
      .getAnimations()
      .filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
    await Promise.all(transitions.map((transition) => transition.finished.catch(() => undefined)));
  });
}

async function expectNoPageOverflow(target: Page = page) {
  const overflow = await target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

/** A box must render inside the viewport both horizontally and vertically. */
async function expectBoxInsideViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  viewport: { width: number; height: number },
  label: string,
) {
  expect(box, `${label} must render`).not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
}

/** Every rendered chart needs a visible box that fits inside the viewport. */
async function expectChartsUsable(viewportWidth: number) {
  const boxes = await page.locator('.recharts-responsive-container').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, right: rect.right };
    }),
  );
  for (const box of boxes) {
    expect(box.width, 'chart width').toBeGreaterThan(0);
    expect(box.height, 'chart height').toBeGreaterThan(0);
    expect(box.right, 'chart right edge').toBeLessThanOrEqual(viewportWidth + 1);
  }
  return boxes.length;
}

async function visit(path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  await expectNoPageOverflow();
}

test('primary pages fit every reference viewport', async () => {
  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);

      await visit('/dashboard', 'Tổng quan');
      await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
      const dashboardCharts = await expectChartsUsable(viewport.width);
      expect(dashboardCharts).toBeGreaterThan(0);

      await visit('/transactions', 'Giao dịch');
      await expect(page.getByText('Chi tiêu tháng này bố cục').first()).toBeVisible();

      await visit('/budgets', 'Ngân sách');
      await expect(page.getByText('Ngân sách ăn uống bố cục').first()).toBeVisible();

      await visit('/insights', 'Phân tích tài chính');
      await expect(page.getByText('Diễn biến 6 tháng gần nhất')).toBeVisible();
      expect(await expectChartsUsable(viewport.width)).toBeGreaterThan(0);

      await visit('/analytics', 'Xu hướng thu nhập & chi tiêu');
      await expect(page.getByRole('tab', { name: 'Tổng quan' })).toBeVisible();

      await page.getByRole('tab', { name: 'Xu hướng' }).click();
      await expect(page).toHaveURL(/\?tab=trends$/);
      await expect(page.getByRole('heading', { name: 'Dòng tiền ròng theo tháng' })).toBeVisible();
      await expectNoPageOverflow();
      expect(await expectChartsUsable(viewport.width)).toBeGreaterThan(0);

      await page.getByRole('tab', { name: 'Danh mục' }).click();
      await expect(page).toHaveURL(/\?tab=categories$/);
      await expect(page.getByText('Cơ cấu nguồn thu theo danh mục').first()).toBeVisible();
      await expectNoPageOverflow();
      await expectChartsUsable(viewport.width);
    });
  }
});

test('tab bar works with mouse and keyboard at 360px and keeps history in sync', async () => {
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto('/analytics');

  await page.getByRole('tab', { name: 'Danh mục' }).click();
  await expect(page).toHaveURL(/\?tab=categories$/);
  await expect(page.getByRole('tab', { name: 'Danh mục' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: 'Danh mục' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Xu hướng' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Xu hướng' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/\?tab=trends$/);

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Phân tích AI' })).toBeFocused();
  await expect(page).toHaveURL(/\?tab=ai$/);

  await page.goBack();
  await expect(page).toHaveURL(/\?tab=trends$/);
  await expect(page.getByRole('tab', { name: 'Xu hướng' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.goForward();
  await expect(page).toHaveURL(/\?tab=ai$/);
  await expect(page.getByRole('tab', { name: 'Phân tích AI' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('empty states keep their structure at 360px', async () => {
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto('/budgets');
  await expect(page.getByLabel('Tháng', { exact: true })).toBeVisible();
  await page.getByLabel('Tháng', { exact: true }).fill('2031-01');
  await expect(page.getByText('Chưa có ngân sách cho tháng này')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Thêm ngân sách', exact: true }).first(),
  ).toBeVisible();
  await expectNoPageOverflow();

  await page.goto('/insights');
  await expect(page.getByLabel('Tháng', { exact: true })).toBeVisible();
  await page.getByLabel('Tháng', { exact: true }).fill('2031-01');
  await expect(page.getByText(/Chưa có giao dịch trong tháng 01\/2031/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Chi tiêu theo danh mục', exact: true }),
  ).toBeVisible();
  await expectNoPageOverflow();
});

test('Stage 4 AI savings regions and alert filters fit every viewport', async () => {
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Mục tiêu tiết kiệm' })).toBeVisible();

  const aiPanel = page.getByLabel('Trợ lý tiết kiệm AI');
  await expect(aiPanel.getByTestId('ai-explanation')).toBeVisible();
  await expect(aiPanel.getByTestId('ai-scenario')).toBeVisible();
  await expect(aiPanel.getByText('Số liệu hệ thống')).toBeVisible();

  // Chat now lives in the floating widget shared by every page. It must fit any
  // viewport without widening the page.
  await page.getByTestId('ai-chat-launcher').click();
  const chatWidget = page.getByTestId('ai-chat-widget');
  await expect(chatWidget).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForLayoutToSettle();
    await expectNoPageOverflow();
    for (const testId of ['ai-explanation', 'ai-scenario']) {
      const box = await aiPanel.getByTestId(testId).boundingBox();
      expect(box, `${testId} box at ${viewport.width}px`).not.toBeNull();
      expect(box!.x, `${testId} left at ${viewport.width}px`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${testId} right at ${viewport.width}px`).toBeLessThanOrEqual(
        viewport.width + 1,
      );
    }
    expectBoxInsideViewport(await chatWidget.boundingBox(), viewport, 'chat widget');
  }

  await chatWidget.getByRole('button', { name: 'Đóng trợ lý AI' }).click();
  await expect(chatWidget).toBeHidden();

  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Cảnh báo chi tiêu' })).toBeVisible();
  const filters = page.getByRole('region', { name: 'Bộ lọc cảnh báo' });
  await expect(filters).toBeVisible();

  // The collapsible filter can be operated from the keyboard.
  const toggle = filters.getByRole('button', { name: 'Thu gọn bộ lọc' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(filters.getByRole('button', { name: 'Mở bộ lọc' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.keyboard.press('Enter');
  await expect(filters.getByRole('button', { name: 'Thu gọn bộ lọc' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForLayoutToSettle();
    await expectNoPageOverflow();
    const box = await filters.boundingBox();
    expect(box, `filters box at ${viewport.width}px`).not.toBeNull();
    expect(box!.x + box!.width, `filters right at ${viewport.width}px`).toBeLessThanOrEqual(
      viewport.width + 1,
    );
  }
});

test('existing routes still render and the Categories tab bar still works', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ['/accounts', 'Tài khoản'],
    ['/categories', 'Danh mục'],
    ['/goals', 'Mục tiêu tiết kiệm'],
    ['/alerts', 'Cảnh báo chi tiêu'],
    ['/imports', 'Nhập / xuất CSV'],
    ['/settings', 'Cài đặt'],
  ] as const) {
    await visit(path, heading);
  }

  await page.goto('/categories');
  await expect(page.getByRole('tab', { name: 'Chi tiêu' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Thu nhập' }).click();
  await expect(page.getByRole('tab', { name: 'Thu nhập' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await expectNoPageOverflow();
});

/**
 * Stage 5: the public authentication screens fit every reference viewport and
 * the password visibility control works with both mouse and keyboard. The pages
 * are loaded once per route and then resized, which keeps the API request count
 * under the E2E rate limit while still measuring every width.
 */
test('Stage 5 auth pages fit every viewport and expose an operable password toggle', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: E2E_WEB_ORIGIN,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: VIEWPORTS[0]!,
    // Public screens: start without the shared suite session.
    storageState: { cookies: [], origins: [] },
  });
  const authPage = await context.newPage();
  try {
    for (const [path, heading] of [
      ['/login', 'Đăng nhập'],
      ['/register', 'Tạo tài khoản'],
    ] as const) {
      await authPage.goto(path);
      await expect(authPage.getByRole('heading', { name: heading, exact: true })).toBeVisible();

      const password = authPage.locator('input[name="password"]').first();
      await expect(password).toBeVisible();
      await expect(password).toHaveAttribute('type', 'password');

      // Mouse: show, typing is not cleared, then hide again.
      const toggle = authPage.getByRole('button', { name: 'Hiện mật khẩu' }).first();
      await toggle.click();
      await expect(password).toHaveAttribute('type', 'text');
      const hideToggle = authPage.getByRole('button', { name: 'Ẩn mật khẩu' }).first();
      await expect(hideToggle).toHaveAttribute('aria-pressed', 'true');
      await password.fill('E2ePassword123!');
      await expect(password).toHaveValue('E2ePassword123!');
      await hideToggle.click();
      await expect(password).toHaveAttribute('type', 'password');

      // Keyboard: the toggle is reachable with Tab and operable with Space/Enter.
      const showToggle = authPage.getByRole('button', { name: 'Hiện mật khẩu' }).first();
      await showToggle.focus();
      await authPage.keyboard.press('Enter');
      await expect(password).toHaveAttribute('type', 'text');
      await authPage.keyboard.press('Space');
      await expect(password).toHaveAttribute('type', 'password');
      await password.fill('');

      for (const viewport of VIEWPORTS) {
        await authPage.setViewportSize(viewport);
        await authPage.evaluate(async () => {
          const transitions = document
            .getAnimations()
            .filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
          await Promise.all(
            transitions.map((transition) => transition.finished.catch(() => undefined)),
          );
        });
        await expectNoPageOverflow(authPage);
        const card = authPage.locator('form').first();
        await expectBoxInsideViewport(
          await card.boundingBox(),
          viewport,
          `${heading} form at ${viewport.width}px`,
        );
      }
    }

    // Invalid submits surface an accessible error instead of failing silently.
    await authPage.goto('/login');
    await authPage.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    const email = authPage.getByLabel('Email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(authPage.getByText('Email không hợp lệ')).toBeVisible();
    await expect(authPage.locator('#email-error')).toHaveAttribute('role', 'alert');
    await expect(authPage.locator('#password-error')).toHaveAttribute('role', 'alert');
  } finally {
    await context.close();
  }
});

test('Stage 5 settings and its delete dialog fit every viewport and restore focus', async () => {
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();

  const profile = page.getByRole('region', { name: 'Hồ sơ' });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForLayoutToSettle();
    await expectNoPageOverflow();
    await expectBoxInsideViewport(
      await profile.getByLabel('Tên hiển thị').boundingBox(),
      viewport,
      `settings form at ${viewport.width}px`,
    );
  }

  // The data-destroying dialog opens inside a 360px viewport and starts on the
  // confirmation field, so a screen-reader user is not left behind the overlay.
  await page.setViewportSize(VIEWPORTS[0]!);
  const deleteButton = page.getByRole('button', { name: 'Xoá tài khoản', exact: true });
  await deleteButton.click();
  const dialog = page.getByRole('dialog', { name: 'Xác nhận xoá tài khoản' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#deletePassword')).toBeFocused();
  await expectBoxInsideViewport(
    await dialog.boundingBox(),
    VIEWPORTS[0]!,
    'delete dialog at 360px',
  );

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
});

test('Stage 5 transaction form fits every viewport', async () => {
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto('/transactions/new');
  await expect(page.getByRole('heading', { name: 'Thêm giao dịch' })).toBeVisible();

  const form = page.locator('form').first();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForLayoutToSettle();
    await expectNoPageOverflow();
    await expectBoxInsideViewport(
      await form.boundingBox(),
      viewport,
      `transaction form at ${viewport.width}px`,
    );
  }

  // The primary action stays reachable at the smallest width.
  await page.setViewportSize(VIEWPORTS[0]!);
  await expect(page.getByRole('button', { name: 'Thêm giao dịch', exact: true })).toBeVisible();
});

test('Stage 5 mobile drawer traps focus, locks scroll and restores focus on close', async () => {
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Tổng quan' }).first()).toBeVisible();

  const menuButton = page.getByRole('button', { name: 'Mở menu' });
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: 'Điều hướng' });
  await expect(drawer).toBeVisible();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  const focusInsideDrawer = () =>
    page.evaluate(() => {
      const drawerNode = document.querySelector('[role="dialog"][aria-label="Điều hướng"]');
      return drawerNode?.contains(document.activeElement) ?? false;
    });
  await expect.poll(focusInsideDrawer).toBe(true);

  // Tab and Shift+Tab stay inside the drawer.
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInsideDrawer(), `Tab ${i + 1} kept focus in the drawer`).toBe(true);
  }
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInsideDrawer(), `Shift+Tab ${i + 1} kept focus in the drawer`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});
