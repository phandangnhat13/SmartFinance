import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GoalContributionDto,
  GoalDisplayStatus,
  GoalDto,
  InsightsMonthlyDto,
} from '@smart-finance/shared-types';
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
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import {
  Badge,
  EmptyState,
  ErrorAlert,
  FieldError,
  Modal,
  PageHeader,
  ProgressBar,
  Spinner,
} from '../components/ui';
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
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

interface ReferenceFigures {
  months: number;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
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

  const summary = useMemo(() => {
    const totals = visibleGoals.reduce(
      (acc, goal) => ({
        target: acc.target + Number(goal.targetAmount),
        saved: acc.saved + Number(goal.savedAmount),
        remaining: acc.remaining + Number(goal.remainingAmount),
        overdue: acc.overdue + (goal.displayStatus === 'OVERDUE' ? 1 : 0),
        active: acc.active + (goal.displayStatus === 'ACTIVE' ? 1 : 0),
        paused: acc.paused + (goal.displayStatus === 'PAUSED' ? 1 : 0),
        completed: acc.completed + (goal.status === 'COMPLETED' ? 1 : 0),
      }),
      { target: 0, saved: 0, remaining: 0, overdue: 0, active: 0, paused: 0, completed: 0 },
    );
    return {
      ...totals,
      percentage: totals.target > 0 ? (totals.saved / totals.target) * 100 : 0,
    };
  }, [visibleGoals]);

  // Reference figures come from the existing Financial Insights endpoint; they
  // are never written into a goal's saved amount.
  const monthlyQuery = useQuery({
    queryKey: ['goals-insights', currency],
    queryFn: () => api.get<InsightsMonthlyDto>(`/insights/monthly?months=6&currency=${currency}`),
    enabled: Boolean(currency) && goals.length > 0,
    retry: false,
  });

  const reference = useMemo<ReferenceFigures | null>(() => {
    const months = (monthlyQuery.data?.months ?? []).filter((month) => month.hasTransactions);
    if (months.length === 0) return null;
    const income = months.reduce((sum, month) => sum + Number(month.income), 0) / months.length;
    const expense = months.reduce((sum, month) => sum + Number(month.expense), 0) / months.length;
    const net = income - expense;
    return {
      months: months.length,
      income,
      expense,
      net,
      savingsRate: income > 0 ? (net / income) * 100 : null,
    };
  }, [monthlyQuery.data]);

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

  function confirmArchive(goal: GoalDto) {
    if (window.confirm(`Lưu trữ mục tiêu "${goal.name}"?`)) archiveGoal.mutate(goal.id);
  }

