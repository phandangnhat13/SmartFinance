import { expect, test, type Page } from '@playwright/test';

const RUN = Date.now().toString(36);

async function openNewTransactionForm(page: Page) {
  await page.goto('/transactions/new');
  // Wait for accounts and categories to load before interacting with the form.
  await expect(page.locator('#accountId option')).toHaveCount(2);
  await expect(page.locator('#categoryId option').filter({ hasText: 'Ăn uống' })).toBeAttached();
  await page.locator('#accountId').selectOption({ index: 1 });
}

async function selectExpenseCategory(page: Page, name: string) {
  const option = page.locator('#categoryId option').filter({ hasText: name }).first();
  const value = await option.getAttribute('value');
  expect(value).toBeTruthy();
  await page.locator('#categoryId').selectOption(value!);
  return value!;
}

async function submit(page: Page) {
  await page.getByRole('button', { name: 'Thêm giao dịch', exact: true }).click();
}

test.describe('transaction list states', () => {
  test('a brand-new user sees the empty state', async ({ page }) => {
    const email = `empty.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
    const response = await page.request.post('/api/v1/auth/register', {
      data: { email, password: 'E2ePassword123!', displayName: 'Empty State' },
    });
    if (!response.ok()) {
      throw new Error(`Register failed: ${response.status()} ${await response.text()}`);
    }

    await page.goto('/transactions');
    await expect(page.getByText('Không có giao dịch phù hợp')).toBeVisible();
  });

  test('shows a loading state while the list request is in flight', async ({ page }) => {
    let held = false;
    await page.route(/\/api\/v1\/transactions\?/, async (route) => {
      held = true;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await page.goto('/transactions');
    await expect(page.getByText('Đang tải giao dịch...')).toBeVisible();
    expect(held).toBe(true);
    await expect(page.getByText('Đang tải giao dịch...')).toBeHidden({ timeout: 15_000 });
    await page.unroute(/\/api\/v1\/transactions\?/);
  });

  test('shows an error with a retry action and recovers', async ({ page }) => {
    // React Query retries once, so fail the initial attempt and its retry.
    let failuresLeft = 2;
    await page.route(/\/api\/v1\/transactions\?/, async (route) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            code: 'INTERNAL_ERROR',
            message: 'Không tải được giao dịch (E2E)',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/transactions');
    await expect(page.getByText('Không tải được giao dịch (E2E)')).toBeVisible();
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByText('Không tải được giao dịch (E2E)')).toBeHidden();
    await page.unroute(/\/api\/v1\/transactions\?/);
  });
});

test.describe('AI-assisted transaction entry', () => {
  test('accepts an AI suggestion and saves the transaction', async ({ page }) => {
    const description = `an trua van phong ${RUN}`;
    await openNewTransactionForm(page);

    await page.locator('#amount').fill('65000');
    await page.locator('#description').fill(description);

    await expect(page.getByText(/AI gợi ý:/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/AI gợi ý: Ăn uống/)).toBeVisible();
    await page.getByRole('button', { name: 'Dùng gợi ý' }).click();
    await expect(page.locator('#categoryId option:checked')).toHaveText(/Ăn uống/);

    await submit(page);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  });

  test('records a correction when the user picks another category', async ({ page }) => {
    const description = `mua áo sơ mi ${RUN}`;
    await openNewTransactionForm(page);

    await page.locator('#amount').fill('350000');
    await page.locator('#description').fill(description);
    await expect(page.getByText(/AI gợi ý: Mua sắm/)).toBeVisible({ timeout: 15_000 });

    const feedback = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        /\/api\/v1\/ai\/predictions\/[^/]+\/feedback$/.test(request.url()),
    );
    const foodCategoryId = await selectExpenseCategory(page, 'Ăn uống');
    const feedbackRequest = await feedback;
    expect(feedbackRequest.postDataJSON()).toMatchObject({
      action: 'CORRECT',
      categoryId: foodCategoryId,
    });

    await submit(page);
    await expect(page).toHaveURL(/\/transactions$/);
    const row = page.locator('tr', { hasText: description });
    await expect(row).toBeVisible();
    await expect(row.getByText('Ăn uống')).toBeVisible();
  });

  test('offers ranked candidates for a low-confidence answer without auto-filling', async ({
    page,
  }) => {
    const description = `[lowconf] mua đồ ${RUN}`;
    await openNewTransactionForm(page);

    await page.locator('#amount').fill('42000');
    await page.locator('#description').fill(description);

    const panel = page.getByTestId('ai-low-confidence');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText(
      'AI chưa chắc chắn về danh mục cho mô tả này. Vui lòng tự chọn danh mục.',
    );
    // The prediction is never applied automatically, even though candidates exist.
    await expect(page.getByRole('button', { name: 'Dùng gợi ý' })).toHaveCount(0);
    await expect(page.locator('#categoryId')).toHaveValue('');

    await expect(panel.getByRole('button', { name: /Mua sắm/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Ăn uống/ })).toBeVisible();

    // Picking a ranked candidate records a CORRECT (it differs from the top label).
    const feedback = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        /\/api\/v1\/ai\/predictions\/[^/]+\/feedback$/.test(request.url()),
    );
    await panel.getByRole('button', { name: /Mua sắm/ }).click();
    const feedbackRequest = await feedback;
    expect(feedbackRequest.postDataJSON()).toMatchObject({ action: 'CORRECT' });
    await expect(page.locator('#categoryId')).not.toHaveValue('');

    await submit(page);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  });

  test('falls back to manual selection when a low-confidence answer has no candidates', async ({
    page,
  }) => {
    // Simulates an older AI service that omits `alternatives`.
    await page.route('**/api/v1/ai/classify-transaction', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categoryId: '00000000-0000-4000-8000-000000000000',
          categoryName: 'Ăn uống',
          slug: 'food',
          confidence: 0.31,
          status: 'low_confidence',
          predictionId: null,
          modelVersion: 'e2e-stub-v1',
        }),
      }),
    );
    const description = `[lowconf] không gợi ý ${RUN}`;
    await openNewTransactionForm(page);

    await page.locator('#amount').fill('15000');
    await page.locator('#description').fill(description);

    const panel = page.getByTestId('ai-low-confidence');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole('button')).toHaveCount(0);
    await expect(page.locator('#categoryId')).toHaveValue('');

    await selectExpenseCategory(page, 'Khác');
    await submit(page);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  });

  test('keeps the form usable when the AI service is offline', async ({ page }) => {
    const description = `[offline] mua áo ${RUN}`;
    await openNewTransactionForm(page);

    await page.locator('#amount').fill('120000');
    await page.locator('#description').fill(description);

    await expect(
      page.getByText('AI tạm thời không khả dụng. Bạn vẫn có thể lưu giao dịch bình thường.'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#amount')).toHaveValue('120000');
    await expect(page.locator('#description')).toHaveValue(description);

    await selectExpenseCategory(page, 'Mua sắm');
    await submit(page);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  });

  test('keeps the form usable when the AI connection drops', async ({ page }) => {
    const description = `[network] mua áo ${RUN}`;
    await openNewTransactionForm(page);

    await page.locator('#amount').fill('99000');
    await page.locator('#description').fill(description);

    await expect(
      page.getByText('AI tạm thời không khả dụng. Bạn vẫn có thể lưu giao dịch bình thường.'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#amount')).toHaveValue('99000');
    await expect(page.locator('#description')).toHaveValue(description);

    await selectExpenseCategory(page, 'Mua sắm');
    await submit(page);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  });
});
