/**
 * Shared environment helpers for the browser E2E suite.
 *
 * The suite must never touch the development database, so it derives a separate
 * database name (`smart_finance_e2e`) from the developer's `DATABASE_URL` unless
 * `E2E_DATABASE_URL` is set explicitly. Credentials stay in the untracked
 * `.env`; nothing secret is printed or committed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const E2E_DB_NAME = 'smart_finance_e2e';
export const E2E_API_PORT = 3100;
export const E2E_WEB_PORT = 5174;
export const E2E_AI_PORT = 8011;

export const E2E_API_ORIGIN = `http://localhost:${E2E_API_PORT}`;
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`;
export const E2E_AI_ORIGIN = `http://127.0.0.1:${E2E_AI_PORT}`;

export function readRootEnv() {
  const file = resolve(repoRoot, '.env');
  const values = {};
  if (!existsSync(file)) return values;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function withDatabaseName(databaseUrl, name) {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Resolve the isolated E2E database URL. `E2E_DATABASE_URL` wins; otherwise the
 * name in `DATABASE_URL` is swapped for `smart_finance_e2e`.
 */
export function resolveE2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const fileEnv = readRootEnv();
  const base = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env or set E2E_DATABASE_URL.');
  }
  return withDatabaseName(base, E2E_DB_NAME);
}

/** Connection URL for the maintenance `postgres` database, used to create the E2E DB. */
export function resolveAdminDatabaseUrl(e2eDatabaseUrl) {
  return withDatabaseName(e2eDatabaseUrl, 'postgres');
}

/** Mask a connection string before it is printed. */
export function maskDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return `${url.protocol}//${url.username ? '***@' : ''}${url.host}${url.pathname}`;
}
