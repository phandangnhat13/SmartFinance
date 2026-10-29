/**
 * Export consenting users' AI feedback as a versioned JSONL dataset.
 *
 * Only rows from users with `allowAiResearch = true` and with a final label
 * (ACCEPTED or CORRECTED) are exported. Direct identifiers in descriptions are
 * redacted. No user id, email or prediction id is written.
 *
 * Usage (from the repository root):
 *   npm run feedback:export -w @smart-finance/api
 *   npm run feedback:export -w @smart-finance/api -- --dry-run
 *   npm run feedback:export -w @smart-finance/api -- --out exports/my-set.jsonl
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildFeedbackExport } from '../modules/ai/feedback-export';

const DEFAULT_EXPORT_DIR = resolve(__dirname, '../../../../exports');

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const output = optionValue('--out')
    ? resolve(process.cwd(), optionValue('--out')!)
    : resolve(DEFAULT_EXPORT_DIR, `ai-feedback-${timestamp()}.jsonl`);

  const prisma = new PrismaClient();
  try {
    const { fileBody, metadata } = await buildFeedbackExport(prisma);

    if (dryRun) {
      console.log(JSON.stringify({ dryRun: true, ...metadata }, null, 2));
      return;
    }

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, fileBody, 'utf8');
    writeFileSync(`${output}.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        {
          output,
          metadataPath: `${output}.meta.json`,
          exportedRecords: metadata.exportedRecords,
          consentingUsers: metadata.consentingUsers,
          skippedInvalid: metadata.skippedInvalid,
          duplicatesRemoved: metadata.duplicatesRemoved,
          fileSha256: metadata.fileSha256,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  // Prisma error messages can echo query arguments, and those include user
  // descriptions. Log only the error class and code by default.
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'n/a';
  console.error(
    `Feedback export failed (${name}, code ${code}). Set AI_EXPORT_DEBUG=1 to print the stack trace.`,
  );
  if (process.env.AI_EXPORT_DEBUG === '1' && error instanceof Error) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
