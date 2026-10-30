import type { SpendingAlertDto, SpendingAlertType } from '@smart-finance/shared-types';
import type { AlertRecord } from './alerts.service';
import { explainCategorySpike, type CategorySpikeFacts } from './detectors/category-spike.detector';
import {
  explainLargeTransaction,
  type LargeTransactionFacts,
} from './detectors/large-transaction.detector';
import {
  explainPossibleDuplicate,
  type PossibleDuplicateFacts,
} from './detectors/possible-duplicate.detector';

const FALLBACK_EXPLANATION =
  'Hệ thống đã ghi nhận một điểm bất thường trong chi tiêu của bạn. ' +
  'Hãy mở cảnh báo để xem số liệu chi tiết.';

/**
 * Rebuilds the explanation from the stored facts. Falling back instead of
 * throwing means a row written by an older version of a detector can never
 * break the list endpoint.
 */
export function explainAlert(type: SpendingAlertType, facts: unknown): string {
  try {
    switch (type) {
      case 'LARGE_TRANSACTION':
        return explainLargeTransaction(facts as LargeTransactionFacts);
      case 'CATEGORY_SPIKE':
        return explainCategorySpike(facts as CategorySpikeFacts);
      case 'POSSIBLE_DUPLICATE':
        return explainPossibleDuplicate(facts as PossibleDuplicateFacts);
    }
  } catch {
    return FALLBACK_EXPLANATION;
  }
  return FALLBACK_EXPLANATION;
}

function factsRecord(value: AlertRecord['facts']): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function toSpendingAlertDto(alert: AlertRecord): SpendingAlertDto {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    dedupeKey: alert.dedupeKey,
    transactionId: alert.transactionId,
    relatedTransactionId: alert.relatedTransactionId,
    categoryId: alert.categoryId,
    categoryName: alert.category?.name ?? null,
    periodStart: alert.periodStart ? alert.periodStart.toISOString().slice(0, 10) : null,
    periodEnd: alert.periodEnd ? alert.periodEnd.toISOString().slice(0, 10) : null,
    score: alert.score ? alert.score.toFixed(4) : null,
    facts: factsRecord(alert.facts),
    explanation: explainAlert(alert.type, alert.facts),
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    resolvedAt: alert.resolvedAt ? alert.resolvedAt.toISOString() : null,
  };
}
