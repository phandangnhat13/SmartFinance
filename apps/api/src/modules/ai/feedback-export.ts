import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  collectFeedbackRecords,
  FEEDBACK_SCHEMA_VERSION,
  type FeedbackSource,
} from './feedback-export.util';

export const FEEDBACK_EXPORT_PURPOSE = 'ai-feedback-research';

export interface FeedbackExportMetadata {
  schemaVersion: number;
  exportedAt: string;
  purpose: string;
  consentField: string;
  consentingUsers: number;
  candidatePredictions: number;
  exportedRecords: number;
  skippedInvalid: number;
  duplicatesRemoved: number;
  perLabel: Record<string, number>;
  redactionApplied: boolean;
  fileSha256: string;
  note: string;
}

export interface FeedbackExport {
  fileBody: string;
  metadata: FeedbackExportMetadata;
}

type FeedbackPrisma = Pick<PrismaClient, 'user' | 'aiPrediction'>;

/**
 * Build the consent-gated, redacted feedback dataset.
 *
 * Eligibility is enforced in the query: only users who currently have
 * `allowAiResearch = true` are read, and only predictions with a final label
 * (ACCEPTED/CORRECTED) that still point at an existing accepted category.
 * The returned metadata contains counts only -- no user identifiers.
 */
export async function buildFeedbackExport(
  prisma: FeedbackPrisma,
  now: Date = new Date(),
): Promise<FeedbackExport> {
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

  const sources: FeedbackSource[] = predictions.map((prediction) => ({
    predictionId: prediction.id,
    inputDescription: prediction.inputDescription,
    predictedSlug: prediction.predictedSlug,
    acceptedSlug: prediction.acceptedCategory?.slug ?? null,
    modelVersion: prediction.modelVersion,
    status: prediction.status,
  }));
  const { records, skippedInvalid, duplicatesRemoved } = collectFeedbackRecords(sources);

  const perLabel: Record<string, number> = {};
  for (const record of records) {
    perLabel[record.label] = (perLabel[record.label] ?? 0) + 1;
  }

  const body = records.map((record) => JSON.stringify(record)).join('\n');
  const fileBody = records.length ? `${body}\n` : '';
  const fingerprint = createHash('sha256').update(fileBody, 'utf8').digest('hex');

  return {
    fileBody,
    metadata: {
      schemaVersion: FEEDBACK_SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      purpose: FEEDBACK_EXPORT_PURPOSE,
      consentField: 'users.allowAiResearch',
      consentingUsers: userIds.length,
      candidatePredictions: predictions.length,
      exportedRecords: records.length,
      skippedInvalid,
      duplicatesRemoved,
      perLabel,
      redactionApplied: true,
      fileSha256: fingerprint,
      note:
        'Synthetic evaluation data must stay separate. Never add these rows to the held-out ' +
        'test set; split by user and text before training.',
    },
  };
}
