/**
 * Creates one throwaway user per run and stores its authenticated browser
 * state. Runs after Playwright has started the web servers.
 *
 * Each run gets a unique email so repeated runs against the same isolated
 * database never share transactions (the empty-state test stays meaningful).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
import { E2E_API_ORIGIN } from './env.mjs';

export const E2E_PASSWORD = 'E2ePassword123!';

const here = dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = resolve(here, '.auth');
export const AUTH_STATE_PATH = resolve(AUTH_DIR, 'user.json');
export const AUTH_CONTEXT_PATH = resolve(AUTH_DIR, 'context.json');

export interface E2EContext {
  email: string;
  password: string;
  accountId: string;
  accountName: string;
}

async function main(): Promise<void> {
  const email = `e2e.${Date.now()}.${process.pid}@example.com`;
  const api = await request.newContext({ baseURL: E2E_API_ORIGIN });
  try {
    const registered = await api.post('/api/v1/auth/register', {
      data: { email, password: E2E_PASSWORD, displayName: 'E2E User' },
    });
    if (!registered.ok()) {
      throw new Error(`Register failed: ${registered.status()} ${await registered.text()}`);
    }

    const accountName = 'Ví E2E';
    const account = await api.post('/api/v1/accounts', {
      data: { name: accountName, type: 'CASH', initialBalance: '1000000', currency: 'VND' },
    });
    if (!account.ok()) {
      throw new Error(`Account setup failed: ${account.status()} ${await account.text()}`);
    }
    const accountBody = (await account.json()) as { account: { id: string } };

    const me = await api.get('/api/v1/auth/me');
    if (!me.ok()) throw new Error(`Session check failed: ${me.status()}`);

    await mkdir(AUTH_DIR, { recursive: true });
    await api.storageState({ path: AUTH_STATE_PATH });
    const context: E2EContext = {
      email,
      password: E2E_PASSWORD,
      accountId: accountBody.account.id,
      accountName,
    };
    await writeFile(AUTH_CONTEXT_PATH, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
    console.log(`E2E user ready: ${email}`);
  } finally {
    await api.dispose();
  }
}

export default main;
