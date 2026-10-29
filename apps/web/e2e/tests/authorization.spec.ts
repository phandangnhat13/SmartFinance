import { readFileSync } from 'node:fs';
import { expect, request as newRequest, test, type APIRequestContext } from '@playwright/test';
import { E2E_WEB_ORIGIN } from '../env.mjs';
import { AUTH_CONTEXT_PATH, AUTH_STATE_PATH, type E2EContext } from '../global-setup';

function loadAccount(): E2EContext {
  return JSON.parse(readFileSync(AUTH_CONTEXT_PATH, 'utf8')) as E2EContext;
}

async function ownerContext(): Promise<APIRequestContext> {
  return newRequest.newContext({
    baseURL: E2E_WEB_ORIGIN,
    storageState: AUTH_STATE_PATH,
  });
}

// `request.newContext()` inherits the config's storageState inside the test
// runner, so anonymous contexts must clear it explicitly.
const ANONYMOUS_STATE = { cookies: [], origins: [] };

async function outsiderContext(): Promise<APIRequestContext> {
  const context = await newRequest.newContext({
    baseURL: E2E_WEB_ORIGIN,
    storageState: ANONYMOUS_STATE,
  });
  const email = `outsider.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  const registered = await context.post('/api/v1/auth/register', {
    data: { email, password: 'E2ePassword123!', displayName: 'Outsider' },
  });
  expect(registered.ok()).toBeTruthy();
  return context;
}

test.describe('authorization', () => {
  test('rejects anonymous API access', async () => {
    const anonymous = await newRequest.newContext({
      baseURL: E2E_WEB_ORIGIN,
      storageState: ANONYMOUS_STATE,
    });
    try {
      const response = await anonymous.get('/api/v1/transactions');
      expect(response.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });

  test("does not expose one user's transaction to another", async () => {
    const account = loadAccount();
    const owner = await ownerContext();
    const outsider = await outsiderContext();
    try {
      const categories = await owner.get('/api/v1/categories');
      expect(categories.ok()).toBeTruthy();
      const categoryBody = (await categories.json()) as {
        items: Array<{ id: string; slug: string | null; type: string }>;
      };
      const food = categoryBody.items.find(
        (category) => category.slug === 'food' && category.type === 'EXPENSE',
      );
      expect(food).toBeTruthy();

      const created = await owner.post('/api/v1/transactions', {
        data: {
          accountId: account.accountId,
          categoryId: food!.id,
          type: 'EXPENSE',
          amount: '10000',
          occurredAt: new Date().toISOString(),
          description: 'authz check e2e',
        },
      });
      expect(created.status()).toBe(201);
      const createdBody = (await created.json()) as { transaction: { id: string } };
      const transactionId = createdBody.transaction.id;

      expect((await owner.get(`/api/v1/transactions/${transactionId}`)).status()).toBe(200);
      expect((await outsider.get(`/api/v1/transactions/${transactionId}`)).status()).toBe(404);
      expect((await outsider.delete(`/api/v1/transactions/${transactionId}`)).status()).toBe(404);

      const outsiderList = await outsider.get('/api/v1/transactions');
      expect(outsiderList.ok()).toBeTruthy();
      const listBody = (await outsiderList.json()) as {
        items: Array<{ id: string }>;
      };
      expect(listBody.items.some((item) => item.id === transactionId)).toBe(false);
    } finally {
      await owner.dispose();
      await outsider.dispose();
    }
  });
});
