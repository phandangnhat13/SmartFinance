import type { SpendingAlertStatus } from '@prisma/client';

/**
 * Allowed user-driven status changes.
 *
 * A dismissed or "normal" alert cannot quietly become "acknowledged": the user
 * has already settled it, so they must reopen it first. Setting the status it
 * already has is accepted as a no-op (PATCH stays idempotent).
 */
export const ALERT_STATUS_TRANSITIONS: Record<SpendingAlertStatus, readonly SpendingAlertStatus[]> =
  {
    OPEN: ['ACKNOWLEDGED', 'DISMISSED', 'MARKED_NORMAL'],
    ACKNOWLEDGED: ['OPEN', 'DISMISSED', 'MARKED_NORMAL'],
    DISMISSED: ['OPEN', 'MARKED_NORMAL'],
    MARKED_NORMAL: ['OPEN', 'DISMISSED'],
  };

export function isAlertStatusTransitionAllowed(
  from: SpendingAlertStatus,
  to: SpendingAlertStatus,
): boolean {
  return from === to || ALERT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * `resolvedAt` records when the alert stopped being open. Returning to OPEN
 * clears it; moving between settled states keeps the first resolution time so
 * the alert does not look freshly resolved after every re-scan or click.
 */
export function nextResolvedAt(
  to: SpendingAlertStatus,
  current: Date | null,
  now: Date = new Date(),
): Date | null {
  if (to === 'OPEN') return null;
  return current ?? now;
}
