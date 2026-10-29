import { createHash } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Normalize free text for duplicate detection (case, accents-free spacing). */
export function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Fingerprint used by CSV import to avoid inserting the same logical
 * transaction twice. Description is normalized and included, so identical
 * amounts at the same time with different descriptions are kept.
 */
export function importFingerprint(input: {
  userId: string;
  accountId: string;
  type: string;
  amount: string;
  occurredAtIso: string;
  description: string;
}): string {
  return sha256Hex(
    [
      input.userId,
      input.accountId,
      input.type,
      input.amount,
      input.occurredAtIso,
      normalizeText(input.description),
    ].join('|'),
  );
}
