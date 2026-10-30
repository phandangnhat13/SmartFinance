import { readFileSync } from 'node:fs';
import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import type {
  AlertScanSummaryDto,
  PaginatedDto,
  SpendingAlertDto,
} from '@smart-finance/shared-types';
import { E2E_WEB_ORIGIN } from '../env.mjs';
import { AUTH_CONTEXT_PATH, AUTH_STATE_PATH, type E2EContext } from '../global-setup';

/**
 * End-to-end coverage for Spending Alerts.
 *
 * Every business flow uses the real API and the real UI: transactions are
 * created through `POST /transactions`, scans through the button on `/alerts`,
 * and statuses through `PATCH /alerts/:id/status`. Only the browser-isolation
 * test replaces a request (a deliberately delayed PATCH) so the UI's
 * "not before the API responds" behaviour can be observed.
 *
 * All data lives in the isolated `smart_finance_e2e` database and belongs to
 * the throwaway user created by global setup, so no cleanup or reset is
 * required (and none is performed).
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const E2E_PASSWORD = 'E2ePassword123!';
const ANONYMOUS_STATE = { cookies: [], origins: [] };

function loadAccount(): E2EContext {
  return JSON.parse(readFileSync(AUTH_CONTEXT_PATH, 'utf8')) as E2EContext;
}

async function ownerContext(): Promise<APIRequestContext> {
  return newRequest.newContext({
    baseURL: E2E_WEB_ORIGIN,
    storageState: AUTH_STATE_PATH,
  });
}

interface CategoryItem {
  id: string;
  slug: string | null;
  type: string;
}

async function categoryId(api: APIRequestContext, slug: string): Promise<string> {
  const response = await api.get('/api/v1/categories');
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items: CategoryItem[] };
  const category = body.items.find((item) => item.slug === slug && item.type === 'EXPENSE');
  if (!category) throw new Error(`Seeded category "${slug}" not found`);
  return category.id;
}

async function createExpense(
  api: APIRequestContext,
  accountId: string,
  categoryIdValue: string,
  amount: string,
  occurredAt: string,
  description: string,
): Promise<string> {
  const response = await api.post('/api/v1/transactions', {
    data: {
      accountId,
      categoryId: categoryIdValue,
      type: 'EXPENSE',
      amount,
      occurredAt,
      description,
    },
  });
  if (response.status() !== 201) {
    throw new Error(`Create transaction failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { transaction: { id: string } };
  return body.transaction.id;
}

/** `YYYY-MM` of "now" in the user's timezone, without importing a date library. */
function hcmYearMonth(): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const [year, month] = formatted.split('-').map(Number);
  return { year, month };
}

/** 12:00 on day 1 of a reference month, which is inside every matched window. */
function referenceMonthInstant(monthsBack: number): string {
  const { year, month } = hcmYearMonth();
  return new Date(Date.UTC(year, month - 1 - monthsBack, 1, 5, 0, 0)).toISOString();
}

/** Distinct instants inside the current month, spread as far back as possible. */
function currentMonthInstants(count: number): string[] {
  const now = Date.now();
  const { year, month } = hcmYearMonth();
  const monthStart = Date.UTC(year, month - 1, 1) - HCM_OFFSET_MS;
  const earliest = monthStart + 60_000;
  const latest = now - 60_000;
  if (latest - earliest < count * 1000) {
    throw new Error('Not enough elapsed time in the current month to build the fixture');
  }
  const step = Math.floor((latest - earliest) / count);
  return Array.from({ length: count }, (_, index) =>
    new Date(earliest + index * step).toISOString(),
  );
}

async function fetchAlerts(page: Page): Promise<SpendingAlertDto[]> {
  const response = await page.request.get('/api/v1/alerts?limit=100');
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as PaginatedDto<SpendingAlertDto>;
  return body.items;
}

async function findAlert(
  page: Page,
  predicate: (alert: SpendingAlertDto) => boolean,
): Promise<SpendingAlertDto> {
  const alerts = await fetchAlerts(page);
  const alert = alerts.find(predicate);
  if (!alert) throw new Error('Expected alert was not created by the scan');
  return alert;
}

async function alertCount(page: Page): Promise<number> {
  const response = await page.request.get('/api/v1/alerts?limit=1');
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as PaginatedDto<SpendingAlertDto>;
  return body.total;
}

