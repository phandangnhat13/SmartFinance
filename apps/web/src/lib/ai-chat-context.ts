import type { AiAssistantType } from '@smart-finance/shared-types';

/**
 * The narrow, frontend-only description of "what the user is looking at" that
 * travels with an `openAiChat()` request.
 *
 * It is deliberately not an API payload: the chat endpoint accepts a prompt and
 * an optional currency, so only `currency` is forwarded when a message is sent.
 * Everything else drives the widget's context indicator and is never treated as
 * an authoritative financial figure. The sanitizer below keeps the contract
 * small and free of identifiers, arbitrary objects or free-form API responses.
 */
export type AiChatPage = 'dashboard' | 'analytics' | 'budgets' | 'insights' | 'goals' | 'alerts';

export interface AiChatDateRange {
  /** Calendar date, YYYY-MM-DD. */
  from: string;
  /** Calendar date, YYYY-MM-DD. Inclusive. */
  to: string;
}

export interface AiChatContext {
  page?: AiChatPage;
  /** Stable feature key such as `income`, `trend-chart` or `forecast`. */
  feature?: string;
  /** Short human label shown in the widget, e.g. "Chi tiêu tháng này". */
  label?: string;
  assistantType?: AiAssistantType;
  /** ISO 4217 code of the currency the page is displaying. */
  currency?: string;
  dateRange?: AiChatDateRange;
  selectedMetric?: string;
  selectedInsight?: string;
  /** Display strings only; never used for calculation. */
  displayedValue?: string;
  comparisonValue?: string;
  /** Short evidence keys the page is showing, e.g. `budget_usage`. */
  evidenceKeys?: string[];
}

export const AI_CHAT_PAGE_LABELS: Record<AiChatPage, string> = {
  dashboard: 'Tổng quan',
  analytics: 'Phân tích xu hướng',
  budgets: 'Ngân sách',
  insights: 'Phân tích tài chính',
  goals: 'Mục tiêu tiết kiệm',
  alerts: 'Cảnh báo chi tiêu',
};

const PAGES = new Set<AiChatPage>([
  'dashboard',
  'analytics',
  'budgets',
  'insights',
  'goals',
  'alerts',
]);
const ASSISTANT_TYPES = new Set<AiAssistantType>(['SAVINGS', 'ANALYTICS']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const EVIDENCE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_EVIDENCE_KEYS = 6;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Control characters never belong in a UI label; collapse the rest.
  const withoutControls = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('');
  const cleaned = withoutControls.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function normalizeDateRange(value: unknown): AiChatDateRange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { from?: unknown; to?: unknown };
  const from = typeof candidate.from === 'string' ? candidate.from.trim() : '';
  const to = typeof candidate.to === 'string' ? candidate.to.trim() : '';
  if (!isCalendarDate(from) || !isCalendarDate(to)) return undefined;
  // ISO calendar dates compare correctly as strings.
  if (from > to) return undefined;
  return { from, to };
}

function normalizeEvidenceKeys(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const key = item.trim();
    if (!EVIDENCE_KEY_PATTERN.test(key)) continue;
    const normalized = key.toLowerCase();
    if (!keys.includes(normalized)) keys.push(normalized);
    if (keys.length >= MAX_EVIDENCE_KEYS) break;
  }
  return keys.length > 0 ? keys : undefined;
}

/**
 * Drops anything the contract does not define and returns only bounded,
 * typed fields. Invalid pieces are removed rather than making the whole
 * context fail, so one bad field cannot block the "ask AI" action.
 */
