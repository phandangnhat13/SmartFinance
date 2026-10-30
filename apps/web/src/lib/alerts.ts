import type {
  SpendingAlertSeverity,
  SpendingAlertStatus,
  SpendingAlertType,
} from '@smart-finance/shared-types';
import { formatMoney } from './format';

export type BadgeTone = 'emerald' | 'rose' | 'amber' | 'slate' | 'sky';

export const ALERT_TYPE_LABELS: Record<SpendingAlertType, string> = {
  LARGE_TRANSACTION: 'Chi tiêu lớn',
  CATEGORY_SPIKE: 'Tăng đột biến theo danh mục',
  POSSIBLE_DUPLICATE: 'Có thể trùng lặp',
};

export const ALERT_SEVERITY_LABELS: Record<SpendingAlertSeverity, string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
};

export const ALERT_STATUS_LABELS: Record<SpendingAlertStatus, string> = {
  OPEN: 'Chưa xử lý',
  ACKNOWLEDGED: 'Đã xem',
  DISMISSED: 'Bỏ qua',
  MARKED_NORMAL: 'Bình thường',
};

export const ALERT_SEVERITY_TONES: Record<SpendingAlertSeverity, BadgeTone> = {
  LOW: 'slate',
  MEDIUM: 'amber',
  HIGH: 'rose',
};

export const ALERT_STATUS_TONES: Record<SpendingAlertStatus, BadgeTone> = {
  OPEN: 'amber',
  ACKNOWLEDGED: 'sky',
  DISMISSED: 'slate',
  MARKED_NORMAL: 'emerald',
};

export interface AlertStatusAction {
  status: SpendingAlertStatus;
  label: string;
  description: string;
  tone: 'primary' | 'secondary';
}

const ACTION_DETAILS: Record<SpendingAlertStatus, Omit<AlertStatusAction, 'status'>> = {
  OPEN: {
    label: 'Mở lại',
    description: 'Đưa cảnh báo về trạng thái chưa xử lý để xem xét lại.',
    tone: 'secondary',
  },
  ACKNOWLEDGED: {
    label: 'Đã xem',
    description: 'Ghi nhận bạn đã xem cảnh báo. Đây không phải xác nhận gian lận.',
    tone: 'primary',
  },
  DISMISSED: {
    label: 'Bỏ qua',
    description: 'Không cần xử lý cảnh báo này nữa.',
    tone: 'secondary',
  },
  MARKED_NORMAL: {
    label: 'Đánh dấu bình thường',
    description: 'Khoản chi này là bình thường với bạn.',
    tone: 'secondary',
  },
};

function action(status: SpendingAlertStatus): AlertStatusAction {
  return { status, ...ACTION_DETAILS[status] };
}

/**
 * Mirrors the transitions enforced by the API (`alert-status.ts`). The server
 * stays the authority — this list only keeps the UI from offering a change the
 * API would reject. OPEN always has the same status, so it is never listed.
 */
export const ALERT_STATUS_ACTIONS: Record<SpendingAlertStatus, readonly AlertStatusAction[]> = {
  OPEN: [action('ACKNOWLEDGED'), action('DISMISSED'), action('MARKED_NORMAL')],
  ACKNOWLEDGED: [action('OPEN'), action('DISMISSED'), action('MARKED_NORMAL')],
  DISMISSED: [action('OPEN'), action('MARKED_NORMAL')],
  MARKED_NORMAL: [action('OPEN'), action('DISMISSED')],
};

/** `facts` is stored JSON: everything read from it must be type-checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function factString(facts: Record<string, unknown>, key: string): string | null {
  const value = facts[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function factNumber(facts: Record<string, unknown>, key: string): number | null {
  return toFiniteNumber(facts[key]);
}

export function factBoolean(facts: Record<string, unknown>, key: string): boolean | null {
  const value = facts[key];
  return typeof value === 'boolean' ? value : null;
}

export function factRecord(
  facts: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = facts[key];
  return isRecord(value) ? value : null;
}

export function factRecordArray(
  facts: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = facts[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isCurrencyCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

export function normalizeCurrency(value: string | null | undefined): string {
  return isCurrencyCode(value) ? value : 'VND';
}

/** Uses the alert's own currency when it is valid, never inventing an exchange rate. */
export function resolveCurrency(facts: Record<string, unknown>, fallback: string): string {
  const currency = factString(facts, 'currency');
  return isCurrencyCode(currency) ? currency : normalizeCurrency(fallback);
}

export function formatAmountValue(value: unknown, currency: string): string | null {
  const amount = toFiniteNumber(value);
  if (amount === null) return null;
  return formatMoney(amount, currency);
}

export function formatDecimal(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

export function formatRatioValue(value: unknown): string | null {
  const ratio = toFiniteNumber(value);
  return ratio === null ? null : `${formatDecimal(ratio)}×`;
}

/**
 * Calendar dates (`YYYY-MM-DD`) are not instants: converting them through a
 * timezone could move them one day, so they are formatted textually.
 */
export function formatCalendarDate(value: string | null): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** `YYYY-MM` → `MM/YYYY`, used for the scan window and category references. */
export function formatMonthLabel(value: string | null): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return '—';
  return `${match[2]}/${match[1]}`;
}
