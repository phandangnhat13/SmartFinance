import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BudgetProgressDto, CategoryDto } from '@smart-finance/shared-types';
import { AlertTriangle, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  FieldError,
  HelpTip,
  Modal,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatCard,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { AiChatContext } from '../lib/ai-chat-context';
import { api, errorMessage } from '../lib/api';
import { calendarMonthRange, currentMonthRange } from '../lib/date';
import {
  budgetsRemaining,
  budgetsSpent,
  budgetsUtilization,
  budgetsWarningThresholds,
} from '../lib/explanations';
import { formatMoney } from '../lib/format';
import { useMediaQuery } from '../lib/useMediaQuery';

const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

const schema = z.object({
  name: z.string().trim().min(1, 'Nhập tên ngân sách').max(80, 'Tối đa 80 ký tự'),
  categoryId: z.string().optional(),
  limitAmount: z.string().regex(MONEY_REGEX, 'Hạn mức không hợp lệ'),
  thresholds: z
    .string()
    .regex(/^\d{1,3}(,\s*\d{1,3})*$/, 'Nhập các mốc cách nhau bởi dấu phẩy, ví dụ 80,100'),
});

type FormValues = z.infer<typeof schema>;
type StatusFilter = 'all' | BudgetProgressDto['status'];

const STATUS_LABELS: Record<BudgetProgressDto['status'], string> = {
  OK: 'Trong mức',
  WARNING: 'Sắp chạm',
  EXCEEDED: 'Vượt hạn mức',
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'OK', label: 'Trong mức' },
  { value: 'WARNING', label: 'Sắp chạm' },
  { value: 'EXCEEDED', label: 'Vượt hạn mức' },
];

function parseThresholds(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 200);
}

function statusTone(status: BudgetProgressDto['status']): 'emerald' | 'amber' | 'rose' {
  if (status === 'EXCEEDED') return 'rose';
  if (status === 'WARNING') return 'amber';
  return 'emerald';
}

