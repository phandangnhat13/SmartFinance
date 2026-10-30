import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AiDisclosureDto,
  SavingsChatMessageDto,
  SavingsChatReplyDto,
  SavingsExplanationDto,
  SavingsProgressStatus,
  SavingsScenarioExplanationDto,
  SavingsSimulationDto,
  SavingsSuggestionDto,
  SavingsSuggestionsDto,
  SimulationScenario,
} from '@smart-finance/shared-types';
import {
  SAVINGS_CHAT_SUGGESTED_QUESTIONS,
  SAVINGS_PROGRESS_STATUS_LABELS,
  SIMULATION_FEASIBILITY_LABELS,
} from '@smart-finance/shared-types';
import { Bot, Send, Sparkles, Target, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, ErrorAlert } from './ui';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_HISTORY = 10;

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

const SCENARIO_LABELS: Record<SimulationScenario, string> = {
  MONTHLY_AMOUNT: 'Mức góp mỗi tháng',
  DEADLINE: 'Ngày đích',
  TARGET_AMOUNT: 'Số tiền mục tiêu',
  MULTI_GOAL_BUDGET: 'Ngân sách cho nhiều mục tiêu',
};

/** Says who wrote a piece of text: the model or the deterministic rules. */
function SourceBadge({ source }: { source: 'AI' | 'FALLBACK' }) {
  return source === 'AI' ? (
    <Badge tone="sky">AI viết</Badge>
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function moneyOrDash(value: string | null, currency: string): string {
  return value === null ? '—' : formatMoney(value, currency);
}

function deadlineLabel(value: boolean | null): string {
  if (value === null) return '—';
  return value ? 'Có' : 'Không';
}

/** Compact, read-only view of a deterministic M2d simulation. */
function SimulationSummary({ simulation }: { simulation: SavingsSimulationDto }) {
  if (simulation.scenario === 'MULTI_GOAL_BUDGET') {
    return (
      <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {SCENARIO_LABELS[simulation.scenario]}
          </p>
          <Badge tone="amber">Giả định – chưa áp dụng</Badge>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Stat label="Ngân sách" value={formatMoney(simulation.budget, simulation.currency)} />
          <Stat
            label="Đã phân bổ"
            value={formatMoney(simulation.simulated.allocatedMonthly, simulation.currency)}
          />
          <Stat
            label="Còn lại"
            value={moneyOrDash(simulation.simulated.unallocatedMonthly, simulation.currency)}
          />
        </div>
        {simulation.differences.length > 0 ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {simulation.differences.map((difference) => (
              <li
                key={difference.goalId}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5"
              >
                <span className="text-slate-600">{difference.goalName}</span>
                <span className="text-slate-700">
                  {moneyOrDash(difference.baselineMonthlySaving, simulation.currency)} →{' '}
                  <span className="font-semibold text-slate-900">
                    {moneyOrDash(difference.simulatedMonthlySaving, simulation.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {simulation.simulated.infeasibleGoalIds.length > 0 ? (
          <p className="mt-2 text-xs text-amber-800">
            Ngân sách này không đủ cho {simulation.simulated.infeasibleGoalIds.length} mục tiêu.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {SCENARIO_LABELS[simulation.scenario]} · {simulation.goalName}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone="amber">Giả định – chưa áp dụng</Badge>
          <Badge
            tone={
              simulation.feasibility === 'FEASIBLE'
                ? 'emerald'
                : simulation.feasibility === 'NOT_FEASIBLE'
                  ? 'rose'
                  : 'slate'
            }
          >
            {SIMULATION_FEASIBILITY_LABELS[simulation.feasibility]}
          </Badge>
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">So sánh kế hoạch hiện tại và kế hoạch giả định</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-1 pr-3 text-left font-medium">
                Chỉ số
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                Hiện tại
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Giả định
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-600">
                Mức góp mỗi tháng
              </th>
              <td className="py-1.5 pr-3 text-right text-slate-700">
                {moneyOrDash(simulation.current.monthlySaving, simulation.currency)}
              </td>
              <td className="py-1.5 text-right font-semibold text-slate-900">
                {moneyOrDash(simulation.simulated.monthlySaving, simulation.currency)}
              </td>
            </tr>
            <tr className="border-t border-slate-100">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-600">
                Cần góp mỗi tháng
              </th>
              <td className="py-1.5 pr-3 text-right text-slate-700">
                {moneyOrDash(simulation.current.requiredMonthlySaving, simulation.currency)}
              </td>
              <td className="py-1.5 text-right font-semibold text-slate-900">
                {moneyOrDash(simulation.simulated.requiredMonthlySaving, simulation.currency)}
              </td>
            </tr>
            <tr className="border-t border-slate-100">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-600">
                Dự kiến hoàn thành
              </th>
              <td className="py-1.5 pr-3 text-right text-slate-700">
                {simulation.current.estimatedCompletionDate
                  ? formatDate(`${simulation.current.estimatedCompletionDate}T00:00`)
                  : '—'}
              </td>
              <td className="py-1.5 text-right font-semibold text-slate-900">
                {simulation.simulated.estimatedCompletionDate
                  ? formatDate(`${simulation.simulated.estimatedCompletionDate}T00:00`)
                  : '—'}
              </td>
            </tr>
            <tr className="border-t border-slate-100">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-600">
                Đúng hạn
              </th>
              <td className="py-1.5 pr-3 text-right text-slate-700">
                {deadlineLabel(simulation.current.deadlineMet)}
              </td>
              <td className="py-1.5 text-right font-semibold text-slate-900">
                {deadlineLabel(simulation.simulated.deadlineMet)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-600">{simulation.feasibilityReason}</p>
    </div>
  );
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
        <p className="font-semibold text-slate-900">{suggestion.title}</p>
        <Badge tone="sky">{CONFIDENCE_LABELS[suggestion.confidence]}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-700">{suggestion.explanation}</p>
      <p className="mt-1 text-sm text-slate-600">
        <span className="font-medium text-slate-700">Tác động dự kiến: </span>
        {suggestion.expectedImpact}
      </p>

      {suggestion.evidence.length > 0 ? (
        <div className="mt-2 rounded-lg bg-slate-50 p-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Bằng chứng từ dữ liệu
          </p>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {suggestion.evidence.map((evidence) => (
              <li key={`${evidence.label}:${evidence.value}`}>
                <span className="font-medium text-slate-700">{evidence.label}: </span>
                {evidence.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {suggestion.limitations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
          {suggestion.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestion.requiresConfirmation ? (
          <span className="text-xs text-amber-800">
            Gợi ý này không tự áp dụng: bạn cần tự điều chỉnh và xác nhận.
          </span>
        ) : null}
        {onReviewGoal
          ? suggestion.goalIds.slice(0, 1).map((goalId) => (
              <button
                key={goalId}
                type="button"
                className="rounded-lg px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
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
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatEntry[]>([]);

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

  const chat = useMutation({
    mutationFn: (payload: { message: string; history: SavingsChatMessageDto[] }) =>
      api.post<SavingsChatReplyDto>('/ai/savings/chat', { currency, ...payload }),
    onSuccess: (reply) => {
      setMessages((current) => [...current, { role: 'assistant', reply }]);
    },
  });

  const explainData = explanation.data;

  function submitScenario() {
    const message = scenarioInput.trim();
    if (message.length < 3) return;
    scenario.mutate(message);
  }

  function submitChat() {
    const message = chatInput.trim();
    if (!message || chat.isPending) return;
    const history: SavingsChatMessageDto[] = messages
      .slice(-MAX_HISTORY)
      .map((entry) =>
        entry.role === 'user'
          ? { role: 'user', content: entry.content }
          : { role: 'assistant', content: entry.reply.reply },
      );
    chat.mutate({ message, history });
    setMessages((current) => [...current, { role: 'user', content: message }]);
    setChatInput('');
  }

  return (
    <section className="card mb-6" aria-label="Trợ lý tiết kiệm AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-sky-600" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900">Trợ lý tiết kiệm AI</h2>
        </div>
        <span className="text-xs text-slate-500">
          Chỉ giải thích và gợi ý · không tự thay đổi dữ liệu
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Mọi con số do hệ thống tính từ giao dịch và khoản góp thực tế của bạn. AI chỉ diễn giải
        những con số đó, không tự tính lại.
      </p>

      {/* Explanation ------------------------------------------------------ */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-explanation">
        {explanation.isLoading ? (
          <p className="text-sm text-slate-500">Đang chuẩn bị giải thích...</p>
        ) : explanation.error ? (
          <ErrorAlert
            message={errorMessage(explanation.error)}
            onRetry={() => void explanation.refetch()}
          />
        ) : explainData ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Vì sao có kế hoạch này</h3>
              <SourceBadge source={explainData.source} />
            </div>
            <p className="mt-2 text-sm text-slate-700">{explainData.summary}</p>
            <DisclosureNote disclosure={explainData.disclosure} />

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                value={formatMoney(explainData.facts.allocatedMonthly, explainData.facts.currency)}
              />
              <Stat
                label="Chưa phân bổ"
                value={moneyOrDash(
                  explainData.facts.unallocatedMonthly,
                  explainData.facts.currency,
                )}
              />
            </div>

            <div className="mt-3 space-y-2">
              {explainData.sections.map((section) => (
                <div key={section.title} className="rounded-xl border border-slate-100 p-3">
                  <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{section.body}</p>
                </div>
              ))}
            </div>

            {explainData.goals.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
                {explainData.goals.map((goal) => (
                  <li key={goal.goalId} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium text-slate-900">
                        <Target className="h-4 w-4 text-slate-400" aria-hidden />
                        {goal.goalName}
                      </span>
                      <Badge tone={STATUS_TONES[goal.progressStatus]}>
                        {SAVINGS_PROGRESS_STATUS_LABELS[goal.progressStatus]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{goal.statusReason}</p>
                    <p className="mt-1 text-xs text-slate-600">
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
              <p className="mt-3 text-sm text-slate-500">
                Chưa có mục tiêu nào trong {explainData.facts.currency} để giải thích.
              </p>
            )}

            {explainData.limitations.length > 0 ? (
              <details className="mt-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium text-slate-700">
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

      {/* Suggestions ------------------------------------------------------ */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-suggestions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Gợi ý dành cho bạn</h3>
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
              <span className="text-xs text-slate-500">
                Mỗi gợi ý đều kèm bằng chứng và không được áp dụng tự động.
              </span>
            </div>
            <DisclosureNote disclosure={suggestions.data.disclosure} />
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
              {suggestions.data.suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  {...(onReviewGoal ? { onReviewGoal } : {})}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Gợi ý chỉ được tạo khi bạn yêu cầu và luôn dựa trên dữ liệu đã ghi nhận.
          </p>
        )}
      </div>

      {/* Scenario --------------------------------------------------------- */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-scenario">
        <h3 className="text-sm font-semibold text-slate-900">Thử một kịch bản</h3>
        <p className="mt-1 text-xs text-slate-500">
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
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-slate-600">
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

        {scenario.error ? (
          <div className="mt-2">
            <ErrorAlert message={errorMessage(scenario.error)} />
          </div>
        ) : null}

        {scenario.data ? (
          <div
            className="mt-3 rounded-xl border border-slate-200 p-3"
            data-testid="ai-scenario-result"
          >
            {scenario.data.status === 'simulated' && scenario.data.simulation ? (
              <>
                <SimulationSummary simulation={scenario.data.simulation} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SourceBadge source={scenario.data.source} />
                  <span className="text-xs text-slate-500">
                    Số liệu ở trên do hệ thống tính; phần giải thích do nguồn ghi trên nhãn viết.
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{scenario.data.explanation}</p>
                <DisclosureNote disclosure={scenario.data.disclosure} />
                {scenario.data.requiresConfirmation ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-amber-800">
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
                <p className="text-sm text-slate-700">{scenario.data.explanation}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Mình chưa hiểu đủ kịch bản nên chưa mô phỏng gì. Bạn nói rõ mục tiêu và số tiền
                  hoặc ngày mong muốn nhé.
                </p>
              </div>
            )}
            {scenario.data.limitations.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                {scenario.data.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Chat ------------------------------------------------------------- */}
      <div className="mt-4 border-t border-slate-100 pt-4" data-testid="ai-chat">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-slate-500" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-900">Hỏi trợ lý</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Trợ lý không thể tạo, sửa hay xóa mục tiêu, khoản góp, giao dịch hay số dư. Lịch sử trò
          chuyện chỉ nằm trong phiên này.
        </p>

        {messages.length === 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {SAVINGS_CHAT_SUGGESTED_QUESTIONS.map((question) => (
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
            aria-label="Hội thoại với trợ lý"
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
                <li key={index} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge source={entry.reply.source} />
                    {entry.reply.scenario ? (
                      <Badge tone="amber">Câu trả lời kèm mô phỏng</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    {entry.reply.reply}
                  </p>
                  {entry.reply.scenario ? (
                    <SimulationSummary simulation={entry.reply.scenario} />
                  ) : null}
                  {entry.reply.references.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1">
                      {entry.reply.references.map((reference) => (
                        <li
                          key={`${reference.label}:${reference.value}`}
                          className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {reference.label}: {reference.value}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
            <ErrorAlert message={errorMessage(chat.error)} />
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
            <span className="sr-only">Câu hỏi cho trợ lý</span>
            <input
              className="input"
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Tại sao mục tiêu của tôi lại chậm tiến độ?"
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
  { role: 'user'; content: string } | { role: 'assistant'; reply: SavingsChatReplyDto };
