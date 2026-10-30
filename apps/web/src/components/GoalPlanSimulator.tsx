import { useMutation } from '@tanstack/react-query';
import type {
  AdjustmentAppliedDto,
  AdjustmentPreviewDto,
  GoalDto,
  PlanFiguresDto,
  SimulationScenario,
  SingleGoalSimulationDto,
} from '@smart-finance/shared-types';
import { SIMULATION_FEASIBILITY_LABELS } from '@smart-finance/shared-types';
import { Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { AiChatContext } from '../lib/ai-chat-context';
import { goalsSimulation } from '../lib/explanations';
import { formatDate, formatMoney } from '../lib/format';
import { AskAIAction, ExplainButton } from './Explain';
import { Badge, ErrorAlert, FieldError, Modal } from './ui';

const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

type SingleScenario = Exclude<SimulationScenario, 'MULTI_GOAL_BUDGET'>;

const SCENARIOS: { key: SingleScenario; label: string }[] = [
  { key: 'MONTHLY_AMOUNT', label: 'Mức góp mỗi tháng' },
  { key: 'DEADLINE', label: 'Ngày đích' },
  { key: 'TARGET_AMOUNT', label: 'Số tiền mục tiêu' },
];

const FEASIBILITY_TONES: Record<
  SingleGoalSimulationDto['feasibility'],
  'emerald' | 'rose' | 'slate'
> = {
  FEASIBLE: 'emerald',
  NOT_FEASIBLE: 'rose',
  INSUFFICIENT_DATA: 'slate',
};

function Figure({
  label,
  current,
  simulated,
}: {
  label: string;
  current: string;
  simulated: string;
}) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2 pr-3 text-left font-medium text-ink-secondary">
        {label}
      </th>
      <td className="py-2 pr-3 text-right text-ink-secondary">{current}</td>
      <td className="py-2 text-right font-semibold text-ink">{simulated}</td>
    </tr>
  );
}

/**
 * Read-only plan simulation for one goal, followed by an explicit adjustment.
 *
 * Nothing is written until the user previews the change and confirms it in the
 * dialog; the apply endpoint only moves the target amount or the deadline.
 * Saved contributions are never touched.
 */