function BudgetActions({
  budget,
  onEdit,
  onDelete,
}: {
  budget: BudgetProgressDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="icon-btn"
        aria-label={`Sửa ${budget.name}`}
        title="Sửa"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="icon-btn text-danger hover:bg-danger-soft"
        aria-label={`Xoá ${budget.name}`}
        title="Xoá"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function BudgetAlerts({ budget }: { budget: BudgetProgressDto }) {
  if (budget.alerts.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning-strong">
      {budget.alerts.map((alert) => (
        <li key={`${alert.threshold}-${alert.message}`} className="flex gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{alert.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function BudgetsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const defaultMonth = currentMonthRange(timezone).month;
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [month, setMonth] = useState(defaultMonth);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetProgressDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BudgetProgressDto | null>(null);

  const budgetsQuery = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => api.get<{ items: BudgetProgressDto[] }>(`/budgets?month=${month}`),
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', 'EXPENSE'],
    queryFn: () => api.get<{ items: CategoryDto[] }>('/categories?type=EXPENSE'),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', categoryId: '', limitAmount: '', thresholds: '80,100' },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['budgets'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name.trim(),
        limitAmount: values.limitAmount,
        warningThresholds: parseThresholds(values.thresholds),
        ...(values.categoryId ? { categoryId: values.categoryId } : {}),
      };
      if (editing) return api.patch(`/budgets/${editing.id}`, payload);
      return api.post('/budgets', { ...payload, month });
    },
    onSuccess: async () => {
      await invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/budgets/${id}`),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  function openCreate() {
    setEditing(null);
    setFormError(null);
    reset({ name: '', categoryId: '', limitAmount: '', thresholds: '80,100' });
    setFormOpen(true);
  }

  function openEdit(budget: BudgetProgressDto) {
    setEditing(budget);
    setFormError(null);
    reset({
      name: budget.name,
      categoryId: budget.categoryId ?? '',
      limitAmount: budget.limitAmount,
      thresholds: '80,100',
    });
    setFormOpen(true);
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await saveMutation.mutateAsync(values);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  const budgets = budgetsQuery.data?.items ?? [];
  const currency = user?.defaultCurrency ?? 'VND';
  const context: AiChatContext = {
    page: 'budgets',
    currency,
    dateRange: calendarMonthRange(month),
  };

  const counts = {
    OK: budgets.filter((budget) => budget.status === 'OK').length,
    WARNING: budgets.filter((budget) => budget.status === 'WARNING').length,
    EXCEEDED: budgets.filter((budget) => budget.status === 'EXCEEDED').length,
  };
  // Display-only sums of the amounts the API already returns for each budget.
  const totalLimit = budgets.reduce((sum, budget) => sum + Number(budget.limitAmount), 0);
  const totalSpent = budgets.reduce((sum, budget) => sum + Number(budget.spent), 0);
  const totalRemaining = budgets.reduce((sum, budget) => sum + Number(budget.remaining), 0);
  const needsAttention = counts.WARNING + counts.EXCEEDED;

  const visibleBudgets =
    statusFilter === 'all' ? budgets : budgets.filter((budget) => budget.status === statusFilter);

  return (
    <div>
      <PageHeader
        title="Ngân sách"
        description="Đặt hạn mức chi tiêu theo danh mục cho từng tháng."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm ngân sách
          </button>
        }
      />

      <section className="card mb-4" aria-label="Bộ lọc ngân sách">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="budgetMonth">
              Tháng
            </label>
            <input
              id="budgetMonth"
              type="month"
              className="input"
              value={month}
              onChange={(event) => setMonth(event.target.value || defaultMonth)}
            />
          </div>
          <div>
            <label className="label" htmlFor="budgetStatus">
              Trạng thái
            </label>
            <select
              id="budgetStatus"
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <p className="text-xs text-ink-muted">
              {budgets.length} ngân sách trong tháng {month}
            </p>
          </div>
        </div>
      </section>

      {actionError ? (
        <div className="mb-4">
          <ErrorAlert message={actionError} />
        </div>
      ) : null}

      {budgetsQuery.isLoading ? (
        <div role="status" aria-label="Đang tải ngân sách">
          <p className="sr-only">Đang tải ngân sách...</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
          <Skeleton className="mt-4 h-72" />
        </div>
      ) : budgetsQuery.error ? (
        <ErrorAlert
          message={errorMessage(budgetsQuery.error)}
          onRetry={() => void budgetsQuery.refetch()}
        />
      ) : budgets.length === 0 ? (
        <EmptyState
          title="Chưa có ngân sách cho tháng này"
          description="Tạo ngân sách tổng hoặc theo danh mục để theo dõi giới hạn chi tiêu."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              Thêm ngân sách
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Tổng hạn mức"
              value={formatMoney(totalLimit, currency)}
              icon={<Wallet className="h-5 w-5 text-brand" />}
              hint={`${budgets.length} ngân sách · tháng ${month}`}
            />
            <StatCard
              label="Đã chi"
              value={formatMoney(totalSpent, currency)}
              explain={budgetsSpent}
              explainContext={{
                ...context,
                feature: 'spent',
                label: 'Đã chi trong tháng',
                selectedMetric: 'Đã chi',
                displayedValue: formatMoney(totalSpent, currency),
              }}
            />
            <StatCard
              label="Còn lại"
              value={formatMoney(totalRemaining, currency)}
              valueClass={totalRemaining < 0 ? 'text-danger' : 'text-brand-hover'}
              explain={budgetsRemaining}
              explainContext={{
                ...context,
                feature: 'remaining',
                label: 'Còn lại trong tháng',
                selectedMetric: 'Còn lại',
                displayedValue: formatMoney(totalRemaining, currency),
              }}
            />
            <StatCard
              label="Cần chú ý"
              value={String(needsAttention)}
              icon={<AlertTriangle className="h-5 w-5 text-warning" />}
              hint={`${counts.EXCEEDED} vượt hạn mức · ${counts.WARNING} sắp chạm`}
              explain={budgetsUtilization}
              explainContext={{
                ...context,
                feature: 'utilization',
                label: 'Ngân sách cần chú ý',
                selectedMetric: 'Số ngân sách cần chú ý',
                displayedValue: String(needsAttention),
              }}
            />
          </div>

          <section className="mt-4" aria-label="Danh sách ngân sách">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="section-title">Danh sách ngân sách</h2>
              <p className="text-xs text-ink-muted">
                Hiển thị {visibleBudgets.length}/{budgets.length} ngân sách
              </p>
            </div>

            {visibleBudgets.length === 0 ? (
              <div className="card flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
                <p>Không có ngân sách ở trạng thái này trong tháng {month}.</p>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setStatusFilter('all')}
                >
                  Xoá bộ lọc
                </button>
              </div>
            ) : isDesktop ? (
              <div className="card overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">
                    Ngân sách tháng {month}: hạn mức, đã chi, còn lại, tiến độ và trạng thái
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th scope="col" className="px-4 py-3 font-medium">
                        Ngân sách
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Hạn mức
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Đã chi
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Còn lại
                      </th>
                      <th scope="col" className="w-48 px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          Tiến độ
                          <HelpTip
                            label="mức sử dụng ngân sách"
                            explanation={budgetsUtilization}
                            explainContext={{
                              ...context,
                              feature: 'utilization',
                              label: 'Mức sử dụng ngân sách',
                            }}
                          />
                        </span>
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Trạng thái
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Thao tác
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visibleBudgets.map((budget) => {
                      const tone = statusTone(budget.status);
                      return (
                        <tr key={budget.id} className="align-top hover:bg-surface-muted/60">
                          <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                            <span className="block">{budget.name}</span>
                            <span className="block text-xs font-normal text-ink-muted">
                              {budget.categoryName ?? 'Toàn bộ chi tiêu'}
                            </span>
                          </th>
                          <td className="px-4 py-3 text-right text-ink-secondary">
                            {formatMoney(budget.limitAmount, currency)}
                          </td>
                          <td className="px-4 py-3 text-right text-ink">
                            {formatMoney(budget.spent, currency)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${
                              Number(budget.remaining) < 0 ? 'text-danger' : 'text-ink-secondary'
                            }`}
                          >
                            {formatMoney(budget.remaining, currency)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <ProgressBar
                                value={budget.percentage}
                                tone={tone}
                                label={`Tiến độ ${budget.name}`}
                              />
                              <span className="w-10 shrink-0 text-right text-xs text-ink-muted">
                                {Math.round(budget.percentage)}%
                              </span>
                            </div>
                            <BudgetAlerts budget={budget} />
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={tone}>{STATUS_LABELS[budget.status]}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <BudgetActions
                              budget={budget}
                              onEdit={() => openEdit(budget)}
                              onDelete={() => setDeleteTarget(budget)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {visibleBudgets.map((budget) => {
                  const tone = statusTone(budget.status);
                  return (
                    <li key={budget.id} className="card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{budget.name}</p>
                          <p className="text-xs text-ink-muted">
                            {budget.categoryName ?? 'Toàn bộ chi tiêu'} · {month}
                          </p>
                        </div>
                        <Badge tone={tone}>{STATUS_LABELS[budget.status]}</Badge>
                      </div>
                      <div className="mt-4">
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="text-ink-secondary">
                            Đã chi {formatMoney(budget.spent, currency)}
                          </span>
                          <span className="font-semibold text-ink">
                            {Math.round(budget.percentage)}%
                          </span>
                        </div>
                        <ProgressBar value={budget.percentage} tone={tone} />
                        <p className="mt-1 text-xs text-ink-muted">
                          Hạn mức {formatMoney(budget.limitAmount, currency)} · còn lại{' '}
                          {formatMoney(budget.remaining, currency)}
                        </p>
                      </div>
                      <BudgetAlerts budget={budget} />
                      <div className="mt-3 flex justify-end border-t border-line pt-2">
                        <BudgetActions
                          budget={budget}
                          onEdit={() => openEdit(budget)}
                          onDelete={() => setDeleteTarget(budget)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Sửa ngân sách' : `Thêm ngân sách tháng ${month}`}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      >
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError ? <ErrorAlert message={formError} /> : null}
          <div>
            <label className="label" htmlFor="budgetName">
              Tên ngân sách
            </label>
            <input
              id="budgetName"
              className="input"
              placeholder="Ngân sách ăn uống"
              {...register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>
          <div>
            <label className="label" htmlFor="budgetCategory">
              Danh mục (bỏ trống = tổng)
            </label>
            <select
              id="budgetCategory"
              className="input"
              {...register('categoryId')}
              disabled={Boolean(editing)}
            >
              <option value="">Toàn bộ chi tiêu</option>
              {categoriesQuery.data?.items
                .filter((category) => !category.isArchived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="budgetLimit">
                Hạn mức
              </label>
              <input
                id="budgetLimit"
                inputMode="decimal"
                className="input"
                placeholder="3000000"
                {...register('limitAmount')}
              />
              <FieldError message={errors.limitAmount?.message} />
            </div>
            <div>
              <span className="flex items-center gap-1.5">
                <label className="label" htmlFor="budgetThresholds">
                  Mốc cảnh báo (%)
                </label>
                <HelpTip
                  label="Mốc cảnh báo"
                  explanation={budgetsWarningThresholds}
                  explainContext={{
                    ...context,
                    feature: 'warning-thresholds',
                    label: 'Mốc cảnh báo ngân sách',
                  }}
                />
              </span>
              <input
                id="budgetThresholds"
                className="input"
                placeholder="80,100"
                {...register('thresholds')}
              />
              <FieldError message={errors.thresholds?.message} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              Huỷ
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Xoá ngân sách"
        description={
          deleteTarget
            ? `Ngân sách "${deleteTarget.name}" sẽ bị xoá khỏi tháng ${month}. Các giao dịch đã ghi không bị ảnh hưởng.`
            : ''
        }
        confirmLabel="Xoá ngân sách"
        pending={deleteMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
