import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GoalDto } from '@smart-finance/shared-types';
import { GOAL_STATUS_LABELS } from '@smart-finance/shared-types';
import { Archive, HandCoins, Pencil, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { inputToIso } from '../lib/date';
import { formatDate, formatMoney } from '../lib/format';

const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

const goalSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên mục tiêu').max(80, 'Tối đa 80 ký tự'),
  targetAmount: z.string().regex(MONEY_REGEX, 'Số tiền không hợp lệ'),
  targetDate: z.string().optional(),
});

type GoalFormValues = z.infer<typeof goalSchema>;

const contributionSchema = z.object({
  amount: z.string().regex(MONEY_REGEX, 'Số tiền không hợp lệ'),
  contributedAt: z.string().min(1, 'Chọn ngày'),
  note: z.string().max(500, 'Tối đa 500 ký tự').optional(),
});

type ContributionFormValues = z.infer<typeof contributionSchema>;

export function GoalsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const currency = user?.defaultCurrency ?? 'VND';
  const queryClient = useQueryClient();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GoalDto | null>(null);
  const [contributing, setContributing] = useState<GoalDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const goalsQuery = useQuery({
    queryKey: ['goals', includeArchived],
    queryFn: () => api.get<{ items: GoalDto[] }>(`/goals?includeArchived=${includeArchived}`),
  });

  const goalForm = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: { name: '', targetAmount: '', targetDate: '' },
  });

  const contributionForm = useForm<ContributionFormValues>({
    resolver: zodResolver(contributionSchema),
    defaultValues: { amount: '', contributedAt: new Date().toISOString().slice(0, 10), note: '' },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['goals'] });
  };

  const saveGoal = useMutation({
    mutationFn: async (values: GoalFormValues) => {
      const payload = {
        name: values.name.trim(),
        targetAmount: values.targetAmount,
        ...(values.targetDate ? { targetDate: values.targetDate } : {}),
      };
      if (editing) return api.patch(`/goals/${editing.id}`, payload);
      return api.post('/goals', payload);
    },
    onSuccess: async () => {
      await invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const archiveGoal = useMutation({
    mutationFn: (id: string) => api.delete(`/goals/${id}`),
    onSuccess: invalidate,
    onError: (error) => setActionError(errorMessage(error)),
  });

  const addContribution = useMutation({
    mutationFn: async (values: ContributionFormValues) => {
      if (!contributing) throw new Error('Chưa chọn mục tiêu');
      return api.post(`/goals/${contributing.id}/contributions`, {
        amount: values.amount,
        contributedAt: inputToIso(`${values.contributedAt}T00:00`, timezone),
        ...(values.note?.trim() ? { note: values.note.trim() } : {}),
      });
    },
    onSuccess: async () => {
      await invalidate();
      setContributing(null);
    },
  });

  function openCreate() {
    setEditing(null);
    setFormError(null);
    goalForm.reset({ name: '', targetAmount: '', targetDate: '' });
    setFormOpen(true);
  }

  function openEdit(goal: GoalDto) {
    setEditing(goal);
    setFormError(null);
    goalForm.reset({
      name: goal.name,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate ?? '',
    });
    setFormOpen(true);
  }

  function openContribution(goal: GoalDto) {
    setActionError(null);
    contributionForm.reset({
      amount: '',
      contributedAt: new Date().toISOString().slice(0, 10),
      note: '',
    });
    setContributing(goal);
  }

  async function onSubmitGoal(values: GoalFormValues) {
    setFormError(null);
    try {
      await saveGoal.mutateAsync(values);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function onSubmitContribution(values: ContributionFormValues) {
    setActionError(null);
    try {
      await addContribution.mutateAsync(values);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  const goals = goalsQuery.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Mục tiêu tiết kiệm"
        description="Theo dõi số tiền đã dành riêng cho từng mục tiêu."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm mục tiêu
          </button>
        }
      />

      <div className="mb-4 flex justify-end">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Hiện mục tiêu đã lưu trữ
        </label>
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorAlert message={actionError} />
        </div>
      ) : null}

      {goalsQuery.isLoading ? (
        <Spinner label="Đang tải mục tiêu..." />
      ) : goalsQuery.error ? (
        <ErrorAlert
          message={errorMessage(goalsQuery.error)}
          onRetry={() => void goalsQuery.refetch()}
        />
      ) : goals.length === 0 ? (
        <EmptyState
          title="Chưa có mục tiêu"
          description="Tạo mục tiêu như mua laptop, quỹ khẩn cấp hay du lịch."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              Thêm mục tiêu
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.map((goal) => (
            <article
              key={goal.id}
              className={`card ${goal.status === 'ARCHIVED' ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
                    <Target className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{goal.name}</p>
                    <p className="text-xs text-slate-500">
                      {goal.targetDate
                        ? `Mục tiêu đến ${formatDate(goal.targetDate, timezone)}`
                        : 'Không đặt hạn'}
                    </p>
                  </div>
                </div>
                <Badge
                  tone={
                    goal.status === 'COMPLETED'
                      ? 'emerald'
                      : goal.status === 'ARCHIVED'
                        ? 'slate'
                        : 'sky'
                  }
                >
                  {GOAL_STATUS_LABELS[goal.status]}
                </Badge>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-800">
                    {formatMoney(goal.savedAmount, currency)}
                  </span>
                  <span className="text-slate-500">
                    / {formatMoney(goal.targetAmount, currency)}
                  </span>
                </div>
                <ProgressBar
                  value={goal.percentage}
                  tone={goal.status === 'COMPLETED' ? 'emerald' : 'amber'}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {Math.round(goal.percentage)}% · còn thiếu{' '}
                  {formatMoney(goal.remainingAmount, currency)}
                </p>
              </div>

              {goal.contributions.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {goal.contributions.slice(0, 3).map((contribution) => (
                    <li key={contribution.id} className="flex items-center justify-between">
                      <span>
                        {formatDate(contribution.contributedAt, timezone)}
                        {contribution.note ? ` · ${contribution.note}` : ''}
                      </span>
                      <span className="font-medium">
                        {formatMoney(contribution.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex gap-1 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => openContribution(goal)}
                  disabled={goal.status !== 'ACTIVE'}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                >
                  <HandCoins className="h-4 w-4" aria-hidden /> Góp thêm
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(goal)}
                  className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label={`Sửa ${goal.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {goal.status !== 'ARCHIVED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Lưu trữ mục tiêu "${goal.name}"?`))
                        archiveGoal.mutate(goal.id);
                    }}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    aria-label={`Lưu trữ ${goal.name}`}
                  >
                    <Archive className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
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
              Đã tiết kiệm {formatMoney(editing.savedAmount, currency)}. Thêm khoản góp bằng nút
              “Góp thêm”.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
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
        open={Boolean(contributing)}
        title={contributing ? `Góp vào "${contributing.name}"` : 'Góp tiền'}
        onClose={() => setContributing(null)}
      >
        <form
          className="space-y-4"
          onSubmit={contributionForm.handleSubmit(onSubmitContribution)}
          noValidate
        >
          {actionError ? <ErrorAlert message={actionError} /> : null}
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
            <button type="button" className="btn-secondary" onClick={() => setContributing(null)}>
              Huỷ
            </button>
            <button type="submit" className="btn-primary" disabled={addContribution.isPending}>
              {addContribution.isPending ? 'Đang lưu...' : 'Ghi nhận'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
