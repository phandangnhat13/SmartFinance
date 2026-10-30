import type {
  AiDisclosureDto,
  AiEvidenceDto,
  AnalyticsAiChatIntent,
  SavingsSimulationDto,
  SimulationScenario,
} from '@smart-finance/shared-types';
import { SIMULATION_FEASIBILITY_LABELS } from '@smart-finance/shared-types';
import { ApiError, errorMessage } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { Badge, cn } from '../ui';

/**
 * Presentation pieces shared by the AI panels and the floating chat widget.
 *
 * They only format what the backend returned: calculated figures and evidence
 * are never derived here, and the source badge never guesses whether a model
 * was used.
 */

/** Says who wrote a piece of prose: the model or the rule-based fallback. */
export function SourceBadge({
  source,
  aiLabel = 'AI viết',
}: {
  source: 'AI' | 'FALLBACK';
  aiLabel?: string;
}) {
  return source === 'AI' ? (
    <Badge tone="sky">{aiLabel}</Badge>
  ) : (
    <Badge tone="slate">Không dùng AI</Badge>
  );
}

export function DisclosureNote({ disclosure }: { disclosure: AiDisclosureDto }) {
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
export function EvidenceChips({
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

export const ANALYTICS_INTENT_LABELS: Record<AnalyticsAiChatIntent, string> = {
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

/** A 429 gets a clear retry hint instead of a raw error. */
export function throttleMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = error.retryAfterSeconds;
    return seconds
      ? `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${seconds} giây.`
      : 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.';
  }
  return errorMessage(error);
}

/**
 * Chat-specific error copy. Each class of failure gets its own next step, so
 * the user is not told "system error" when the real cause is a signed-out
 * session, a deleted conversation or a provider outage.
 *
 * Safe backend validation detail (400/422) is preserved; other statuses use
 * our own copy so no internal message, token or stack trace can leak through.
 */
export function chatErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
      case 422:
        return errorMessage(error);
      case 401:
        return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.';
      case 403:
        return 'Bạn không có quyền truy cập cuộc trò chuyện này.';
      case 404:
        return 'Cuộc trò chuyện không còn tồn tại. Hãy bắt đầu cuộc trò chuyện mới.';
      case 429:
        return throttleMessage(error);
      case 502:
      case 503:
      case 504:
        return 'Dịch vụ AI tạm thời không phản hồi. Vui lòng thử lại sau ít phút.';
      default:
        if (error.status >= 500) {
          return 'Trợ lý AI đang gặp sự cố. Vui lòng thử lại sau ít phút.';
        }
    }
  }
  return 'Không kết nối được tới trợ lý AI. Kiểm tra kết nối mạng và thử lại.';
}

/* ------------------------- savings simulation ------------------------- */

const SCENARIO_LABELS: Record<SimulationScenario, string> = {
  MONTHLY_AMOUNT: 'Mức góp mỗi tháng',
  DEADLINE: 'Ngày đích',
  TARGET_AMOUNT: 'Số tiền mục tiêu',
  MULTI_GOAL_BUDGET: 'Ngân sách cho nhiều mục tiêu',
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

function deadlineLabel(value: boolean | null): string {
  if (value === null) return '—';
  return value ? 'Có' : 'Không';
}

/** Compact, read-only view of a deterministic M2d simulation. */
export function SimulationSummary({ simulation }: { simulation: SavingsSimulationDto }) {
  if (simulation.scenario === 'MULTI_GOAL_BUDGET') {
    return (
      <div className="mt-2 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
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
          <ul className="mt-2 divide-y divide-line text-sm">
            {simulation.differences.map((difference) => (
              <li
                key={difference.goalId}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5"
              >
                <span className="text-ink-secondary">{difference.goalName}</span>
                <span className="text-ink-secondary">
                  {moneyOrDash(difference.baselineMonthlySaving, simulation.currency)} →{' '}
                  <span className="font-semibold text-ink">
                    {moneyOrDash(difference.simulatedMonthlySaving, simulation.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {simulation.simulated.infeasibleGoalIds.length > 0 ? (
          <p className="mt-2 text-xs text-warning-strong">
            Ngân sách này không đủ cho {simulation.simulated.infeasibleGoalIds.length} mục tiêu.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
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
            <tr className="text-xs uppercase tracking-wide text-ink-muted">
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
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink-secondary">
                Mức góp mỗi tháng
              </th>
              <td className="py-1.5 pr-3 text-right text-ink-secondary">
                {moneyOrDash(simulation.current.monthlySaving, simulation.currency)}
              </td>
              <td className="py-1.5 text-right font-semibold text-ink">
                {moneyOrDash(simulation.simulated.monthlySaving, simulation.currency)}
              </td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink-secondary">
                Cần góp mỗi tháng
              </th>
              <td className="py-1.5 pr-3 text-right text-ink-secondary">
                {moneyOrDash(simulation.current.requiredMonthlySaving, simulation.currency)}
              </td>
              <td className="py-1.5 text-right font-semibold text-ink">
                {moneyOrDash(simulation.simulated.requiredMonthlySaving, simulation.currency)}
              </td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink-secondary">
                Dự kiến hoàn thành
              </th>
              <td className="py-1.5 pr-3 text-right text-ink-secondary">
                {simulation.current.estimatedCompletionDate
                  ? formatDate(`${simulation.current.estimatedCompletionDate}T00:00`)
                  : '—'}
              </td>
              <td className="py-1.5 text-right font-semibold text-ink">
                {simulation.simulated.estimatedCompletionDate
                  ? formatDate(`${simulation.simulated.estimatedCompletionDate}T00:00`)
                  : '—'}
              </td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink-secondary">
                Đúng hạn
              </th>
              <td className="py-1.5 pr-3 text-right text-ink-secondary">
                {deadlineLabel(simulation.current.deadlineMet)}
              </td>
              <td className="py-1.5 text-right font-semibold text-ink">
                {deadlineLabel(simulation.simulated.deadlineMet)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-secondary">{simulation.feasibilityReason}</p>
    </div>
  );
}
