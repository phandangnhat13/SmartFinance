import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BudgetProgressDto, CategoryDto } from '@smart-finance/shared-types';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { currentMonthRange } from '../lib/date';
import { formatMoney } from '../lib/format';

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

function parseThresholds(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 200);
}

export function BudgetsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const defaultMonth = currentMonthRange(timezone).month;
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(defaultMonth);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetProgressDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    onSuccess: invalidate,
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

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <label className="label mb-0" htmlFor="budgetMonth">
          Tháng
        </label>
        <input
          id="budgetMonth"
          type="month"
          className="input max-w-[180px]"
          value={month}
          onChange={(event) => setMonth(event.target.value || defaultMonth)}
        />
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorAlert message={actionError} />
        </div>
      ) : null}

      {budgetsQuery.isLoading ? (
        <Spinner label="Đang tải ngân sách..." />
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
        <div className="grid gap-4 lg:grid-cols-2">
          {budgets.map((budget) => {
            const tone =
              budget.status === 'EXCEEDED'
                ? 'rose'
                : budget.status === 'WARNING'
                  ? 'amber'
                  : 'emerald';
            return (
              <article key={budget.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{budget.name}</p>
                    <p className="text-xs text-slate-500">
                      {budget.categoryName ?? 'Toàn bộ chi tiêu'} · {month}
                    </p>
                  </div>
                  <Badge tone={tone}>
                    {budget.status === 'EXCEEDED'
                      ? 'Vượt hạn mức'
                      : budget.status === 'WARNING'
                        ? 'Sắp chạm'
                        : 'Trong mức'}
                  </Badge>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      Đã chi {formatMoney(budget.spent, currency)}
                    </span>
                    <span className="font-semibold text-slate-800">
                      {Math.round(budget.percentage)}%
                    </span>
                  </div>
                  <ProgressBar value={budget.percentage} tone={tone} />
                  <p className="mt-1 text-xs text-slate-500">
                    Hạn mức {formatMoney(budget.limitAmount, currency)} · còn lại{' '}
                    {formatMoney(budget.remaining, currency)}
                  </p>
                </div>
                {budget.alerts.length > 0 ? (
                  <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    {budget.alerts.map((alert) => (
                      <li key={`${alert.threshold}-${alert.message}`}>{alert.message}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => openEdit(budget)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    aria-label={`Sửa ${budget.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Xoá ngân sách "${budget.name}"?`))
                        deleteMutation.mutate(budget.id);
                    }}
                    className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Xoá ${budget.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
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
              <label className="label" htmlFor="budgetThresholds">
                Mốc cảnh báo (%)
              </label>
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
    </div>
  );
}