  function confirmDeleteContribution(goal: GoalDto, contribution: GoalContributionDto) {
    if (window.confirm(`Xóa khoản góp ${formatMoney(contribution.amount, goal.currency)}?`)) {
      deleteContribution.mutate({ goalId: goal.id, contributionId: contribution.id });
    }
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
          <label className="flex items-center gap-2 text-sm text-slate-600">
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
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
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
          <section className="mb-6" aria-label="Tổng quan tiến độ">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card">
                <p className="text-xs text-slate-500">Tổng mục tiêu</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {formatMoney(summary.target, currency)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{visibleGoals.length} mục tiêu</p>
              </div>
              <div className="card">
                <p className="text-xs text-slate-500">Đã tiết kiệm</p>
                <p className="mt-1 text-xl font-semibold text-emerald-700">
                  {formatMoney(summary.saved, currency)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {summary.active} đang thực hiện · {summary.overdue} quá hạn
                </p>
              </div>
              <div className="card">
                <p className="text-xs text-slate-500">Còn thiếu</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {formatMoney(summary.remaining, currency)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {summary.paused} tạm dừng · {summary.completed} hoàn thành
                </p>
              </div>
              <div className="card">
                <p className="text-xs text-slate-500">Tiến độ chung</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {Math.round(summary.percentage)}%
                </p>
                <div className="mt-2">
                  <ProgressBar value={summary.percentage} tone="emerald" />
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Số liệu chỉ tính cho mục tiêu bằng {currency}; không quy đổi giữa các tiền tệ.
            </p>
          </section>

          <section className="card mb-6" aria-label="Số liệu tham khảo">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-sky-600" aria-hidden />
                <h2 className="text-sm font-semibold text-slate-900">
                  Tham khảo từ Phân tích tài chính
                </h2>
              </div>
              <Link to="/insights" className="text-xs font-medium text-sky-700 hover:underline">
                Xem chi tiết phân tích
              </Link>
            </div>
            {monthlyQuery.isLoading ? (
              <p className="mt-3 text-sm text-slate-500">Đang tải số liệu tham khảo...</p>
            ) : monthlyQuery.error ? (
              <p className="mt-3 text-sm text-slate-500">
                Chưa thể tải số liệu tham khảo từ Phân tích.
              </p>
            ) : reference ? (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Thu nhập TB/tháng" value={formatMoney(reference.income, currency)} />
                  <Stat
                    label="Chi tiêu TB/tháng"
                    value={formatMoney(reference.expense, currency)}
                  />
                  <Stat
                    label="Dòng tiền ròng TB/tháng"
                    value={formatMoney(reference.net, currency)}
                  />
                  <Stat
                    label="Tỷ lệ tiết kiệm TB"
                    value={
                      reference.savingsRate === null ? '—' : `${reference.savingsRate.toFixed(1)}%`
                    }
                  />
                </div>
                <p className="mt-3 text-sm text-slate-700">
                  {reference.net > 0
                    ? `Khả năng tiết kiệm tham khảo: ${formatMoney(reference.net, currency)}/tháng, dựa trên ${reference.months} tháng có giao dịch gần nhất.`
                    : `Dòng tiền ròng trung bình không dương trong ${reference.months} tháng có giao dịch gần nhất, nên chưa có khả năng tiết kiệm tham khảo.`}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Chưa có giao dịch {currency} để tính số liệu tham khảo.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Đây là số liệu tham khảo từ các giao dịch đã ghi nhận, không được cộng tự động vào số
              tiền đã tiết kiệm và không phải cam kết bạn chắc chắn tiết kiệm được số tiền này.
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {visibleGoals.map((goal) => (
              <article
                key={goal.id}
                className={`card ${goal.status === 'ARCHIVED' ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700">
                      <Target className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{goal.name}</p>
                      <p className="text-xs text-slate-500">
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
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">{goal.description}</p>
                ) : null}

                <div className="mt-4">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 text-sm">
                    <span className="font-semibold text-slate-800">
                      {formatMoney(goal.savedAmount, goal.currency)}
                    </span>
                    <span className="text-slate-500">
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
                  <p className="mt-1 text-xs text-slate-500">
                    {Math.round(goal.percentage)}%
                    {goal.status !== 'COMPLETED'
                      ? ` · còn thiếu ${formatMoney(goal.remainingAmount, goal.currency)}`
                      : ' · đã hoàn thành'}
                  </p>
                  {goal.displayStatus === 'OVERDUE' ? (
                    <p className="mt-1 text-xs font-medium text-rose-600">
                      Đã quá hạn
                      {goal.targetDate ? ` từ ${formatDate(goal.targetDate, timezone)}` : ''}.
                    </p>
                  ) : null}
                  {goal.displayStatus === 'PAUSED' ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Đang tạm dừng nên không yêu cầu tiết kiệm thêm.
                    </p>
                  ) : null}
                  {goal.requiredMonthlySaving && Number(goal.requiredMonthlySaving) > 0 ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Cần tiết kiệm {formatMoney(goal.requiredMonthlySaving, goal.currency)}/tháng.
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => openDetail(goal)}
                    className="rounded-lg px-2 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50"
                  >
                    Chi tiết
                  </button>
                  <button
                    type="button"
                    onClick={() => openContribution(goal)}
                    disabled={goal.status !== 'ACTIVE'}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                  >
                    <HandCoins className="h-4 w-4" aria-hidden /> Góp thêm
                  </button>
                  {goal.status !== 'ARCHIVED' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(goal)}
                        className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        aria-label={`Sửa ${goal.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmArchive(goal)}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
                <p className="mt-1 text-xs text-slate-500">Không thể đổi tiền tệ sau khi tạo.</p>
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
                <p className="mt-1 text-xs text-slate-500">Đã khóa vì mục tiêu đã có khoản góp.</p>
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
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
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
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
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
        open={detailGoal !== null}
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
                  onClick={() => confirmArchive(detailGoal)}
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
              <span className="text-sm font-medium text-slate-600">{detailGoal.currency}</span>
            </div>
            {detailGoal.description ? (
              <p className="text-sm text-slate-600">{detailGoal.description}</p>
            ) : null}
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 text-sm">
                <span className="font-semibold text-slate-800">
                  {formatMoney(detailGoal.savedAmount, detailGoal.currency)}
                </span>
                <span className="text-slate-500">
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
              <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                Mục tiêu đã quá hạn nhưng vẫn đang thực hiện. Bạn có thể tiếp tục góp hoặc cập nhật
                ngày đích.
              </p>
            ) : null}
            {detailGoal.displayStatus === 'PAUSED' ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Mục tiêu đang tạm dừng: không yêu cầu tiết kiệm thêm và không ghi nhận khoản góp
                mới.
              </p>
            ) : null}
            {detailGoal.status === 'COMPLETED' ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                Mục tiêu đã hoàn thành nên không cần tiết kiệm thêm.
              </p>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Các khoản đã góp</h3>
              {detailGoal.contributions.length === 0 ? (
                <p className="text-sm text-slate-500">Chưa ghi nhận khoản góp nào.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {detailGoal.contributions.map((contribution) => (
                    <li
                      key={contribution.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {formatMoney(contribution.amount, detailGoal.currency)}
                        </p>
                        <p className="text-xs text-slate-500">
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
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            aria-label="Sửa khoản góp"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => confirmDeleteContribution(detailGoal, contribution)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
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
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
