import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { AUTH_CONTEXT_PATH, type E2EContext } from '../global-setup';

// The file is written by global setup, so read it lazily (not at import time).
function loadAccount(): E2EContext {
  return JSON.parse(readFileSync(AUTH_CONTEXT_PATH, 'utf8')) as E2EContext;
}

// Authentication tests start from a clean browser (no session cookie).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('authentication', () => {
  test('redirects an anonymous visitor from a protected page to login', async ({ page }) => {
    await page.goto('/transactions');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  });

  test('shows the same error for a wrong password', async ({ page }) => {
    const account = loadAccount();
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText('Email hoặc mật khẩu không đúng')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logs in and lands on the dashboard', async ({ page }) => {
    const account = loadAccount();
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('navigation').getByText('Tổng quan')).toBeVisible();
  });
});
