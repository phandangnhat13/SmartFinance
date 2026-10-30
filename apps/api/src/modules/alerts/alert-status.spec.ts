import type { SpendingAlertStatus } from '@prisma/client';
import {
  ALERT_STATUS_TRANSITIONS,
  isAlertStatusTransitionAllowed,
  nextResolvedAt,
} from './alert-status';

const STATUSES: SpendingAlertStatus[] = ['OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'MARKED_NORMAL'];

describe('isAlertStatusTransitionAllowed', () => {
  it('allows every change from OPEN', () => {
    for (const status of STATUSES) {
      expect(isAlertStatusTransitionAllowed('OPEN', status)).toBe(true);
    }
  });

  it('accepts the current status as an idempotent no-op', () => {
    for (const status of STATUSES) {
      expect(isAlertStatusTransitionAllowed(status, status)).toBe(true);
    }
  });

  it('refuses to turn a settled alert into ACKNOWLEDGED without reopening it', () => {
    expect(isAlertStatusTransitionAllowed('DISMISSED', 'ACKNOWLEDGED')).toBe(false);
    expect(isAlertStatusTransitionAllowed('MARKED_NORMAL', 'ACKNOWLEDGED')).toBe(false);
  });

  it('lets the user reopen or reclassify settled alerts', () => {
    expect(isAlertStatusTransitionAllowed('DISMISSED', 'OPEN')).toBe(true);
    expect(isAlertStatusTransitionAllowed('DISMISSED', 'MARKED_NORMAL')).toBe(true);
    expect(isAlertStatusTransitionAllowed('MARKED_NORMAL', 'OPEN')).toBe(true);
    expect(isAlertStatusTransitionAllowed('MARKED_NORMAL', 'DISMISSED')).toBe(true);
    expect(isAlertStatusTransitionAllowed('ACKNOWLEDGED', 'DISMISSED')).toBe(true);
    expect(isAlertStatusTransitionAllowed('ACKNOWLEDGED', 'OPEN')).toBe(true);
  });

  it('documents a target list for every source status', () => {
    for (const status of STATUSES) {
      expect(ALERT_STATUS_TRANSITIONS[status]).not.toContain(status);
      for (const target of ALERT_STATUS_TRANSITIONS[status]) {
        expect(STATUSES).toContain(target);
      }
    }
  });
});

describe('nextResolvedAt', () => {
  const now = new Date('2026-10-30T10:00:00.000Z');

  it('clears the timestamp when the alert is reopened', () => {
    expect(nextResolvedAt('OPEN', new Date('2026-10-01T00:00:00.000Z'), now)).toBeNull();
  });

  it('stamps the first resolution', () => {
    expect(nextResolvedAt('DISMISSED', null, now)).toEqual(now);
  });

  it('keeps the first resolution time when reclassifying a settled alert', () => {
    const first = new Date('2026-10-01T00:00:00.000Z');
    expect(nextResolvedAt('MARKED_NORMAL', first, now)).toEqual(first);
  });

  it('stamps a new resolution after the alert was reopened', () => {
    expect(nextResolvedAt('ACKNOWLEDGED', null, now)).toEqual(now);
  });
});
