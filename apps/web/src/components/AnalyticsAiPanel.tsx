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
import { Bot, Send, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { Badge, ErrorAlert } from './ui';

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
 * Tells the user who wrote a piece of text. Official figures always carry
 * "Hệ thống tính"; model prose carries "AI giải thích". The model never
 * produces a value, so these two labels are never applied to the same block.
 */
function SourceBadge({ source }: { source: 'AI' | 'FALLBACK' }) {
  return source === 'AI' ? (
    <Badge tone="sky">AI giải thích</Badge>
  ) : (
    <Badge tone="slate">Hệ thống tính</Badge>
  );
}

function DisclosureNote({ disclosure }: { disclosure: AiDisclosureDto }) {
  return (
    <p
      className={`mt-2 rounded-lg p-2 text-xs ${
        disclosure.usedModel
          ? 'border border-sky-200 bg-sky-50 text-sky-900'
          : 'border border-slate-200 bg-slate-50 text-slate-600'
      }`}
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
    <ul className="mt-2 flex flex-wrap gap-1" aria-label={label}>
      {evidence.map((item) => (
        <li
          key={`${item.label}:${item.value}`}
          className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200"
        >
          <span className="font-medium text-slate-700">{item.label}: </span>
          {item.value}
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900">
        {value}
        {hint ? (
          <span className="mt-0.5 block text-xs font-normal text-slate-500">{hint}</span>
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
        <h3 className="text-sm font-semibold text-slate-900">Số liệu chính thức</h3>
        <Badge tone="slate">Hệ thống tính</Badge>
        <span className="text-xs text-slate-500">
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
        <p className="mt-2 text-xs text-slate-500">
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
    <details className="mt-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">Giới hạn &amp; lưu ý</summary>
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
    <section className="card" aria-label="Trợ lý phân tích AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-sky-600" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900">Trợ lý phân tích AI</h2>
        </div>
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Chỉ đọc · không tự thay đổi dữ liệu
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Mọi con số do hệ thống tính từ giao dịch, ngân sách và mục tiêu đã ghi nhận. AI chỉ diễn
        giải những con số đó và trích dẫn bằng chứng; AI không tự tính lại và không thể tạo, sửa hay
        xóa dữ liệu.
      </p>

      {/* Official figures and summary ------------------------------------ */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-analytics-summary">
        {summary.isLoading ? (
          <p className="text-sm text-slate-500">Đang chuẩn bị tóm tắt...</p>
        ) : summary.error ? (
          <ErrorAlert
            message={throttleMessage(summary.error)}
            onRetry={() => void summary.refetch()}
          />
        ) : summaryData ? (
          <>
            <FactsGrid facts={summaryData.facts} />

            <div className="mt-4" data-testid="ai-analytics-summary-text">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Diễn giải của trợ lý</h3>
                <SourceBadge source={summaryData.source} />
                <span className="text-xs text-slate-500">
                  Phần chữ này không thay thế số liệu chính thức ở trên.
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{summaryData.summary}</p>
              <ul className="mt-2 space-y-2">
                {summaryData.highlights.map((highlight) => (
                  <li key={highlight.title} className="rounded-xl border border-slate-100 p-3">
                    <p className="text-sm font-semibold text-slate-900">{highlight.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{highlight.body}</p>
                    <EvidenceChips evidence={highlight.evidence} />
                  </li>
                ))}
              </ul>
              <EvidenceChips evidence={summaryData.evidence} label="Bằng chứng cho phần tóm tắt" />
              <DisclosureNote disclosure={summaryData.disclosure} />
              <p className="mt-1 text-xs text-slate-500">
                Tạo lúc {formatDateTime(summaryData.generatedAt, summaryData.timezone)} ·{' '}
                {summaryData.currency} · múi giờ {summaryData.timezone}
              </p>
              <Limitations limitations={summaryData.limitations} />
            </div>
          </>
        ) : null}
      </div>

      {/* Explanation ------------------------------------------------------ */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-analytics-explain">
        <h3 className="text-sm font-semibold text-slate-900">Vì sao các chỉ số này như vậy?</h3>
        <p className="mt-1 text-xs text-slate-500">
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
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-slate-600">
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

        {explanation.error ? (
          <div className="mt-2">
            <ErrorAlert
              message={throttleMessage(explanation.error)}
              onRetry={() => explanation.mutate(explainInput.trim() || null)}
            />
          </div>
        ) : null}

        {explanation.data ? (
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={explanation.data.source} />
              <span className="text-xs text-slate-500">
                Số liệu vẫn là số do hệ thống tính; phần chữ do nguồn ghi trên nhãn viết.
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{explanation.data.summary}</p>
            <div className="mt-2 space-y-2">
              {explanation.data.sections.map((section) => (
                <div key={section.title} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{section.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{section.body}</p>
                </div>
              ))}
            </div>
            <EvidenceChips evidence={explanation.data.evidence} />
            <DisclosureNote disclosure={explanation.data.disclosure} />
            <Limitations limitations={explanation.data.limitations} />
          </div>
        ) : null}
      </div>

      {/* Recommendations -------------------------------------------------- */}
      <div
        className="mt-4 border-t border-slate-100 pt-4"
        data-testid="ai-analytics-recommendations"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Gợi ý dành cho bạn</h3>
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
        <p className="mt-1 text-xs text-slate-500">
          Gợi ý chỉ được tạo khi bạn yêu cầu, dựa trên ngân sách, dự báo, điểm sức khỏe và khả năng
          tiết kiệm đã tính. Đây là gợi ý, không phải thay đổi đã lưu.
        </p>

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
              <span className="text-xs text-slate-500">
                Mỗi gợi ý đều kèm bằng chứng từ hệ thống và không được áp dụng tự động.
              </span>
            </div>
            <DisclosureNote disclosure={recommendations.data.disclosure} />
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
              {recommendations.data.recommendations.map((item) => (
                <li key={item.id} className="p-4" data-testid="ai-analytics-recommendation">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <Badge tone="sky">{CONFIDENCE_LABELS[item.confidence]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{item.detail}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">
                      Tác động dự kiến (ước tính):{' '}
                    </span>
                    {item.expectedImpact}
                  </p>
                  <EvidenceChips evidence={item.evidence} />
                  {item.limitations.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                      {item.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.requiresConfirmation ? (
                    <p className="mt-2 text-xs text-amber-800">
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

      {/* Chat ------------------------------------------------------------- */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-analytics-chat">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-slate-500" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-900">Hỏi trợ lý phân tích</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Trợ lý không thể tạo, sửa hay xóa giao dịch, ngân sách, mục tiêu, khoản góp hay số dư. Mỗi
          câu hỏi được trả lời độc lập: lịch sử trò chuyện chỉ nằm trong phiên này và không được gửi
          kèm.
        </p>

        {messages.length === 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {ANALYTICS_AI_SUGGESTED_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
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
                <li key={index} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-line rounded-xl bg-sky-600 px-3 py-2 text-sm text-white">
                    {entry.content}
                  </p>
                </li>
              ) : (
                <li
                  key={index}
                  className="rounded-xl border border-slate-200 p-3"
                  data-testid="ai-analytics-chat-reply"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge source={entry.reply.source} />
                    <Badge tone="slate">{INTENT_LABELS[entry.reply.intent]}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    {entry.reply.reply}
                  </p>
                  <EvidenceChips evidence={entry.reply.evidence} />
                  {entry.reply.clarification ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                      {entry.reply.clarification}
                    </p>
                  ) : null}
                  <DisclosureNote disclosure={entry.reply.disclosure} />
                </li>
              ),
            )}
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
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-slate-600">
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
    </section>
  );
}

type ChatEntry =
  { role: 'user'; content: string } | { role: 'assistant'; reply: AnalyticsAiChatReplyDto };