export function GoalPlanSimulator({
  goal,
  timezone,
  onApplied,
  context,
}: {
  goal: GoalDto;
  timezone: string;
  onApplied: () => void;
  context?: AiChatContext;
}) {
  const [scenario, setScenario] = useState<SingleScenario>('MONTHLY_AMOUNT');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SingleGoalSimulationDto | null>(null);
  const [preview, setPreview] = useState<AdjustmentPreviewDto | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const simulate = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<SingleGoalSimulationDto>('/savings/simulations', payload),
    onSuccess: (result) => {
      setSimulation(result);
      setActionError(null);
    },
    onError: (error) => {
      setSimulation(null);
      setActionError(errorMessage(error));
    },
  });

  const previewAdjustment = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<AdjustmentPreviewDto>('/savings/adjustments/preview', payload),
    onSuccess: (result) => {
      setPreview(result);
      setActionError(null);
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const applyAdjustment = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<AdjustmentAppliedDto>('/savings/adjustments/apply', payload),
    onSuccess: () => {
      setPreview(null);
      setSimulation(null);
      setMonthlyAmount('');
      setTargetAmount('');
      setTargetDate('');
      setApplied('Đã cập nhật mục tiêu. Các khoản góp đã ghi nhận được giữ nguyên.');
      onApplied();
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  function runSimulation() {
    setInputError(null);
    setActionError(null);
    setApplied(null);

    if (scenario === 'MONTHLY_AMOUNT') {
      if (!MONEY_REGEX.test(monthlyAmount) || Number(monthlyAmount) <= 0) {
        setInputError('Nhập mức góp lớn hơn 0, tối đa 2 chữ số thập phân');
        return;
      }
      simulate.mutate({ scenario, goalId: goal.id, monthlyAmount });
      return;
    }
    if (scenario === 'DEADLINE') {
      if (!targetDate) {
        setInputError('Chọn ngày đích mới');
        return;
      }
      if (targetDate <= goal.startDate) {
        setInputError('Ngày đích phải sau ngày bắt đầu');
        return;
      }
      simulate.mutate({ scenario, goalId: goal.id, targetDate });
      return;
    }
    if (!MONEY_REGEX.test(targetAmount) || Number(targetAmount) <= 0) {
      setInputError('Nhập số tiền mục tiêu lớn hơn 0');
      return;
    }
    if (Number(targetAmount) < Number(goal.savedAmount)) {
      setInputError('Số tiền mục tiêu không được thấp hơn số đã tiết kiệm');
      return;
    }
    simulate.mutate({ scenario, goalId: goal.id, targetAmount });
  }

  function requestPreview() {
    if (!simulation) return;
    setActionError(null);
    if (simulation.scenario === 'DEADLINE' && targetDate) {
      previewAdjustment.mutate({ goalId: goal.id, targetDate });
    } else if (simulation.scenario === 'TARGET_AMOUNT' && targetAmount) {
      previewAdjustment.mutate({ goalId: goal.id, targetAmount });
    }
  }

  function confirmApply() {
    if (!preview) return;
    setActionError(null);
    applyAdjustment.mutate({
      goalId: goal.id,
      ...(preview.changes.some((change) => change.field === 'targetAmount')
        ? {
            targetAmount: preview.changes.find((change) => change.field === 'targetAmount')
              ?.newValue,
          }
        : {}),
      ...(preview.changes.some((change) => change.field === 'targetDate')
        ? { targetDate: preview.changes.find((change) => change.field === 'targetDate')?.newValue }
        : {}),
    });
  }

  const figures: { label: string; current: string; simulated: string }[] | null = simulation
    ? [
        {
          label: 'Số tiền mục tiêu',
          current: formatMoney(simulation.current.targetAmount, goal.currency),
          simulated: formatMoney(simulation.simulated.targetAmount, goal.currency),
        },
        {
          label: 'Còn thiếu',
          current: formatMoney(simulation.current.remainingAmount, goal.currency),
          simulated: formatMoney(simulation.simulated.remainingAmount, goal.currency),
        },
        {
          label: 'Cần góp mỗi tháng',
          current: moneyOrDash(simulation.current.requiredMonthlySaving, goal.currency),
          simulated: moneyOrDash(simulation.simulated.requiredMonthlySaving, goal.currency),
        },
        {
          label: 'Mức góp giả định',
          current: moneyOrDash(simulation.current.monthlySaving, goal.currency),
          simulated: moneyOrDash(simulation.simulated.monthlySaving, goal.currency),
        },
        {
          label: 'Dự kiến hoàn thành',
          current: dateOrDash(simulation.current.estimatedCompletionDate, timezone),
          simulated: dateOrDash(simulation.simulated.estimatedCompletionDate, timezone),
        },
        {
          label: 'Đúng hạn',
          current: deadlineLabel(simulation.current.deadlineMet),
          simulated: deadlineLabel(simulation.simulated.deadlineMet),
        },
      ]
    : null;

  const canPropose =
    simulation !== null &&
    (simulation.scenario === 'DEADLINE' || simulation.scenario === 'TARGET_AMOUNT');

  return (
    <section className="rounded-xl border border-line p-4" aria-label="Mô phỏng kế hoạch">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-4 w-4 text-info" aria-hidden />
        <h3 className="text-sm font-semibold text-ink">Mô phỏng kế hoạch</h3>
        <ExplainButton
          explanation={goalsSimulation}
          label="Cách hoạt động"
          variant="link"
          context={context}
        />
        <AskAIAction
          prompt="Giải thích cách mô phỏng kế hoạch tiết kiệm và ý nghĩa các con số dự kiến."
          assistantType="SAVINGS"
          context={context}
          label="Hỏi AI về kế hoạch"
        />
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Chỉ là phép tính xem trước: không có khoản góp nào được tạo và mục tiêu chưa bị thay đổi.
      </p>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Kịch bản mô phỏng">
        {SCENARIOS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={scenario === option.key}
            onClick={() => {
              setScenario(option.key);
              setSimulation(null);
              setInputError(null);
              setActionError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              scenario === option.key
                ? 'bg-info text-white'
                : 'bg-surface-muted text-ink-secondary hover:bg-line'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {scenario === 'MONTHLY_AMOUNT' ? (
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink-secondary">
            <span>Số tiền góp mỗi tháng</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="3000000"
              value={monthlyAmount}
              onChange={(event) => setMonthlyAmount(event.target.value)}
            />
          </label>
        ) : null}
        {scenario === 'DEADLINE' ? (
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink-secondary">
            <span>Ngày đích mới</span>
            <input
              type="date"
              className="input"
              value={targetDate}
              min={`${goal.startDate}`}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </label>
        ) : null}
        {scenario === 'TARGET_AMOUNT' ? (
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm text-ink-secondary">
            <span>Số tiền mục tiêu mới</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder={goal.savedAmount}
              value={targetAmount}
              onChange={(event) => setTargetAmount(event.target.value)}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={runSimulation}
          disabled={simulate.isPending}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {simulate.isPending ? 'Đang tính...' : 'Mô phỏng'}
        </button>
      </div>
      <FieldError message={inputError ?? undefined} />
      {actionError ? (
        <div className="mt-2">
          <ErrorAlert message={actionError} />
        </div>
      ) : null}
      {applied ? (
        <p className="mt-2 rounded-xl border border-brand/30 bg-brand-soft p-3 text-xs text-brand-hover">
          {applied}
        </p>
      ) : null}

      {simulation && figures ? (
        <div className="mt-4 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">Hiện tại so với giả định</h4>
            <Badge tone={FEASIBILITY_TONES[simulation.feasibility]}>
              {SIMULATION_FEASIBILITY_LABELS[simulation.feasibility]}
            </Badge>
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
                {figures.map((row) => (
                  <Figure
                    key={row.label}
                    label={row.label}
                    current={row.current}
                    simulated={row.simulated}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-ink-secondary">{simulation.feasibilityReason}</p>
          {simulation.warnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-warning-strong">
              {simulation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {canPropose ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={requestPreview}
                disabled={previewAdjustment.isPending}
              >
                Xem trước thay đổi
              </button>
              <span className="text-xs text-ink-muted">
                Bạn sẽ thấy thay đổi cũ → mới và phải xác nhận lần nữa.
              </span>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">
              Mức góp mỗi tháng chỉ là giả định để xem trước, nên chỉ có thể áp dụng thay đổi ngày
              đích hoặc số tiền mục tiêu.
            </p>
          )}
        </div>
      ) : null}

      <Modal
        open={preview !== null}
        title="Xác nhận điều chỉnh mục tiêu"
        onClose={() => setPreview(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
              Huỷ
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!preview?.canApply || applyAdjustment.isPending}
              onClick={confirmApply}
            >
              {applyAdjustment.isPending ? 'Đang áp dụng...' : 'Xác nhận áp dụng'}
            </button>
          </div>
        }
      >
        {preview ? (
          <div className="space-y-3">
            {preview.problems.length > 0 ? (
              <ErrorAlert message={preview.problems.join(' ')} />
            ) : null}
            <p className="text-sm text-ink-secondary">
              Mục tiêu <span className="font-semibold text-ink">{preview.goalName}</span> sẽ được
              cập nhật sau khi bạn xác nhận. Các khoản góp đã ghi nhận không thay đổi.
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {preview.changes.map((change) => (
                <li
                  key={change.field}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <span className="text-ink-secondary">
                    {change.field === 'targetAmount' ? 'Số tiền mục tiêu' : 'Ngày đích'}
                  </span>
                  <span className="text-ink-muted">
                    {formatChange(change.field, change.oldValue, preview.currency, timezone)}
                    {' → '}
                    <span className="font-semibold text-ink">
                      {formatChange(change.field, change.newValue, preview.currency, timezone)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="rounded-xl bg-surface-muted p-3 text-xs text-ink-secondary">
                Còn thiếu sau điều chỉnh:{' '}
                <span className="font-semibold text-ink">
                  {formatMoney(preview.projected.remainingAmount, preview.currency)}
                </span>
              </p>
              <p className="rounded-xl bg-surface-muted p-3 text-xs text-ink-secondary">
                Cần góp mỗi tháng:{' '}
                <span className="font-semibold text-ink">
                  {moneyOrDash(preview.projected.requiredMonthlySaving, preview.currency)}
                </span>
              </p>
            </div>
            {preview.warnings.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-warning-strong">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

function moneyOrDash(value: string | null, currency: string): string {
  return value === null ? '—' : formatMoney(value, currency);
}

function dateOrDash(value: string | null, timezone: string): string {
  return value === null ? '—' : formatDate(`${value}T00:00`, timezone);
}

function deadlineLabel(value: PlanFiguresDto['deadlineMet']): string {
  if (value === null) return '—';
  return value ? 'Có' : 'Không';
}

function formatChange(field: string, value: string, currency: string, timezone: string): string {
  if (field === 'targetAmount') return formatMoney(value, currency);
  return value ? formatDate(`${value}T00:00`, timezone) : 'Không đặt hạn';
}
