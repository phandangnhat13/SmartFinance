#!/usr/bin/env node
/**
 * Prepare the isolated browser-E2E database.
 *
 * Creates `smart_finance_e2e` when missing, applies migrations and seeds the
 * system categories. It never drops or truncates an existing database, and it
 * refuses to run against the database named in `DATABASE_URL`.
 */
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  E2E_DB_NAME,
  maskDatabaseUrl,
  repoRoot,
  resolveAdminDatabaseUrl,
  resolveE2eDatabaseUrl,
} from './env.mjs';

async function ensureDatabase(e2eDatabaseUrl) {
  const admin = new PrismaClient({ datasourceUrl: resolveAdminDatabaseUrl(e2eDatabaseUrl) });
  try {
    const rows = await admin.$queryRawUnsafe(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      E2E_DB_NAME,
    );
    if (rows.length > 0) {
      console.log(`E2E database ${E2E_DB_NAME} already exists.`);
      return;
    }
    // The database name is a constant from this script, never user input.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${E2E_DB_NAME}"`);
    console.log(`Created E2E database ${E2E_DB_NAME}.`);
  } finally {
    await admin.$disconnect();
  }
}

function run(command, env) {
  const result = spawnSync(command, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command}`);
  }
}

async function main() {
  const e2eDatabaseUrl = resolveE2eDatabaseUrl();
  // An explicit E2E_DATABASE_URL is a deliberate choice (CI points DATABASE_URL
  // at the E2E database too). The guard exists for the derived case, where a
  // mismatched DATABASE_URL would otherwise make the suite touch dev data.
  const explicitlyConfigured = Boolean(process.env.E2E_DATABASE_URL);
  if (
    !explicitlyConfigured &&
    new URL(e2eDatabaseUrl).pathname === new URL(process.env.DATABASE_URL ?? 'postgres:/x').pathname
  ) {
    throw new Error('Refusing to use the development database for browser E2E.');
  }
  console.log(`Preparing browser E2E database at ${maskDatabaseUrl(e2eDatabaseUrl)}`);

  await ensureDatabase(e2eDatabaseUrl);

  const env = {
    ...process.env,
    DATABASE_URL: e2eDatabaseUrl,
    // Keep demo transactions out: tests create their own isolated users.
    SEED_DEMO: 'false',
  };
  run('npx prisma migrate deploy', env);
  run('npx prisma db seed', env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
