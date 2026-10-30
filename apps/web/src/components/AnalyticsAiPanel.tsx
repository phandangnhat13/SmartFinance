import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AiDisclosureDto,
  AiEvidenceDto,
  AnalyticsAiChatReplyDto,
  AnalyticsAiChatIntent,
  AnalyticsAiExplanationDto,
  AnalyticsAiFactsDto,
  AnalyticsAiRecommendationsDto,
  AnalyticsAiSummaryDto,
  ForecastHorizon,
} from '@smart-finance/shared-types';
import {
  ANALYTICS_AI_SUGGESTED_QUESTIONS,
  HEALTH_CLASSIFICATION_LABELS,
} from '@smart-finance/shared-types';
import { Bot, Calculator, Send, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { Badge, cn, ErrorAlert, Skeleton } from './ui';

const MAX_QUESTION_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 1_000;

const HORIZON_LABELS: Record<ForecastHorizon, string> = {
  current_month: 'phần còn lại của tháng này',
  '1m': 'tháng tới',
  '3m': '3 tháng tới',
  '6m': '6 tháng tới',
};

const INTENT_LABELS: Record<AnalyticsAiChatIntent, string> = {
  SUMMARY: 'Tóm tắt',
  EXPLAIN: 'Giải thích',
  HEALTH: 'Sức khỏe tài chính',
  FORECAST: 'Dự báo',
  BUDGET: 'Ngân sách',
  CATEGORY: 'Danh mục',
  SAVINGS: 'Tiết kiệm',
  UNSUPPORTED: 'Không hỗ trợ thay đổi dữ liệu',
  UNCLEAR: 'Cần làm rõ',
};

const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Độ tin cậy cao',
  medium: 'Độ tin cậy trung bình',
  low: 'Độ tin cậy thấp',
};

/**
 * Tells the user who wrote a piece of prose. Official figures always carry
 * "Hệ thống tính" inside the facts block; model prose carries "AI giải thích"
 * and rule-based prose carries "Không dùng AI", so a fallback can never be
 * mistaken for a successful model answer.
 */
function SourceBadge({ source }: { source: 'AI' | 'FALLBACK' }) {
  return source === 'AI' ? (
    <Badge tone="sky">AI giải thích</Badge>
  ) : (
    <Badge tone="slate">Không dùng AI</Badge>
  );
}

function DisclosureNote({ disclosure }: { disclosure: AiDisclosureDto }) {
  return (
    <p
      className={cn(
        'mt-2 rounded-lg border p-2 text-xs',
        disclosure.usedModel
          ? 'border-brand/30 bg-brand-soft text-ink-secondary'
          : 'border-line bg-surface-muted text-ink-secondary',
      )}
    >
      {disclosure.notice}
    </p>
  );
}