/** Runs a scan through the real UI button and returns the API summary. */
async function scanFromUi(page: Page): Promise<AlertScanSummaryDto> {
  const button = page.getByRole('button', { name: 'Quét chi tiêu' });
  await expect(button).toBeEnabled();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/v1/alerts/scan'),
  );
  await button.click();
  const response = await responsePromise;
  expect(response.ok(), `scan responded ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { scan: AlertScanSummaryDto };
  await expect(page.getByRole('status')).toBeVisible();
  return body.scan;
}

function alertCard(page: Page, text: string) {
  return page.locator('li').filter({ hasText: text }).first();
}

async function openDetail(page: Page, cardText: string) {
  const card = alertCard(page, cardText);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Xem chi tiết/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openAlertsPage(page: Page) {
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Cảnh báo chi tiêu' })).toBeVisible();
}

test.describe('spending alerts end-to-end', () => {
  test('Flow A — a large transaction is scanned, listed and explained with API facts', async ({
    page,
  }) => {
    const account = loadAccount();
    const api = await ownerContext();
    let candidateId: string;
    try {
      const foodId = await categoryId(api, 'food');
      const now = Date.now();
      // Ten prior expenses, two days apart, so the robust baseline exists.
      for (let index = 0; index < 10; index += 1) {
        await createExpense(
          api,
          account.accountId,
          foodId,
          `${100000 + index * 1000}.00`,
          new Date(now - (60 - index) * DAY_MS).toISOString(),
          `E2E lịch sử lớn ${RUN} #${index}`,
        );
      }
      candidateId = await createExpense(
        api,
        account.accountId,
        foodId,
        '5000000.00',
        new Date(now - 2 * 60_000).toISOString(),
        `E2E khoản chi lớn ${RUN}`,
      );
    } finally {
      await api.dispose();
    }

    await openAlertsPage(page);
    await scanFromUi(page);

    const alert = await findAlert(
      page,
      (item) => item.type === 'LARGE_TRANSACTION' && item.transactionId === candidateId,
    );
    expect(alert.facts.amount).toBe('5000000.00');
    expect(alert.facts.median).toBe('104500.00');

    const dialog = await openDetail(page, '5.000.000');
    await expect(dialog).toContainText('Chi tiêu lớn');
    await expect(dialog.getByText(alert.explanation)).toBeVisible();
    await expect(dialog).toContainText('5.000.000');
    await expect(dialog).toContainText('104.500');
    await expect(dialog).toContainText('robust z-score');
  });

  test('Flow B — a category spike is detected against the matched reference months', async ({
    page,
  }) => {
    const account = loadAccount();
    const api = await ownerContext();
    try {
      const transportId = await categoryId(api, 'transport');
      // Two expenses per reference month (40 000 + 60 000 = 100 000).
      for (let monthsBack = 1; monthsBack <= 3; monthsBack += 1) {
        const at = referenceMonthInstant(monthsBack);
        await createExpense(
          api,
          account.accountId,
          transportId,
          '40000.00',
          at,
          `E2E tham chiếu tháng ${monthsBack} ${RUN}`,
        );
        await createExpense(
          api,
          account.accountId,
          transportId,
          '60000.00',
          at,
          `E2E tham chiếu tháng ${monthsBack} ${RUN}`,
        );
      }
      // Six current-month expenses summing to 1 500 000 (15× the baseline).
      const amounts = [
        '200000.00',
        '220000.00',
        '240000.00',
        '260000.00',
        '280000.00',
        '300000.00',
      ];
      const instants = currentMonthInstants(amounts.length);
      for (let index = 0; index < amounts.length; index += 1) {
        await createExpense(
          api,
          account.accountId,
          transportId,
          amounts[index],
          instants[index],
          `E2E cao điểm di chuyển ${RUN} #${index}`,
        );
      }
    } finally {
      await api.dispose();
    }

    await openAlertsPage(page);
    await page.getByLabel('Loại cảnh báo', { exact: true }).selectOption('CATEGORY_SPIKE');
    await scanFromUi(page);
    await expect(page.getByRole('heading', { name: 'Cảnh báo chi tiêu' })).toBeVisible();

    const alert = await findAlert(
      page,
      (item) => item.type === 'CATEGORY_SPIKE' && item.categoryName === 'Di chuyển',
    );
    expect(alert.facts.currentSpend).toBe('1500000.00');
    expect(alert.facts.categoryName).toBe('Di chuyển');

    const dialog = await openDetail(page, 'Di chuyển');
    await expect(dialog.getByText(alert.explanation)).toBeVisible();
    await expect(dialog).toContainText('1.500.000');
    await expect(dialog).toContainText('Các tháng tham chiếu');
    await expect(dialog).toContainText('Chi tiêu tháng này');
  });

  test('Flow C — a possible duplicate shows both transactions without inventing links', async ({
    page,
  }) => {
    const account = loadAccount();
    const api = await ownerContext();
    let firstId: string;
    let secondId: string;
    try {
      const shoppingId = await categoryId(api, 'shopping');
      const now = Date.now();
      firstId = await createExpense(
        api,
        account.accountId,
        shoppingId,
        '777001.00',
        new Date(now - 8 * 60_000).toISOString(),
        `E2E nhập trùng ${RUN}`,
      );
      secondId = await createExpense(
        api,
        account.accountId,
        shoppingId,
        '777001.00',
        new Date(now - 3 * 60_000).toISOString(),
        `E2E nhập trùng ${RUN}`,
      );
    } finally {
      await api.dispose();
    }

    await openAlertsPage(page);
    // Two 777 001 expenses are also large for their category, so narrow the
    // list to duplicates before opening the detail.
    // The explain button is named "Các loại cảnh báo: Loại cảnh báo", so the
    // filter is matched by its exact visible label.
    await page.getByLabel('Loại cảnh báo', { exact: true }).selectOption('POSSIBLE_DUPLICATE');
    await scanFromUi(page);

    const alert = await findAlert(page, (item) => {
      if (item.type !== 'POSSIBLE_DUPLICATE') return false;
      const ids = new Set([item.transactionId, item.relatedTransactionId]);
      return ids.has(firstId) && ids.has(secondId);
    });
    expect(alert.facts.amount).toBe('777001.00');
    expect(alert.facts.minutesApart).toBe(5);

    const dialog = await openDetail(page, '777.001');
    await expect(dialog.getByText(alert.explanation)).toBeVisible();
    await expect(dialog).toContainText('Hai giao dịch bị nghi trùng');
    await expect(dialog).toContainText(firstId);
    await expect(dialog).toContainText(secondId);
    await expect(dialog).toContainText('5 phút');
  });

  test('Flow D — status changes wait for the API, persist and hide invalid transitions', async ({
    page,
  }) => {
    const account = loadAccount();
    const api = await ownerContext();
    let candidateId: string;
    try {
      const healthId = await categoryId(api, 'health');
      const now = Date.now();
      for (let index = 0; index < 10; index += 1) {
        await createExpense(
          api,
          account.accountId,
          healthId,
          `${300000 + index * 1000}.00`,
          new Date(now - (70 - index) * DAY_MS).toISOString(),
          `E2E lịch sử trạng thái ${RUN} #${index}`,
        );
      }
      candidateId = await createExpense(
        api,
        account.accountId,
        healthId,
        '3300300.00',
        new Date(now - 2 * 60_000).toISOString(),
        `E2E khoản chi trạng thái ${RUN}`,
      );
    } finally {
      await api.dispose();
    }

    await openAlertsPage(page);
    await scanFromUi(page);
    const alert = await findAlert(
      page,
      (item) => item.type === 'LARGE_TRANSACTION' && item.transactionId === candidateId,
    );
    expect(alert.status).toBe('OPEN');

    // Hold the PATCH response so the "only after success" rule is observable.
    const statusPattern = /\/api\/v1\/alerts\/[^/]+\/status$/;
    await page.route(statusPattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    let dialog = await openDetail(page, '3.300.300');
    const patchPromise = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && statusPattern.test(response.url()),
    );
    await dialog.getByRole('button', { name: 'Đã xem' }).click();
    await expect(dialog.getByText('Trạng thái: Chưa xử lý')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Đang cập nhật...' })).toBeVisible();
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBeTruthy();
    await expect(dialog.getByText('Trạng thái: Đã xem')).toBeVisible();

    // Reload: the new status comes back from the server, not from local state.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Cảnh báo chi tiêu' })).toBeVisible();
    await expect(alertCard(page, '3.300.300')).toContainText('Trạng thái: Đã xem');

    dialog = await openDetail(page, '3.300.300');
    await dialog.getByRole('button', { name: 'Đánh dấu bình thường' }).click();
    await expect(dialog.getByText('Trạng thái: Bình thường')).toBeVisible();

    // MARKED_NORMAL cannot go straight to ACKNOWLEDGED: not offered, and the
    // API rejects it too.
    await expect(dialog.getByRole('button', { name: 'Đã xem' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Bỏ qua' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mở lại' })).toBeVisible();
    const rejected = await page.request.patch(`/api/v1/alerts/${alert.id}/status`, {
      data: { status: 'ACKNOWLEDGED' },
    });
    expect(rejected.status()).toBe(400);

    await page.unroute(statusPattern);
    await page.reload();
    await expect(alertCard(page, '3.300.300')).toContainText('Trạng thái: Bình thường');
  });

  test('Flow E — a truncated scan names the duplicate cap, never claims completeness, and is idempotent', async ({
    page,
  }) => {
    const account = loadAccount();
    const api = await ownerContext();
    try {
      const otherId = await categoryId(api, 'other');
      const now = Date.now();
      // Seven identical expenses within 24 h produce 21 candidate pairs, which
      // hits the server's 20-pair cap — a real truncated scan, no mocking.
      for (let index = 0; index < 7; index += 1) {
        await createExpense(
          api,
          account.accountId,
          otherId,
          '987654.00',
          new Date(now - (index + 1) * 60_000).toISOString(),
          `E2E quét giới hạn ${RUN} #${index}`,
        );
      }
    } finally {
      await api.dispose();
    }

    await openAlertsPage(page);
    const firstScan = await scanFromUi(page);
    expect(firstScan.status).toBe('truncated');
    expect(firstScan.limits.duplicateCapReached).toBe(true);
    expect(firstScan.limits.transactionsTruncated).toBe(false);
    expect(firstScan.limits.largeCandidatesCapped).toBe(false);

    const summary = page.getByRole('status');
    await expect(summary).toContainText('Bị giới hạn');
    await expect(summary).toContainText('Lần quét này chưa đầy đủ.');
    await expect(summary).toContainText('giới hạn 20 cặp giao dịch có thể trùng');
    await expect(summary).not.toContainText('Hoàn tất');
    await expect(summary).not.toContainText('Chỉ xét tối đa 5000 giao dịch gần nhất');
    await expect(summary).not.toContainText('Chỉ phân tích tối đa 500 khoản chi gần nhất');

    // Scanning again creates nothing: alerts are deduplicated by dedupeKey.
    const totalBefore = await alertCount(page);
    const secondScan = await scanFromUi(page);
    expect(secondScan.created).toBe(0);
    await expect(page.getByRole('status')).toContainText('Mới lưu 0');
    expect(await alertCount(page)).toBe(totalBefore);
  });
});

