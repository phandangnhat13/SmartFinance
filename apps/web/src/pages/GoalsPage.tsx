import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GoalContributionDto, GoalDisplayStatus, GoalDto } from '@smart-finance/shared-types';
import { GOAL_DISPLAY_STATUS_LABELS } from '@smart-finance/shared-types';
import {
  Archive,
  CheckCircle2,
  HandCoins,
  Pause,
  Pencil,
  Play,
  Plus,
  Target,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  FieldError,
  Modal,
  PageHeader,
  ProgressBar,
  Spinner,
} from '../components/ui';
import { SavingsProgressDashboard } from '../components/SavingsProgressDashboard';
import { SavingsAssistantPanel } from '../components/SavingsAssistantPanel';
import { SavingsRecommendations } from '../components/SavingsRecommendations';
import { GoalProgressPanel } from '../components/GoalProgressPanel';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { inputToIso, isoToInput, todayInTimeZone } from '../lib/date';
import { formatDate, formatMoney } from '../lib/format';

const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

const COMMON_CURRENCIES = ['VND', 'USD', 'EUR', 'JPY', 'GBP'];

const moneyField = z
  .string()
  .regex(MONEY_REGEX, 'Số tiền không hợp lệ')
  .refine((value) => Number(value) > 0, 'Số tiền phải lớn hơn 0');

const goalSchema = z
  .object({
    name: z.string().trim().min(1, 'Nhập tên mục tiêu').max(80, 'Tối đa 80 ký tự'),
    description: z.string().max(500, 'Tối đa 500 ký tự').optional(),
    targetAmount: moneyField,
    currency: z.string().regex(/^[A-Z]{3}$/, 'Mã tiền tệ gồm 3 chữ cái'),
    startDate: z.string().min(1, 'Chọn ngày bắt đầu'),
    targetDate: z.string().optional(),
  })
  .refine((values) => !values.targetDate || values.targetDate > values.startDate, {
    path: ['targetDate'],
    message: 'Ngày đích phải sau ngày bắt đầu',
  });

type GoalFormValues = z.infer<typeof goalSchema>;

const contributionSchema = z.object({
  amount: moneyField,
  contributedAt: z.string().min(1, 'Chọn ngày góp'),
  note: z.string().max(500, 'Tối đa 500 ký tự').optional(),
});

type ContributionFormValues = z.infer<typeof contributionSchema>;

interface ContributionTarget {
  goal: GoalDto;
  contribution?: GoalContributionDto;
}

const STATUS_TONES: Record<GoalDisplayStatus, 'sky' | 'rose' | 'amber' | 'emerald' | 'slate'> = {
  ACTIVE: 'sky',
  OVERDUE: 'rose',
  PAUSED: 'amber',
  COMPLETED: 'emerald',
  ARCHIVED: 'slate',
};

