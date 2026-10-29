/**
 * Delete stale CSV import previews.
 *
 * Only batches still in PREVIEW_READY are removed; committed/failed batches are
 * kept as history. Imported rows that were committed are unaffected, because
 * the batch is no longer PREVIEW_READY. The cascade removes import_rows.
 *
 * Usage (from the repository root):
 *   npm run imports:purge -w @smart-finance/api -- --dry-run
 *   npm run imports:purge -w @smart-finance/api -- --days 30
 */

import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import { ImportsService } from '../modules/imports/imports.service';

const DEFAULT_RETENTION_DAYS = 30;

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function retentionDays(): number {
  const raw = optionValue('--days') ?? process.env.IMPORT_PREVIEW_RETENTION_DAYS ?? '';
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('--days must be a positive integer');
  }
  return value;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const days = retentionDays();
  const prisma = new PrismaClient();
  try {
    if (dryRun) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const count = await prisma.importBatch.count({
        where: { status: 'PREVIEW_READY', createdAt: { lt: cutoff } },
      });
      console.log(
        JSON.stringify({ dryRun: true, retentionDays: days, wouldDelete: count }, null, 2),
      );
      return;
    }

    // ImportsService only needs the importBatch delegate; constructing it
    // directly keeps this script from booting the whole Nest application.
    const service = new ImportsService(prisma as unknown as PrismaService);
    const deleted = await service.purgeExpiredPreviews(days);
    console.log(JSON.stringify({ retentionDays: days, deleted }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'n/a';
  console.error(
    `Import preview purge failed (${name}, code ${code}). Set IMPORT_PURGE_DEBUG=1 to print the stack trace.`,
  );
  if (process.env.IMPORT_PURGE_DEBUG === '1' && error instanceof Error) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
