export function formatMoney(value: string | number, currency = 'VND'): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(amount);
}

export function formatDate(iso: string, timezone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export function formatDateTime(iso: string, timezone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/** Size of a change without a sign, for sentences phrased with "tăng"/"giảm". */
export function formatPercentMagnitude(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

/** `YYYY-MM` → `MM/YYYY` for chart axes and tables. */
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${monthNumber}/${year}`;
}

/**
 * `YYYY-MM-DD` → `DD/MM/YYYY` without going through a Date, so a date-only
 * value never shifts a day in a negative-offset browser timezone.
 */
export function formatDateOnly(value: string): string {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return '—';
  return `${day}/${month}/${year}`;
}