function StatusBadge({ goal }: { goal: GoalDto }) {
  return (
    <Badge tone={STATUS_TONES[goal.displayStatus]}>
      {GOAL_DISPLAY_STATUS_LABELS[goal.displayStatus]}
    </Badge>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

export function GoalsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const defaultCurrency = user?.defaultCurrency ?? 'VND';
  const today = todayInTimeZone(timezone);
  const queryClient = useQueryClient();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GoalDto | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailSnapshot, setDetailSnapshot] = useState<GoalDto | null>(null);
  const [contributionTarget, setContributionTarget] = useState<ContributionTarget | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<GoalDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    goal: GoalDto;
    contribution: GoalContributionDto;
  } | null>(null);

  const goalsQuery = useQuery({
    queryKey: ['goals', includeArchived],
    queryFn: () => api.get<{ items: GoalDto[] }>(`/goals?includeArchived=${includeArchived}`),
  });

  const goals = useMemo(() => goalsQuery.data?.items ?? [], [goalsQuery.data]);

  const currencies = useMemo(
    () => Array.from(new Set(goals.map((goal) => goal.currency))).sort(),
    [goals],
  );

  // All money figures are per currency: nothing is converted or summed across them.
  const currency = useMemo(() => {
    if (selectedCurrency && currencies.includes(selectedCurrency)) return selectedCurrency;
    if (currencies.includes(defaultCurrency)) return defaultCurrency;
    return currencies[0] ?? defaultCurrency;
  }, [selectedCurrency, currencies, defaultCurrency]);

  const visibleGoals = useMemo(
    () => goals.filter((goal) => goal.currency === currency),
    [goals, currency],
  );

  const goalForm = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: '',
      description: '',
      targetAmount: '',
      currency: defaultCurrency,
      startDate: today,
      targetDate: '',
    },
  });

  const contributionForm = useForm<ContributionFormValues>({
    resolver: zodResolver(contributionSchema),
    defaultValues: { amount: '', contributedAt: today, note: '' },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['goals'] });
    // Contributions and statuses change the allocation, so refresh the advice too.
    await queryClient.invalidateQueries({ queryKey: ['savings-recommendations'] });
    // Server-computed progress and history depend on the same goal rows.
    await queryClient.invalidateQueries({ queryKey: ['savings-progress'] });
    await queryClient.invalidateQueries({ queryKey: ['savings-goal-progress'] });
    await queryClient.invalidateQueries({ queryKey: ['savings-history'] });
  };

  const saveGoal = useMutation({
    mutationFn: (values: GoalFormValues) => {
      if (editing) {
        return api.patch(`/goals/${editing.id}`, {
          name: values.name.trim(),
          description: values.description?.trim() ?? '',
          targetAmount: values.targetAmount,
          ...(editing.contributions.length === 0 && values.startDate !== editing.startDate
            ? { startDate: values.startDate }
            : {}),
          ...(values.targetDate ? { targetDate: values.targetDate } : {}),
        });
      }
      return api.post('/goals', {
        name: values.name.trim(),
        targetAmount: values.targetAmount,
        currency: values.currency,
        startDate: values.startDate,
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        ...(values.targetDate ? { targetDate: values.targetDate } : {}),
      });
    },
    onSuccess: async (_result, values) => {
      // A goal can be created in another currency than the current filter;
      // switch to it so the new goal is visible immediately.
      if (!editing) setSelectedCurrency(values.currency);
      await invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' }) =>
      api.patch(`/goals/${id}`, { status }),
    onSuccess: async () => {
      setDetailError(null);
      await invalidate();
    },
    onError: (error) => setDetailError(errorMessage(error)),
  });

  const archiveGoal = useMutation({
    mutationFn: (id: string) => api.delete(`/goals/${id}`),
    onSuccess: async () => {
      setDetailError(null);
      setDetailId(null);
      setDetailSnapshot(null);
      await invalidate();
    },
    onError: (error) => {
      setPageError(errorMessage(error));
      setDetailError(errorMessage(error));
    },
  });

  const saveContribution = useMutation({
    mutationFn: ({
      goalId,
      contributionId,
      payload,
    }: {
      goalId: string;
      contributionId?: string;
      payload: Record<string, unknown>;
    }) =>
      contributionId
        ? api.patch(`/goals/${goalId}/contributions/${contributionId}`, payload)
        : api.post(`/goals/${goalId}/contributions`, payload),
    onSuccess: async () => {
      await invalidate();
      setContributionTarget(null);
    },
  });

  const deleteContribution = useMutation({
    mutationFn: ({ goalId, contributionId }: { goalId: string; contributionId: string }) =>
      api.delete(`/goals/${goalId}/contributions/${contributionId}`),
    onSuccess: async () => {
      setDetailError(null);
      await invalidate();
    },
    onError: (error) => setDetailError(errorMessage(error)),
  });

  const detailGoal = detailId
    ? (goals.find((goal) => goal.id === detailId) ?? detailSnapshot)
    : null;

  const goalCurrencyOptions = useMemo(
    () => Array.from(new Set([...COMMON_CURRENCIES, defaultCurrency, ...currencies])),
    [currencies, defaultCurrency],
  );

  function openCreate() {
    setEditing(null);
    setFormError(null);
    goalForm.reset({
      name: '',
      description: '',
      targetAmount: '',
      currency: defaultCurrency,
      startDate: todayInTimeZone(timezone),
      targetDate: '',
    });
    setFormOpen(true);
  }

  function openEdit(goal: GoalDto) {
    if (goal.status === 'ARCHIVED') return;
    setEditing(goal);
    setFormError(null);
    goalForm.reset({
      name: goal.name,
      description: goal.description ?? '',
      targetAmount: goal.targetAmount,
      currency: goal.currency,
      startDate: goal.startDate,
      targetDate: goal.targetDate ?? '',
    });
    setDetailId(null);
    setDetailSnapshot(null);
    setFormOpen(true);
  }

  function openContribution(goal: GoalDto, contribution?: GoalContributionDto) {
    setFormError(null);
    setDetailError(null);
    contributionForm.reset({
      amount: contribution?.amount ?? '',
      contributedAt: contribution
        ? isoToInput(contribution.contributedAt, timezone).slice(0, 10)
        : todayInTimeZone(timezone),
      note: contribution?.note ?? '',
    });
    setContributionTarget({ goal, contribution });
  }

  function openDetail(goal: GoalDto) {
    setDetailError(null);
    setDetailId(goal.id);
    setDetailSnapshot(goal);
  }

  function closeDetail() {
    setDetailId(null);
    setDetailSnapshot(null);
  }

  async function onSubmitGoal(values: GoalFormValues) {
    setFormError(null);
    if (editing && Number(values.targetAmount) < Number(editing.savedAmount)) {
      goalForm.setError('targetAmount', {
        message: 'Số tiền mục tiêu không được thấp hơn số đã tiết kiệm',
      });
      return;
    }
    try {
      await saveGoal.mutateAsync(values);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function onSubmitContribution(values: ContributionFormValues) {
    setFormError(null);
    if (!contributionTarget) return;
    const { goal, contribution } = contributionTarget;
    const maxAllowed =
      Number(goal.remainingAmount) + (contribution ? Number(contribution.amount) : 0);
    if (Number(values.amount) > maxAllowed) {
      contributionForm.setError('amount', {
        message: `Chỉ còn có thể góp ${formatMoney(maxAllowed, goal.currency)}`,
      });
      return;
    }
    const payload: Record<string, unknown> = {
      amount: values.amount,
      contributedAt: inputToIso(`${values.contributedAt}T00:00`, timezone),
    };
    if (contribution) {
      payload.note = values.note?.trim() ?? '';
    } else if (values.note?.trim()) {
      payload.note = values.note.trim();
    }
    try {
      await saveContribution.mutateAsync({
        goalId: goal.id,
        contributionId: contribution?.id,
        payload,
      });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  function requestArchive(goal: GoalDto) {
    setArchiveTarget(goal);
  }

  function requestDeleteContribution(goal: GoalDto, contribution: GoalContributionDto) {
    setDeleteTarget({ goal, contribution });
  }

  return (
    <div>
      <PageHeader
        title="Mục tiêu tiết kiệm"
        description="Lập kế hoạch tiết kiệm theo từng mục tiêu và ghi nhận số tiền thực tế đã dành riêng."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm mục tiêu
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {currencies.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <span>Tiền tệ</span>
            <select
              className="input w-auto"
              value={currency}
              onChange={(event) => setSelectedCurrency(event.target.value)}
              aria-label="Lọc theo tiền tệ"
            >
              {currencies.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-line-strong"
          />
          Hiện mục tiêu đã lưu trữ
        </label>
      </div>

      {pageError ? (
        <div className="mb-4">
          <ErrorAlert message={pageError} />
        </div>
      ) : null}

      {goalsQuery.isLoading ? (
        <Spinner label="Đang tải mục tiêu..." />
      ) : goalsQuery.error ? (
        <ErrorAlert
          message={errorMessage(goalsQuery.error)}
          onRetry={() => void goalsQuery.refetch()}
        />
      ) : visibleGoals.length === 0 ? (
        <EmptyState
          title="Chưa có mục tiêu"
          description="Tạo mục tiêu như mua laptop, quỹ khẩn cấp hay du lịch, rồi ghi nhận từng khoản tiết kiệm."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              Thêm mục tiêu
            </button>
          }
        />
      ) : (
        <>
          <SavingsProgressDashboard
            currency={currency}
            context={{
              page: 'goals',
              currency,
              feature: 'progress-overview',
              label: 'Tổng quan tiến độ tiết kiệm',
            }}
          />

          <SavingsRecommendations currency={currency} timezone={timezone} />

          <SavingsAssistantPanel
            currency={currency}
            onReviewGoal={(goalId) => {
              const goal = goals.find((item) => item.id === goalId);
              if (goal) openDetail(goal);
            }}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            {visibleGoals.map((goal) => (
              <article
                key={goal.id}
                className={`card ${goal.status === 'ARCHIVED' ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                      <Target className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{goal.name}</p>
                      <p className="text-xs text-ink-muted">
                        {goal.targetDate
                          ? `Hạn ${formatDate(goal.targetDate, timezone)}`
                          : 'Không đặt hạn'}
                        {goal.monthsRemaining !== null && goal.monthsRemaining > 0
                          ? ` · còn ${goal.monthsRemaining} tháng`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <StatusBadge goal={goal} />
                </div>

                {goal.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-ink-secondary">{goal.description}</p>
                ) : null}

                <div className="mt-4">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 text-sm">
                    <span className="font-semibold text-ink">
                      {formatMoney(goal.savedAmount, goal.currency)}
                    </span>
                    <span className="text-ink-muted">
                      / {formatMoney(goal.targetAmount, goal.currency)}
                    </span>
                  </div>
                  <ProgressBar
                    value={goal.percentage}
                    tone={
                      goal.status === 'COMPLETED'
                        ? 'emerald'
                        : goal.displayStatus === 'OVERDUE'
                          ? 'rose'
                          : 'amber'
                    }
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    {Math.round(goal.percentage)}%
                    {goal.status !== 'COMPLETED'
                      ? ` · còn thiếu ${formatMoney(goal.remainingAmount, goal.currency)}`
                      : ' · đã hoàn thành'}
                  </p>
                  {goal.displayStatus === 'OVERDUE' ? (
                    <p className="mt-1 text-xs font-medium text-expense">
                      Đã quá hạn
                      {goal.targetDate ? ` từ ${formatDate(goal.targetDate, timezone)}` : ''}.
                    </p>
                  ) : null}
                  {goal.displayStatus === 'PAUSED' ? (
                    <p className="mt-1 text-xs text-warning-strong">
                      Đang tạm dừng nên không yêu cầu tiết kiệm thêm.
                    </p>
                  ) : null}
                  {goal.requiredMonthlySaving && Number(goal.requiredMonthlySaving) > 0 ? (
                    <p className="mt-1 text-xs text-ink-secondary">
                      Cần tiết kiệm {formatMoney(goal.requiredMonthlySaving, goal.currency)}/tháng.
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => openDetail(goal)}
                    className="rounded-lg px-2 py-2 text-xs font-medium text-brand hover:bg-brand-soft"
                  >
                    Chi tiết
                  </button>
                  <button
                    type="button"
                    onClick={() => openContribution(goal)}
                    disabled={goal.status !== 'ACTIVE'}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-income hover:bg-brand-soft disabled:opacity-40"
                  >
                    <HandCoins className="h-4 w-4" aria-hidden /> Góp thêm
                  </button>
                  {goal.status !== 'ARCHIVED' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(goal)}
                        className="ml-auto rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
                        aria-label={`Sửa ${goal.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestArchive(goal)}
                        className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
                        aria-label={`Lưu trữ ${goal.name}`}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Sửa mục tiêu' : 'Thêm mục tiêu'}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      >
        <form className="space-y-4" onSubmit={goalForm.handleSubmit(onSubmitGoal)} noValidate>
          {formError ? <ErrorAlert message={formError} /> : null}
          <div>
            <label className="label" htmlFor="goalName">
              Tên mục tiêu
            </label>
            <input
              id="goalName"
              className="input"
              placeholder="Quỹ khẩn cấp"
              {...goalForm.register('name')}
            />
            <FieldError message={goalForm.formState.errors.name?.message} />
          </div>
          <div>
            <label className="label" htmlFor="goalDescription">
              Mô tả (tuỳ chọn)
            </label>
            <textarea
              id="goalDescription"
              className="input min-h-20"
              placeholder="Mục tiêu này dùng cho việc gì?"
              {...goalForm.register('description')}
            />
            <FieldError message={goalForm.formState.errors.description?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="goalTarget">
                Số tiền mục tiêu
              </label>
              <input
                id="goalTarget"
                inputMode="decimal"
                className="input"
                placeholder="25000000"
                {...goalForm.register('targetAmount')}
              />
              <FieldError message={goalForm.formState.errors.targetAmount?.message} />
            </div>
            <div>
              <label className="label" htmlFor="goalCurrency">
                Tiền tệ
              </label>
              <select
                id="goalCurrency"
                className="input"
                disabled={Boolean(editing)}
                {...goalForm.register('currency')}
              >
                {goalCurrencyOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {editing ? (
                <p className="mt-1 text-xs text-ink-muted">Không thể đổi tiền tệ sau khi tạo.</p>
              ) : null}
              <FieldError message={goalForm.formState.errors.currency?.message} />
            </div>
            <div>
              <label className="label" htmlFor="goalStartDate">
                Ngày bắt đầu
              </label>
              <input
                id="goalStartDate"
                type="date"
                className="input"
                disabled={Boolean(editing && editing.contributions.length > 0)}
                {...goalForm.register('startDate')}
              />
              {editing && editing.contributions.length > 0 ? (
                <p className="mt-1 text-xs text-ink-muted">Đã khóa vì mục tiêu đã có khoản góp.</p>
              ) : null}
              <FieldError message={goalForm.formState.errors.startDate?.message} />
            </div>
            <div>
              <label className="label" htmlFor="goalDate">
                Ngày đích (tuỳ chọn)
              </label>
              <input
                id="goalDate"
                type="date"
                className="input"
                {...goalForm.register('targetDate')}
              />
              <FieldError message={goalForm.formState.errors.targetDate?.message} />
            </div>
          </div>
          {editing ? (
            <p className="rounded-xl bg-surface-muted p-3 text-xs text-ink-secondary">
              Đã tiết kiệm {formatMoney(editing.savedAmount, editing.currency)}. Số tiền mục tiêu
              không được thấp hơn số này; thêm khoản góp bằng nút “Góp thêm”.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
              }}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={goalForm.formState.isSubmitting}
            >
              {goalForm.formState.isSubmitting ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={contributionTarget !== null}
        title={
          contributionTarget
            ? `${contributionTarget.contribution ? 'Sửa khoản góp' : 'Góp vào'} "${contributionTarget.goal.name}"`
            : 'Góp tiền'
        }
        onClose={() => setContributionTarget(null)}
      >
        <form
          className="space-y-4"
          onSubmit={contributionForm.handleSubmit(onSubmitContribution)}
          noValidate
        >
          {formError ? <ErrorAlert message={formError} /> : null}
          {contributionTarget ? (
            <p className="rounded-xl bg-surface-muted p-3 text-xs text-ink-secondary">
              Còn có thể góp{' '}
              {formatMoney(
                Number(contributionTarget.goal.remainingAmount) +
                  (contributionTarget.contribution
                    ? Number(contributionTarget.contribution.amount)
                    : 0),
                contributionTarget.goal.currency,
              )}
              . Khoản góp không được vượt quá số tiền mục tiêu.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="contributionAmount">
                Số tiền
              </label>
              <input
                id="contributionAmount"
                inputMode="decimal"
                className="input"
                {...contributionForm.register('amount')}
              />
              <FieldError message={contributionForm.formState.errors.amount?.message} />
            </div>
            <div>
              <label className="label" htmlFor="contributionDate">
                Ngày
              </label>
              <input
                id="contributionDate"
                type="date"
                max={today}
                className="input"
                {...contributionForm.register('contributedAt')}
              />
              <FieldError message={contributionForm.formState.errors.contributedAt?.message} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="contributionNote">
              Ghi chú (tuỳ chọn)
            </label>
            <input id="contributionNote" className="input" {...contributionForm.register('note')} />
            <FieldError message={contributionForm.formState.errors.note?.message} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setContributionTarget(null)}
            >
              Huỷ
            </button>
            <button type="submit" className="btn-primary" disabled={saveContribution.isPending}>
              {saveContribution.isPending ? 'Đang lưu...' : 'Ghi nhận'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailGoal !== null && archiveTarget === null && deleteTarget === null}
        title={detailGoal ? detailGoal.name : 'Chi tiết mục tiêu'}
        onClose={closeDetail}
        footer={
          detailGoal ? (
            <div className="flex flex-wrap justify-end gap-2">
              {detailGoal.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    openContribution(detailGoal);
                    closeDetail();
                  }}
                >
                  Góp thêm
                </button>
              ) : null}
              {detailGoal.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={changeStatus.isPending}
                  onClick={() => changeStatus.mutate({ id: detailGoal.id, status: 'PAUSED' })}
                >
                  <Pause className="h-4 w-4" aria-hidden /> Tạm dừng
                </button>
              ) : null}
              {detailGoal.status === 'PAUSED' ||
              (detailGoal.status === 'COMPLETED' &&
                Number(detailGoal.savedAmount) < Number(detailGoal.targetAmount)) ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={changeStatus.isPending}
                  onClick={() => changeStatus.mutate({ id: detailGoal.id, status: 'ACTIVE' })}
                >
                  <Play className="h-4 w-4" aria-hidden /> Tiếp tục
                </button>
              ) : null}
              {detailGoal.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={changeStatus.isPending}
                  onClick={() => changeStatus.mutate({ id: detailGoal.id, status: 'COMPLETED' })}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Hoàn thành
                </button>
              ) : null}
              {detailGoal.status !== 'ARCHIVED' ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => requestArchive(detailGoal)}
                >
                  <Archive className="h-4 w-4" aria-hidden /> Lưu trữ
                </button>
              ) : null}
            </div>
          ) : null
        }
      >
        {detailGoal ? (
          <div className="space-y-4">
            {detailError ? <ErrorAlert message={detailError} /> : null}
            <div className="flex items-center justify-between gap-3">
              <StatusBadge goal={detailGoal} />
              <span className="text-sm font-medium text-ink-secondary">{detailGoal.currency}</span>
            </div>
            {detailGoal.description ? (
              <p className="text-sm text-ink-secondary">{detailGoal.description}</p>
            ) : null}
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 text-sm">
                <span className="font-semibold text-ink">
                  {formatMoney(detailGoal.savedAmount, detailGoal.currency)}
                </span>
                <span className="text-ink-muted">
                  / {formatMoney(detailGoal.targetAmount, detailGoal.currency)}
                </span>
              </div>
              <ProgressBar
                value={detailGoal.percentage}
                tone={
                  detailGoal.status === 'COMPLETED'
                    ? 'emerald'
                    : detailGoal.displayStatus === 'OVERDUE'
                      ? 'rose'
                      : 'amber'
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Còn thiếu"
                value={formatMoney(detailGoal.remainingAmount, detailGoal.currency)}
              />
              <Stat
                label="Cần tiết kiệm/tháng"
                value={
                  detailGoal.requiredMonthlySaving
                    ? formatMoney(detailGoal.requiredMonthlySaving, detailGoal.currency)
                    : detailGoal.status === 'COMPLETED'
                      ? 'Không cần thêm'
                      : '—'
                }
              />
              <Stat
                label="Số tháng còn lại"
                value={
                  detailGoal.monthsRemaining === null
                    ? 'Không đặt hạn'
                    : detailGoal.monthsRemaining === 0
                      ? 'Đã đến hạn'
                      : `${detailGoal.monthsRemaining} tháng`
                }
              />
              <Stat label="Ngày bắt đầu" value={formatDate(detailGoal.startDate, timezone)} />
            </div>
            {detailGoal.displayStatus === 'OVERDUE' ? (
              <p className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger-strong">
                Mục tiêu đã quá hạn nhưng vẫn đang thực hiện. Bạn có thể tiếp tục góp hoặc cập nhật
                ngày đích.
              </p>
            ) : null}
            {detailGoal.displayStatus === 'PAUSED' ? (
              <p className="rounded-xl border border-warning-border bg-warning-soft p-3 text-xs text-warning-strong">
                Mục tiêu đang tạm dừng: không yêu cầu tiết kiệm thêm và không ghi nhận khoản góp
                mới.
              </p>
            ) : null}
            {detailGoal.status === 'COMPLETED' ? (
              <p className="rounded-xl border border-brand/30 bg-brand-soft p-3 text-xs text-brand-hover">
                Mục tiêu đã hoàn thành nên không cần tiết kiệm thêm.
              </p>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Các khoản đã góp</h3>
              {detailGoal.contributions.length === 0 ? (
                <p className="text-sm text-ink-muted">Chưa ghi nhận khoản góp nào.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {detailGoal.contributions.map((contribution) => (
                    <li
                      key={contribution.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {formatMoney(contribution.amount, detailGoal.currency)}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {formatDate(contribution.contributedAt, timezone)}
                          {contribution.note ? ` · ${contribution.note}` : ''}
                        </p>
                      </div>
                      {detailGoal.status !== 'ARCHIVED' ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              openContribution(detailGoal, contribution);
                              closeDetail();
                            }}
                            className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
                            aria-label="Sửa khoản góp"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteContribution(detailGoal, contribution)}
                            className="rounded-lg p-2 text-ink-muted hover:bg-expense/10 hover:text-expense"
                            aria-label="Xóa khoản góp"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <GoalProgressPanel
              goal={detailGoal}
              onChanged={() => void invalidate()}
              context={{
                page: 'goals',
                currency: detailGoal.currency,
                feature: 'goal-progress',
                label: 'Tiến độ mục tiêu',
              }}
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Lưu trữ mục tiêu"
        description={
          archiveTarget ? (
            <>
              Mục tiêu <strong>{archiveTarget.name}</strong> sẽ được ẩn khỏi danh sách. Các khoản
              góp đã ghi nhận vẫn được giữ lại và bạn có thể xem lại bằng mục “Hiện mục tiêu đã lưu
              trữ”.
            </>
          ) : null
        }
        confirmLabel="Lưu trữ"
        tone="primary"
        pending={archiveGoal.isPending}
        onClose={() => {
          if (!archiveGoal.isPending) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (!archiveTarget || archiveGoal.isPending) return;
          const id = archiveTarget.id;
          setArchiveTarget(null);
          archiveGoal.mutate(id);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Xoá khoản góp"
        description={
          deleteTarget ? (
            <>
              Xoá khoản góp{' '}
              <strong>
                {formatMoney(deleteTarget.contribution.amount, deleteTarget.goal.currency)}
              </strong>{' '}
              khỏi mục tiêu “{deleteTarget.goal.name}”? Số tiết kiệm của mục tiêu sẽ giảm tương ứng.
            </>
          ) : null
        }
        confirmLabel="Xoá khoản góp"
        tone="danger"
        pending={deleteContribution.isPending}
        onClose={() => {
          if (!deleteContribution.isPending) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget || deleteContribution.isPending) return;
          const target = deleteTarget;
          setDeleteTarget(null);
          deleteContribution.mutate({
            goalId: target.goal.id,
            contributionId: target.contribution.id,
          });
        }}
      />
    </div>
  );
}