/** Backend-built evidence, shown as chips next to the prose that cites it. */
function EvidenceChips({
  evidence,
  label = 'Bằng chứng từ hệ thống',
}: {
  evidence: AiEvidenceDto[];
  label?: string;
}) {
  if (evidence.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-1" aria-label={label}>
        {evidence.map((item) => (
          <li
            key={`${item.label}:${item.value}`}
            className="break-words rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-secondary ring-1 ring-inset ring-line"
          >
            <span className="font-medium text-ink">{item.label}: </span>
            {item.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-muted p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-ink">
        {value}
        {hint ? (
          <span className="mt-0.5 block text-xs font-normal text-ink-muted">{hint}</span>
        ) : null}
      </dd>
    </div>
  );
}

function savingsRateValue(value: number | null): string {
  return value === null ? 'Chưa tính được' : `${value.toFixed(1)}%`;
}

function healthValue(facts: AnalyticsAiFactsDto): string {
  if (facts.healthStatus === 'scored' && facts.healthScore !== null) {
    return `${facts.healthScore}/100`;
  }
  return 'Chưa đủ dữ liệu';
}

function healthClassLabel(facts: AnalyticsAiFactsDto): string | null {
  if (facts.healthStatus !== 'scored' || facts.healthClassification === null) return null;
  return HEALTH_CLASSIFICATION_LABELS[facts.healthClassification];
}

/**
 * Official figures. Everything here is computed by the analytics, forecast,
 * health and savings services; none of it is ever taken from AI text. The AI
 * prose is rendered in a separate block so it can never replace these values.
 */
function FactsGrid({ facts }: { facts: AnalyticsAiFactsDto }) {
  return (
    <div data-testid="ai-analytics-facts">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator className="h-4 w-4 text-ink-muted" aria-hidden />
        <h3 className="text-sm font-semibold text-ink">Số liệu chính thức</h3>
        <Badge tone="slate">Hệ thống tính</Badge>
        <span className="text-xs text-ink-muted">
          {facts.periodLabel} ({facts.periodFrom} → {facts.periodTo})
        </span>
      </div>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Thu nhập" value={formatMoney(facts.income, facts.currency)} />
        <Fact label="Chi tiêu" value={formatMoney(facts.expense, facts.currency)} />
        <Fact label="Dòng tiền ròng" value={formatMoney(facts.net, facts.currency)} />
        <Fact label="Tỷ lệ tiết kiệm" value={savingsRateValue(facts.savingsRate)} />
        <Fact
          label="Số giao dịch"
          value={facts.transactionCount.toLocaleString('vi-VN')}
          hint={facts.hasTransactions ? undefined : 'Kỳ này chưa có giao dịch thu/chi.'}
        />
        {facts.budgetCount !== null ? (
          <Fact
            label="Ngân sách tháng"
            value={`${facts.budgetCount} ngân sách`}
            hint={`${facts.budgetsExceeded ?? 0} vượt hạn mức · ${facts.budgetsWarning ?? 0} cảnh báo`}
          />
        ) : null}
        {facts.forecastStatus !== null ? (
          <Fact
            label={`Dự báo dòng tiền ròng (${facts.forecastHorizon ? HORIZON_LABELS[facts.forecastHorizon] : 'ước tính'})`}
            value={
              facts.forecastStatus === 'ok' && facts.forecastNet !== null
                ? formatMoney(facts.forecastNet, facts.currency)
                : 'Chưa đủ dữ liệu'
            }
            hint="Ước tính từ mô hình dự báo; không phải số đã ghi nhận."
          />
        ) : null}
        {facts.healthStatus !== null ? (
          <Fact
            label="Điểm sức khỏe tài chính"
            value={healthValue(facts)}
            hint={healthClassLabel(facts) ?? undefined}
          />
        ) : null}
        {facts.savingsCapacity !== null ? (
          <Fact label="Khả năng tiết kiệm/tháng (ước tính)" value={facts.savingsCapacity} />
        ) : null}
      </dl>
      {facts.topCategories.length > 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          Danh mục chi nhiều nhất:{' '}
          {facts.topCategories
            .map((category) => `${category.name} ${category.sharePercent.toFixed(1)}%`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

function Limitations({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-ink-secondary">
      <summary className="cursor-pointer font-medium text-ink-secondary">
        Giới hạn &amp; lưu ý
      </summary>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/** A 429 from the analyst gets a clear retry hint instead of a raw error. */
function throttleMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = error.retryAfterSeconds;
    return seconds
      ? `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${seconds} giây.`
      : 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.';
  }
  return errorMessage(error);
}

/**
 * AI financial analyst panel (M3e).
 *
 * Read-only by construction: the analyst API exposes summary/explain/
 * recommendations/chat and no write route, and every fact shown here comes from
 * the deterministic analytics services. The model only writes prose and cites a
 * closed set of backend-built evidence. Chat messages live in this component's
 * state for the session only and are never sent back to the server.
 */
export function AnalyticsAiPanel({ currency }: { currency: string }) {
  const [explainInput, setExplainInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatEntry[]>([]);

  const summary = useQuery({
    queryKey: ['ai-analytics-summary', currency],
    queryFn: () => api.post<AnalyticsAiSummaryDto>('/ai/analytics/summary', { currency }),
    retry: false,
    staleTime: 60_000,
  });

  const explanation = useMutation({
    mutationFn: (question: string | null) =>
      api.post<AnalyticsAiExplanationDto>('/ai/analytics/explain', {
        currency,
        ...(question ? { question } : {}),
      }),
  });

  const recommendations = useMutation({
    mutationFn: () =>
      api.post<AnalyticsAiRecommendationsDto>('/ai/analytics/recommendations', { currency }),
  });

  const chat = useMutation({
    mutationFn: (message: string) =>
      api.post<AnalyticsAiChatReplyDto>('/ai/analytics/chat', { currency, message }),
    onSuccess: (reply) => {
      setMessages((current) => [...current, { role: 'assistant', reply }]);
    },
  });

  function submitExplanation() {
    const question = explainInput.trim();
    if (question.length > 0 && question.length < 3) return;
    explanation.mutate(question.length > 0 ? question : null);
  }

  function submitChat() {
    const message = chatInput.trim();
    if (!message || chat.isPending) return;
    // No history field: each question is answered on its own.
    chat.mutate(message);
    setMessages((current) => [...current, { role: 'user', content: message }]);
    setChatInput('');
  }

  const summaryData = summary.data;

  return (
    <section className="card border border-line bg-surface" aria-label="Trợ lý phân tích AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">Trợ lý phân tích AI</h2>
        </div>
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Chỉ đọc · không tự thay đổi dữ liệu
        </span>
      </div>

      <p className="mt-1 text-xs text-ink-muted">
        Mọi con số do hệ thống tính từ giao dịch, ngân sách và mục tiêu đã ghi nhận. AI chỉ diễn
        giải những con số đó và trích dẫn bằng chứng; AI không tự tính lại và không thể tạo, sửa hay
        xóa dữ liệu.
      </p>

      {/* Official figures and summary ------------------------------------ */}
      <div className="mt-4 border-t border-line pt-4" data-testid="ai-analytics-summary">
        {summary.isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Đang chuẩn bị tóm tắt...</span>
            <Skeleton className="h-4 w-1/3" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <Skeleton key={item} className="h-16 w-full" />
              ))}
            </div>
          </div>
        ) : summary.error ? (
          <ErrorAlert
            message={throttleMessage(summary.error)}
            onRetry={() => void summary.refetch()}
          />
        ) : summaryData ? (
          <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
            <div className="min-w-0 rounded-2xl border border-line bg-surface-muted/40 p-4">
              <FactsGrid facts={summaryData.facts} />
            </div>

            <div
              className="min-w-0 rounded-2xl border border-line p-4"
              data-testid="ai-analytics-summary-text"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">Diễn giải của trợ lý</h3>
                <SourceBadge source={summaryData.source} />
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Phần chữ này không thay thế số liệu chính thức bên cạnh.
              </p>
              <p className="mt-2 break-words whitespace-pre-line text-sm text-ink-secondary">
                {summaryData.summary}
              </p>
              <ul className="mt-2 space-y-2">
                {summaryData.highlights.map((highlight) => (
                  <li key={highlight.title} className="rounded-xl border border-line p-3">
                    <p className="break-words text-sm font-semibold text-ink">{highlight.title}</p>
                    <p className="mt-1 break-words whitespace-pre-line text-sm text-ink-secondary">
                      {highlight.body}
                    </p>
                    <EvidenceChips evidence={highlight.evidence} />
                  </li>
                ))}
              </ul>
              <EvidenceChips evidence={summaryData.evidence} label="Bằng chứng cho phần tóm tắt" />
              <DisclosureNote disclosure={summaryData.disclosure} />
              <p className="mt-1 text-xs text-ink-muted">
                Tạo lúc {formatDateTime(summaryData.generatedAt, summaryData.timezone)} ·{' '}
                {summaryData.currency} · múi giờ {summaryData.timezone}
              </p>
              <Limitations limitations={summaryData.limitations} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Explanation ------------------------------------------------------ */}
      <div className="mt-4 border-t border-line pt-4" data-testid="ai-analytics-explain">
        <h3 className="text-sm font-semibold text-ink">Vì sao các chỉ số này như vậy?</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Ví dụ: “Vì sao chi tiêu tháng này tăng?”, “Ngân sách nào đang vượt hạn mức?”. Hệ thống
          tính các chỉ số trước, sau đó AI giải thích cách chúng được tạo ra.
        </p>
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitExplanation();
          }}
        >
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink-secondary">
            <span className="sr-only">Câu hỏi cần giải thích</span>
            <input
              className="input"
              maxLength={MAX_QUESTION_LENGTH}
              placeholder="Vì sao chi tiêu tháng này tăng?"
              value={explainInput}
              onChange={(event) => setExplainInput(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-secondary" disabled={explanation.isPending}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {explanation.isPending ? 'Đang giải thích...' : 'Giải thích'}
          </button>
        </form>

        {explanation.isPending ? (
          <p className="mt-2 text-xs text-ink-muted" role="status" aria-live="polite">
            Đang giải thích...
          </p>
        ) : null}

        {explanation.error ? (
          <div className="mt-2">
            <ErrorAlert
              message={throttleMessage(explanation.error)}
              onRetry={() => explanation.mutate(explainInput.trim() || null)}
            />
          </div>
        ) : null}

        {explanation.data ? (
          <div className="mt-3 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={explanation.data.source} />
              <span className="text-xs text-ink-muted">
                Số liệu vẫn là số do hệ thống tính; phần chữ do nguồn ghi trên nhãn viết.
              </span>
            </div>
            <p className="mt-2 break-words whitespace-pre-line text-sm text-ink-secondary">
              {explanation.data.summary}
            </p>
            <div className="mt-2 space-y-2">
              {explanation.data.sections.map((section) => (
                <div key={section.title} className="rounded-lg bg-surface-muted p-3">
                  <p className="break-words text-sm font-semibold text-ink">{section.title}</p>
                  <p className="mt-1 break-words whitespace-pre-line text-sm text-ink-secondary">
                    {section.body}
                  </p>
                </div>
              ))}
            </div>
            <EvidenceChips evidence={explanation.data.evidence} />
            <DisclosureNote disclosure={explanation.data.disclosure} />
            <Limitations limitations={explanation.data.limitations} />
          </div>
        ) : null}
      </div>

      {/* Recommendations and chat are separate, clearly titled regions ----- */}
      <div className="mt-4 grid gap-4 border-t border-line pt-4 xl:grid-cols-2 xl:items-start">
        <div
          className="min-w-0 rounded-2xl border border-line p-4"
          data-testid="ai-analytics-recommendations"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-ink-muted" aria-hidden />
              <h3 className="text-sm font-semibold text-ink">Gợi ý dành cho bạn</h3>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => recommendations.mutate()}
              disabled={recommendations.isPending}
            >
              <Wand2 className="h-4 w-4" aria-hidden />
              {recommendations.isPending ? 'Đang tạo gợi ý...' : 'Xem gợi ý'}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Gợi ý chỉ được tạo khi bạn yêu cầu, dựa trên ngân sách, dự báo, điểm sức khỏe và khả
            năng tiết kiệm đã tính. Đây là gợi ý, không phải thay đổi đã lưu.
          </p>

          {recommendations.isPending ? (
            <div className="mt-2 space-y-2" role="status" aria-live="polite">
              <span className="sr-only">Đang tạo gợi ý...</span>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : null}

          {recommendations.error ? (
            <div className="mt-2">
              <ErrorAlert
                message={throttleMessage(recommendations.error)}
                onRetry={() => recommendations.mutate()}
              />
            </div>
          ) : null}

          {recommendations.data ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SourceBadge source={recommendations.data.source} />
                <span className="text-xs text-ink-muted">
                  Mỗi gợi ý đều kèm bằng chứng từ hệ thống và không được áp dụng tự động.
                </span>
              </div>
              <DisclosureNote disclosure={recommendations.data.disclosure} />
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {recommendations.data.recommendations.map((item) => (
                  <li key={item.id} className="p-4" data-testid="ai-analytics-recommendation">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 break-words font-semibold text-ink">{item.title}</p>
                      <Badge tone="sky">{CONFIDENCE_LABELS[item.confidence]}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-ink-secondary">{item.detail}</p>
                    <p className="mt-1 break-words text-sm text-ink-secondary">
                      <span className="font-medium text-ink-secondary">
                        Tác động dự kiến (ước tính):{' '}
                      </span>
                      {item.expectedImpact}
                    </p>
                    <EvidenceChips evidence={item.evidence} />
                    {item.limitations.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                        {item.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    ) : null}
                    {item.requiresConfirmation ? (
                      <p className="mt-2 text-xs text-warning-strong">
                        Gợi ý này không tự áp dụng: bạn cần tự điều chỉnh và xác nhận trong màn hình
                        tương ứng.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Limitations limitations={recommendations.data.limitations} />
            </>
          ) : null}
        </div>

        <div className="min-w-0 rounded-2xl border border-line p-4" data-testid="ai-analytics-chat">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-ink-muted" aria-hidden />
              <h3 className="text-sm font-semibold text-ink">Hỏi trợ lý phân tích</h3>
            </div>
            <Badge tone="slate">Chỉ trong phiên này</Badge>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Trợ lý không thể tạo, sửa hay xóa giao dịch, ngân sách, mục tiêu, khoản góp hay số dư.
            Mỗi câu hỏi được trả lời độc lập: lịch sử trò chuyện chỉ nằm trong phiên này và không
            được gửi kèm.
          </p>

          {messages.length === 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {ANALYTICS_AI_SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="rounded-full border border-line px-3 py-1 text-xs text-ink-secondary hover:bg-surface-muted"
                  onClick={() => setChatInput(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          ) : (
            <ol
              className="mt-3 space-y-2"
              aria-label="Hội thoại với trợ lý phân tích"
              data-testid="ai-chat-log"
            >
              {messages.map((entry, index) =>
                entry.role === 'user' ? (
                  <li key={index} className="flex min-w-0 flex-col items-end gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      Bạn hỏi
                    </span>
                    <p className="max-w-[85%] break-words whitespace-pre-line rounded-xl rounded-tr-sm bg-brand px-3 py-2 text-sm text-white">
                      {entry.content}
                    </p>
                  </li>
                ) : (
                  <li key={index} className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      Trợ lý trả lời
                    </span>
                    <div
                      className="min-w-0 rounded-xl rounded-tl-sm border border-line p-3"
                      data-testid="ai-analytics-chat-reply"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <SourceBadge source={entry.reply.source} />
                        <Badge tone="slate">{INTENT_LABELS[entry.reply.intent]}</Badge>
                      </div>
                      <p className="mt-1 break-words whitespace-pre-line text-sm text-ink-secondary">
                        {entry.reply.reply}
                      </p>
                      <EvidenceChips evidence={entry.reply.evidence} />
                      {entry.reply.clarification ? (
                        <p className="mt-2 break-words rounded-lg border border-warning-border bg-warning-soft p-2 text-xs text-warning-strong">
                          {entry.reply.clarification}
                        </p>
                      ) : null}
                      <DisclosureNote disclosure={entry.reply.disclosure} />
                    </div>
                  </li>
                ),
              )}
              {chat.isPending ? (
                <li className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    Trợ lý trả lời
                  </span>
                  <p
                    className="rounded-xl border border-dashed border-line p-3 text-sm text-ink-muted"
                    role="status"
                    aria-live="polite"
                  >
                    Đang soạn câu trả lời...
                  </p>
                </li>
              ) : null}
            </ol>
          )}

          {chat.error ? (
            <div className="mt-2">
              <ErrorAlert message={throttleMessage(chat.error)} />
            </div>
          ) : null}

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitChat();
            }}
          >
            <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink-secondary">
              <span className="sr-only">Câu hỏi cho trợ lý phân tích</span>
              <input
                className="input"
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Vì sao dòng tiền ròng của tôi giảm?"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn-secondary"
              disabled={chat.isPending || chatInput.trim().length === 0}
            >
              <Send className="h-4 w-4" aria-hidden />
              {chat.isPending ? 'Đang trả lời...' : 'Gửi'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

type ChatEntry =
  { role: 'user'; content: string } | { role: 'assistant'; reply: AnalyticsAiChatReplyDto };