export function normalizeAiChatContext(input: unknown): AiChatContext | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;

  const page =
    typeof raw.page === 'string' && PAGES.has(raw.page as AiChatPage)
      ? (raw.page as AiChatPage)
      : undefined;
  const assistantType =
    typeof raw.assistantType === 'string' &&
    ASSISTANT_TYPES.has(raw.assistantType as AiAssistantType)
      ? (raw.assistantType as AiAssistantType)
      : undefined;
  const currency =
    typeof raw.currency === 'string' && CURRENCY_PATTERN.test(raw.currency.trim().toUpperCase())
      ? raw.currency.trim().toUpperCase()
      : undefined;
  const dateRange = normalizeDateRange(raw.dateRange);
  const feature = cleanText(raw.feature, 40);
  const label = cleanText(raw.label, 80);
  const selectedMetric = cleanText(raw.selectedMetric, 60);
  const selectedInsight = cleanText(raw.selectedInsight, 80);
  const displayedValue = cleanText(raw.displayedValue, 80);
  const comparisonValue = cleanText(raw.comparisonValue, 80);
  const evidenceKeys = normalizeEvidenceKeys(raw.evidenceKeys);

  const context: AiChatContext = {
    ...(page ? { page } : {}),
    ...(feature ? { feature } : {}),
    ...(label ? { label } : {}),
    ...(assistantType ? { assistantType } : {}),
    ...(currency ? { currency } : {}),
    ...(dateRange ? { dateRange } : {}),
    ...(selectedMetric ? { selectedMetric } : {}),
    ...(selectedInsight ? { selectedInsight } : {}),
    ...(displayedValue ? { displayedValue } : {}),
    ...(comparisonValue ? { comparisonValue } : {}),
    ...(evidenceKeys ? { evidenceKeys } : {}),
  };

  return Object.keys(context).length > 0 ? context : undefined;
}

function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Words that carry no topic on their own. They are ignored when deciding
 * whether a newly typed question is still about the same thing, so a generic
 * phrase ("tháng này", "của tôi", "giải thích") cannot keep stale context alive.
 */
const CONTEXT_STOP_WORDS = new Set([
  'của',
  'cho',
  'tôi',
  'mình',
  'các',
  'những',
  'trong',
  'được',
  'hãy',
  'giúp',
  'với',
  'một',
  'này',
  'đó',
  'như',
  'khi',
  'đang',
  'sẽ',
  'thì',
  'mà',
  'để',
  'từ',
  'đến',
  'trên',
  'dưới',
  'hay',
  'hoặc',
  'rồi',
  'nhé',
  'vậy',
  'thế',
  'nào',
  'sao',
  'không',
  'phải',
  'nhiêu',
  'giải',
  'thích',
  'xem',
  'biết',
  'nói',
  'rằng',
  'bằng',
  'theo',
  'cùng',
  'cũng',
  'rất',
  'quá',
  'lắm',
  'đâu',
  'tháng',
  'năm',
  'ngày',
  'tuần',
]);

function topicWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !CONTEXT_STOP_WORDS.has(word));
}

/**
 * True while the question still shares a topic word with what the page was
 * showing. An empty draft is not treated as a topic change. Used on send, so
 * the indicator does not flicker while the user is still typing.
 */
export function isAiChatDraftRelated(draft: string, reference: string): boolean {
  const draftWords = topicWords(draft);
  if (draftWords.length === 0) return true;
  const referenceWords = new Set(topicWords(reference));
  return draftWords.some((word) => referenceWords.has(word));
}

/**
 * The one-line indicator above the composer. `focus` names what the question
 * is about; `detail` carries the page's currency and period when present.
 */
export function describeAiChatContext(context: AiChatContext): {
  focus: string;
  detail: string;
} {
  const focus =
    context.label ??
    context.selectedInsight ??
    context.selectedMetric ??
    (context.page ? AI_CHAT_PAGE_LABELS[context.page] : 'Trang hiện tại');

  const detail: string[] = [];
  if (context.currency) detail.push(`Đơn vị ${context.currency}`);
  if (context.dateRange) {
    detail.push(
      `Kỳ ${formatCalendarDate(context.dateRange.from)} – ${formatCalendarDate(context.dateRange.to)}`,
    );
  }

  return { focus, detail: detail.join(' · ') };
}
