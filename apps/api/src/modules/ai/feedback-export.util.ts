import { AI_TAXONOMY } from '@smart-finance/shared-types';

export const FEEDBACK_SCHEMA_VERSION = 1;

const TAXONOMY_SLUGS = new Set<string>(AI_TAXONOMY.map((category) => category.slug));

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const VIETNAM_PHONE_PATTERN = /(?:\+84|0)\d{8,10}\b/g;
const LONG_DIGIT_PATTERN = /\b\d{9,}\b/g;
// eslint-disable-next-line no-control-regex -- stripping control characters is intentional
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export interface FeedbackSource {
  predictionId: string;
  inputDescription: string;
  predictedSlug: string | null;
  acceptedSlug: string | null;
  modelVersion: string;
  status: string;
}

export interface FeedbackRecord {
  schemaVersion: number;
  text: string;
  label: string;
  predictedLabel: string | null;
  status: string;
  modelVersion: string;
}

/**
 * Remove direct identifiers that users sometimes type into a transaction
 * description. Amounts (e.g. 65000) are intentionally left untouched.
 */
export function redactDescription(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[email]')
    .replace(VIETNAM_PHONE_PATTERN, '[phone]')
    .replace(LONG_DIGIT_PATTERN, '[number]')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function normalizeFeedbackKey(text: string, label: string): string {
  return `${label}::${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

export function buildFeedbackRecord(source: FeedbackSource): FeedbackRecord | null {
  const accepted = source.acceptedSlug?.trim() ?? '';
  if (!TAXONOMY_SLUGS.has(accepted)) return null;

  const text = redactDescription(source.inputDescription);
  if (text.length < 3) return null;

  const predicted =
    source.predictedSlug && TAXONOMY_SLUGS.has(source.predictedSlug) ? source.predictedSlug : null;

  return {
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    text,
    label: accepted,
    predictedLabel: predicted,
    status: source.status,
    modelVersion: source.modelVersion,
  };
}