test.describe('spending alerts isolation', () => {
  test("does not expose one user's alerts to another and cascades the test data safely", async ({
    page,
  }) => {
    const account = loadAccount();
    const ownerApi = await ownerContext();
    let alertId: string;
    try {
      const foodId = await categoryId(ownerApi, 'food');
      const now = Date.now();
      await createExpense(
        ownerApi,
        account.accountId,
        foodId,
        '654321.00',
        new Date(now - 5 * 60_000).toISOString(),
        `E2E cách ly ${RUN} A`,
      );
      await createExpense(
        ownerApi,
        account.accountId,
        foodId,
        '654321.00',
        new Date(now - 1 * 60_000).toISOString(),
        `E2E cách ly ${RUN} B`,
      );
      const scan = await ownerApi.post('/api/v1/alerts/scan');
      expect(scan.ok()).toBeTruthy();

      const ownerList = await ownerApi.get('/api/v1/alerts?limit=100');
      expect(ownerList.ok()).toBeTruthy();
      const ownerBody = (await ownerList.json()) as PaginatedDto<SpendingAlertDto>;
      const owned = ownerBody.items.find((item) => item.type === 'POSSIBLE_DUPLICATE');
      expect(owned, 'owner should see their own duplicate alert').toBeTruthy();
      alertId = owned!.id;
    } finally {
      await ownerApi.dispose();
    }

    const outsider = await newRequest.newContext({
      baseURL: E2E_WEB_ORIGIN,
      storageState: ANONYMOUS_STATE,
    });
    try {
      const email = `outsider.alerts.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
      const registered = await outsider.post('/api/v1/auth/register', {
        data: { email, password: E2E_PASSWORD, displayName: 'Outsider Alerts' },
      });
      expect(registered.ok()).toBeTruthy();

      const theirs = await outsider.get('/api/v1/alerts');
      expect(theirs.ok()).toBeTruthy();
      const theirBody = (await theirs.json()) as PaginatedDto<SpendingAlertDto>;
      expect(theirBody.total).toBe(0);
      expect(theirBody.items).toHaveLength(0);

      const escalated = await outsider.patch(`/api/v1/alerts/${alertId}/status`, {
        data: { status: 'DISMISSED' },
      });
      expect(escalated.status()).toBe(404);
    } finally {
      await outsider.dispose();
    }

    // The owner still sees the untouched alert after the outsider's attempt.
    const owner = await ownerContext();
    try {
      const list = await owner.get('/api/v1/alerts?limit=100');
      const body = (await list.json()) as PaginatedDto<SpendingAlertDto>;
      const stillOpen = body.items.find((item) => item.id === alertId);
      expect(stillOpen?.status).toBe('OPEN');
    } finally {
      await owner.dispose();
    }
    // `/alerts` remains usable for the signed-in browser session too.
    await openAlertsPage(page);
    await expect(page.getByRole('heading', { name: 'Cảnh báo chi tiêu' })).toBeVisible();
  });
});
