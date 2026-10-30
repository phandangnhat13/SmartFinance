import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import {
  E2E_AI_PORT,
  E2E_API_ORIGIN,
  E2E_API_PORT,
  E2E_WEB_ORIGIN,
  E2E_WEB_PORT,
  repoRoot,
  resolveE2eDatabaseUrl,
} from './e2e/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Browser E2E runs against its own API (port 3100), its own database
 * (`smart_finance_e2e`) and a deterministic AI stub. It never reuses the
 * developer's dev server or the production/development database.
 */
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E_WEB_ORIGIN,
    storageState: './e2e/.auth/user.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node e2e/ai-stub.mjs',
      cwd: here,
      url: `http://127.0.0.1:${E2E_AI_PORT}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { AI_STUB_PORT: String(E2E_AI_PORT) },
    },
    {
      command: 'npm run build -w @smart-finance/api && node apps/api/dist/main.js',
      cwd: repoRoot,
      url: `${E2E_API_ORIGIN}/api/v1/health/live`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(E2E_API_PORT),
        DATABASE_URL: resolveE2eDatabaseUrl(),
        // Test-only secret; never used outside this isolated suite.
        JWT_SECRET: 'e2e-only-secret-please-never-use-in-production',
        WEB_ORIGIN: E2E_WEB_ORIGIN,
        COOKIE_SECURE: 'false',
        AI_SERVICE_URL: `http://127.0.0.1:${E2E_AI_PORT}`,
        AI_TIMEOUT_MS: '1000',
        // The savings assistant talks to the same local stub, using its
        // Anthropic-shaped `/v1/messages` endpoint. The key is a stub-only
        // placeholder: nothing leaves 127.0.0.1.
        LLM_PROVIDER: 'anthropic',
        LLM_API_KEY: 'e2e-stub-key',
        LLM_BASE_URL: `http://127.0.0.1:${E2E_AI_PORT}`,
        LLM_MODEL: 'claude-opus-5-5',
        LLM_TIMEOUT_MS: '2000',
        LLM_MAX_RETRIES: '0',
        // The suite registers a throwaway user per spec (more than the
        // production limit of 5 registrations/minute per IP). This test-only
        // override keeps that protection untouched in every real environment.
        AUTH_THROTTLE_LIMIT: '100',
      },
    },
    {
      command: `npm run dev -w @smart-finance/web -- --port ${E2E_WEB_PORT} --strictPort`,
      cwd: repoRoot,
      url: E2E_WEB_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_PROXY_TARGET: E2E_API_ORIGIN },
    },
  ],
});
