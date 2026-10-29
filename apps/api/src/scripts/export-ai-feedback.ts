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

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  buildFeedbackRecord,
  FEEDBACK_SCHEMA_VERSION,
  normalizeFeedbackKey,
  type FeedbackRecord,
} from '../modules/ai/feedback-export.util';

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
    const consentingUsers = await prisma.user.findMany({
      where: { allowAiResearch: true },
      select: { id: true },
    });
    const userIds = consentingUsers.map((user) => user.id);

    const predictions = userIds.length
      ? await prisma.aiPrediction.findMany({
          where: {
            userId: { in: userIds },
            status: { in: ['ACCEPTED', 'CORRECTED'] },
            acceptedCategoryId: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            inputDescription: true,
            predictedSlug: true,
            modelVersion: true,
            status: true,
            acceptedCategory: { select: { slug: true } },
          },
        })
      : [];

    const seen = new Set<string>();
    const records: FeedbackRecord[] = [];
    let skippedInvalid = 0;
    let duplicatesRemoved = 0;

    for (const prediction of predictions) {
      const record = buildFeedbackRecord({
        predictionId: prediction.id,
        inputDescription: prediction.inputDescription,
        predictedSlug: prediction.predictedSlug,
        acceptedSlug: prediction.acceptedCategory?.slug ?? null,
        modelVersion: prediction.modelVersion,
        status: prediction.status,
      });
      if (!record) {
        skippedInvalid += 1;
        continue;
      }
      const key = normalizeFeedbackKey(record.text, record.label);
      if (seen.has(key)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      records.push(record);
    }

    const perLabel: Record<string, number> = {};
    for (const record of records) {
      perLabel[record.label] = (perLabel[record.label] ?? 0) + 1;
    }

    const body = records.map((record) => JSON.stringify(record)).join('\n');
    const fileBody = records.length ? `${body}\n` : '';
    const fingerprint = createHash('sha256').update(fileBody, 'utf8').digest('hex');

    const metadata = {
      schemaVersion: FEEDBACK_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      purpose: 'ai-feedback-research',
      consentField: 'users.allowAiResearch',
      consentingUsers: userIds.length,
      candidatePredictions: predictions.length,
      exportedRecords: records.length,
      skippedInvalid,
      duplicatesRemoved,
      perLabel,
      redactionApplied: true,
      fileSha256: fingerprint,
      note: 'Synthetic evaluation data must stay separate. Never add these rows to the held-out test set; split by user and text before training.',
    };

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
          exportedRecords: records.length,
          consentingUsers: userIds.length,
          skippedInvalid,
          duplicatesRemoved,
          fileSha256: fingerprint,
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
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`Feedback export failed: ${message}`);
  process.exitCode = 1;
});
