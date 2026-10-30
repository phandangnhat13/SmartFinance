import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  SavingsExplanationDto,
  SavingsProgressStatus,
  SavingsScenarioExplanationDto,
  SavingsSuggestionDto,
  SavingsSuggestionsDto,
} from '@smart-finance/shared-types';
import { SAVINGS_PROGRESS_STATUS_LABELS } from '@smart-finance/shared-types';
import { Calculator, Sparkles, Target, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, ErrorAlert, Skeleton } from './ui';
import { DisclosureNote, SimulationSummary, SourceBadge } from './ai/ai-chat-shared';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';

const STATUS_TONES: Record<SavingsProgressStatus, 'emerald' | 'amber' | 'rose' | 'sky' | 'slate'> =
  {
    ON_TRACK: 'emerald',
    AT_RISK: 'amber',
    OVERDUE: 'rose',
    COMPLETED: 'sky',
    PAUSED: 'slate',
    INSUFFICIENT_DATA: 'slate',
  };

const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Độ tin cậy cao',
  medium: 'Độ tin cậy trung bình',
  low: 'Độ tin cậy thấp',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function moneyOrDash(value: string | null, currency: string): string {
  return value === null ? '—' : formatMoney(value, currency);
}

function SuggestionCard({
  suggestion,
  onReviewGoal,
}: {
  suggestion: SavingsSuggestionDto;
  onReviewGoal?: (goalId: string) => void;
}) {
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-semibold text-ink">{suggestion.title}</p>
        <Badge tone="sky">{CONFIDENCE_LABELS[suggestion.confidence]}</Badge>
      </div>
      <p className="mt-1 break-words text-sm text-ink-secondary">{suggestion.explanation}</p>
      <p className="mt-1 break-words text-sm text-ink-secondary">
        <span className="font-medium text-ink-secondary">Tác động dự kiến: </span>
        {suggestion.expectedImpact}
      </p>

      {suggestion.evidence.length > 0 ? (
        <div className="mt-2 rounded-lg bg-surface-muted p-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Bằng chứng từ dữ liệu
          </p>
          <ul className="mt-1 space-y-1 text-xs text-ink-secondary">
            {suggestion.evidence.map((evidence) => (
              <li key={`${evidence.label}:${evidence.value}`}>
                <span className="font-medium text-ink-secondary">{evidence.label}: </span>
                {evidence.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {suggestion.limitations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
          {suggestion.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestion.requiresConfirmation ? (
          <span className="text-xs text-warning-strong">
            Gợi ý này không tự áp dụng: bạn cần tự điều chỉnh và xác nhận.
          </span>
        ) : null}
        {onReviewGoal
          ? suggestion.goalIds.slice(0, 1).map((goalId) => (
              <button
                key={goalId}
                type="button"
                className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
                onClick={() => onReviewGoal(goalId)}
              >
                Xem mục tiêu
              </button>
            ))
          : null}
      </div>
    </li>
  );
}

/**
 * AI savings assistant panel (M2e §10).
 *
 * Every figure shown here comes from the server (M2c capacity/allocation, M2d
 * progress/simulations); the model only writes prose and picks evidence keys.
 * Each block is labelled with its source so a user can tell AI text from
 * calculated values. Nothing in this component can change financial data: the
 * only write path is the existing M2d adjustment dialog reached through
 * `onReviewGoal`, which requires an explicit preview + confirmation.
 */
export function SavingsAssistantPanel({
  currency,
  onReviewGoal,
}: {
  currency: string;
  onReviewGoal?: (goalId: string) => void;
}) {
  const [scenarioInput, setScenarioInput] = useState('');

  const explanation = useQuery({
    queryKey: ['ai-savings-explain', currency],
    queryFn: () => api.post<SavingsExplanationDto>('/ai/savings/explain', { currency }),
    retry: false,
    staleTime: 60_000,
  });

  const suggestions = useMutation({
    mutationFn: () => api.post<SavingsSuggestionsDto>('/ai/savings/suggestions', { currency }),
  });

  const scenario = useMutation({
    mutationFn: (message: string) =>
      api.post<SavingsScenarioExplanationDto>('/ai/savings/scenario-explanation', {
        currency,
        message,
      }),
  });

  const explainData = explanation.data;

  function submitScenario() {
    const message = scenarioInput.trim();
    if (message.length < 3) return;
    scenario.mutate(message);
  }

  return (
    <section className="card mb-6" aria-label="Trợ lý tiết kiệm AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">Trợ lý tiết kiệm AI</h2>
        </div>
        <span className="text-xs text-ink-muted">
          Chỉ giải thích và gợi ý · không tự thay đổi dữ liệu
        </span>
      </div>

      <p className="mt-1 text-xs text-ink-muted">
        Mọi con số do hệ thống tính từ giao dịch và khoản góp thực tế của bạn. AI chỉ diễn giải
        những con số đó, không tự tính lại.
      </p>

      {/* Explanation: system figures beside AI prose ---------------------- */}
      <div className="mt-4 border-t border-line pt-4" data-testid="ai-explanation">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-ink-muted" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">Kế hoạch và giải thích</h3>
          </div>
          <span className="text-xs text-ink-muted">Số liệu bên trái · lời giải thích bên phải</span>
        </div>

        {explanation.isLoading ? (
          <div className="mt-3 space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Đang chuẩn bị giải thích...</span>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : explanation.error ? (
          <div className="mt-3">
            <ErrorAlert
              message={errorMessage(explanation.error)}
              onRetry={() => void explanation.refetch()}
            />
          </div>
        ) : explainData ? (
          <>
            <div className="mt-3 grid gap-4 xl:grid-cols-5">
              <div className="min-w-0 rounded-2xl border border-line bg-surface-muted/60 p-4 xl:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-ink">Số liệu hệ thống</h4>
                  <Badge tone="slate">Hệ thống tính</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Tính từ giao dịch và khoản góp thực tế. AI không tính lại các con số này.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Stat
                    label="Khả năng tiết kiệm/tháng"
                    value={
                      explainData.facts.monthlyBudget === null
                        ? 'Chưa đủ dữ liệu'
                        : formatMoney(explainData.facts.monthlyBudget, explainData.facts.currency)
                    }
                    hint={CONFIDENCE_LABELS[explainData.facts.confidence]}
                  />
                  <Stat
                    label="Thu nhập TB/tháng"
                    value={moneyOrDash(
                      explainData.facts.averageMonthlyIncome,
                      explainData.facts.currency,
                    )}
                  />
                  <Stat
                    label="Chi tiêu TB/tháng"
                    value={moneyOrDash(
                      explainData.facts.averageMonthlyExpense,
                      explainData.facts.currency,
                    )}
                  />
                  <Stat
                    label={`Dự phòng ${explainData.facts.safetyBufferPercent}%`}
                    value={moneyOrDash(
                      explainData.facts.safetyBufferAmount,
                      explainData.facts.currency,
                    )}
                    hint={`Trên ${explainData.facts.monthsAnalyzed} tháng đã kết thúc`}
                  />
                  <Stat
                    label="Đã phân bổ tháng này"
                    value={formatMoney(
                      explainData.facts.allocatedMonthly,
                      explainData.facts.currency,
                    )}
                  />
                  <Stat
                    label="Chưa phân bổ"
                    value={moneyOrDash(
                      explainData.facts.unallocatedMonthly,
                      explainData.facts.currency,
                    )}
                  />
                </div>
              </div>

              <div className="min-w-0 rounded-2xl border border-line p-4 xl:col-span-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                  <h4 className="text-sm font-semibold text-ink">Vì sao có kế hoạch này</h4>
                  <SourceBadge source={explainData.source} />
                </div>
                <p className="mt-2 break-words whitespace-pre-line text-sm text-ink-secondary">
                  {explainData.summary}
                </p>
                <DisclosureNote disclosure={explainData.disclosure} />

                <div className="mt-3 space-y-2">
                  {explainData.sections.map((section) => (
                    <div key={section.title} className="rounded-xl border border-line p-3">
                      <p className="text-sm font-semibold text-ink">{section.title}</p>
                      <p className="mt-1 break-words whitespace-pre-line text-sm text-ink-secondary">
                        {section.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <h4 className="mt-4 text-sm font-semibold text-ink">Mục tiêu và tiến độ</h4>
            <p className="mt-1 text-xs text-ink-muted">
              Trạng thái, số còn thiếu và mức đề xuất do hệ thống tính.
            </p>
            {explainData.goals.length > 0 ? (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {explainData.goals.map((goal) => (
                  <li key={goal.goalId} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                        <Target className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                        {goal.goalName}
                      </span>
                      <Badge tone={STATUS_TONES[goal.progressStatus]}>
                        {SAVINGS_PROGRESS_STATUS_LABELS[goal.progressStatus]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{goal.statusReason}</p>
                    <p className="mt-1 break-words text-xs text-ink-secondary">
                      Còn thiếu {formatMoney(goal.remainingAmount, explainData.facts.currency)}
                      {goal.recommendedMonthlySaving === null
                        ? ' · chưa có mức đề xuất'
                        : ` · đề xuất ${formatMoney(
                            goal.recommendedMonthlySaving,
                            explainData.facts.currency,
                          )}/tháng`}
                      {goal.estimatedCompletionDate
                        ? ` · dự kiến hoàn thành ${formatDate(
                            `${goal.estimatedCompletionDate}T00:00`,
                          )}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">
                Chưa có mục tiêu nào trong {explainData.facts.currency} để giải thích.
              </p>
            )}

            {explainData.limitations.length > 0 ? (
              <details className="mt-3 text-xs text-ink-secondary">
                <summary className="cursor-pointer font-medium text-ink-secondary">
                  Giới hạn của giải thích
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {explainData.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Suggestions: generated on demand, never applied automatically ------ */}
      <div className="mt-5 border-t border-line pt-4" data-testid="ai-suggestions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-ink-muted" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">Gợi ý dành cho bạn</h3>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => suggestions.mutate()}
            disabled={suggestions.isPending}
          >
            <Wand2 className="h-4 w-4" aria-hidden />
            {suggestions.isPending ? 'Đang tạo gợi ý...' : 'Xem gợi ý'}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Gợi ý chỉ được tạo khi bạn yêu cầu và luôn dựa trên dữ liệu đã ghi nhận.
        </p>
        {suggestions.isPending ? (
          <div className="mt-2 space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Đang tạo gợi ý...</span>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}
        {suggestions.error ? (
          <div className="mt-2">
            <ErrorAlert
              message={errorMessage(suggestions.error)}
              onRetry={() => suggestions.mutate()}
            />
          </div>
        ) : null}
        {suggestions.data ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SourceBadge source={suggestions.data.source} />
              <span className="text-xs text-ink-muted">
                Mỗi gợi ý đều kèm bằng chứng và không được áp dụng tự động.
              </span>
            </div>
            <DisclosureNote disclosure={suggestions.data.disclosure} />
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {suggestions.data.suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  {...(onReviewGoal ? { onReviewGoal } : {})}
                />
              ))}
            </ul>
          </>
        ) : !suggestions.isPending ? (
          <p className="mt-2 rounded-xl border border-dashed border-line p-3 text-xs text-ink-muted">
            Chưa có gợi ý nào. Bấm “Xem gợi ý” khi bạn muốn phân tích dữ liệu hiện tại.
          </p>
        ) : null}
      </div>

      {/* Scenario --------------------------------------------------------- */}
      <div className="mt-5 min-w-0 rounded-2xl border border-line p-4" data-testid="ai-scenario">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Thử một kịch bản</h3>
          <Badge tone="slate">Mô phỏng chỉ đọc</Badge>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Ví dụ: “Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?”. Hệ thống mô phỏng
          trước, sau đó AI giải thích kết quả.
        </p>
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitScenario();
          }}
        >
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink-secondary">
            <span className="sr-only">Kịch bản muốn mô phỏng</span>
            <input
              className="input"
              maxLength={500}
              placeholder="Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?"
              value={scenarioInput}
              onChange={(event) => setScenarioInput(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn-secondary"
            disabled={scenario.isPending || scenarioInput.trim().length < 3}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {scenario.isPending ? 'Đang mô phỏng...' : 'Mô phỏng'}
          </button>
        </form>

        {scenario.isPending ? (
          <p className="mt-2 text-xs text-ink-muted" role="status" aria-live="polite">
            Đang mô phỏng trên máy chủ...
          </p>
        ) : null}

        {scenario.error ? (
          <div className="mt-2">
            <ErrorAlert message={errorMessage(scenario.error)} />
          </div>
        ) : null}

        {scenario.data ? (
          <div
            className="mt-3 rounded-xl border border-line bg-surface-muted/40 p-3"
            data-testid="ai-scenario-result"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Kết quả mô phỏng · hệ thống tính
            </p>
            {scenario.data.status === 'simulated' && scenario.data.simulation ? (
              <>
                <SimulationSummary simulation={scenario.data.simulation} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SourceBadge source={scenario.data.source} />
                  <span className="text-xs text-ink-muted">
                    Số liệu ở trên do hệ thống tính; phần giải thích do nguồn ghi trên nhãn viết.
                  </span>
                </div>
                <p className="mt-2 break-words whitespace-pre-line text-sm text-ink-secondary">
                  {scenario.data.explanation}
                </p>
                <DisclosureNote disclosure={scenario.data.disclosure} />
                {scenario.data.requiresConfirmation ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-warning-strong">
                      Đây là mô phỏng, chưa có thay đổi nào được lưu. Muốn áp dụng, bạn phải mở mục
                      tiêu, xem trước thay đổi và xác nhận.
                    </p>
                    {onReviewGoal && scenario.data.interpretation.goalId ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          const goalId = scenario.data?.interpretation.goalId;
                          if (goalId) onReviewGoal(goalId);
                        }}
                      >
                        Xem và xác nhận điều chỉnh
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <div role="status">
                <p className="break-words whitespace-pre-line text-sm text-ink-secondary">
                  {scenario.data.explanation}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Mình chưa hiểu đủ kịch bản nên chưa mô phỏng gì. Bạn nói rõ mục tiêu và số tiền
                  hoặc ngày mong muốn nhé.
                </p>
              </div>
            )}
            {scenario.data.limitations.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                {scenario.data.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
