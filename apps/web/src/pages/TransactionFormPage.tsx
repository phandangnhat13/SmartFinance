import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountDto,
  AiAlternativeDto,
  AiSuggestionDto,
  CategoryDto,
  TransactionDto,
} from '@smart-finance/shared-types';
import { ArrowLeftRight, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ExplainButton } from '../components/Explain';
import { ErrorAlert, FieldError, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { inputToIso, isoToInput, nowInput } from '../lib/date';
import { transactionsTransfer } from '../lib/explanations';
import { formatMoney } from '../lib/format';

const MONEY_REGEX = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

const transactionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  accountId: z.string().uuid('Chọn tài khoản'),
  categoryId: z.string().uuid('Chọn danh mục'),
  amount: z
    .string()
    .regex(MONEY_REGEX, 'Số tiền không hợp lệ (lớn hơn 0, tối đa 2 chữ số thập phân)'),
  occurredAt: z.string().min(1, 'Chọn thời điểm'),
  description: z.string().trim().min(1, 'Nhập mô tả').max(500, 'Tối đa 500 ký tự'),
  note: z.string().max(1000, 'Tối đa 1000 ký tự').optional(),
});

type TransactionFormValues = z.infer<typeof transactionSchema>;

const transferSchema = z
  .object({
    fromAccountId: z.string().uuid('Chọn tài khoản nguồn'),
    toAccountId: z.string().uuid('Chọn tài khoản đích'),
    amount: z.string().regex(MONEY_REGEX, 'Số tiền không hợp lệ'),
    occurredAt: z.string().min(1, 'Chọn thời điểm'),
    description: z.string().trim().max(500, 'Tối đa 500 ký tự').optional(),
  })
  .refine((values) => values.fromAccountId !== values.toAccountId, {
    path: ['toAccountId'],
    message: 'Tài khoản đích phải khác tài khoản nguồn',
  });

type TransferFormValues = z.infer<typeof transferSchema>;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function TransactionFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ items: AccountDto[] }>('/accounts'),
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ items: CategoryDto[] }>('/categories'),
  });
  const transactionQuery = useQuery({
    queryKey: ['transactions', 'detail', id],
    queryFn: () => api.get<{ transaction: TransactionDto }>(`/transactions/${id}`),
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: 'EXPENSE',
      accountId: '',
      categoryId: '',
      amount: '',
      occurredAt: nowInput(timezone),
      description: '',
      note: '',
    },
  });

  const type = watch('type');
  const accountId = watch('accountId');
  const categoryId = watch('categoryId');
  const description = watch('description');

  useEffect(() => {
    const transaction = transactionQuery.data?.transaction;
    if (!transaction) return;
    reset({
      type: transaction.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
      accountId: transaction.accountId,
      categoryId: transaction.categoryId ?? '',
      amount: transaction.amount,
      occurredAt: isoToInput(transaction.occurredAt, timezone),
      description: transaction.description,
      note: transaction.note ?? '',
    });
  }, [transactionQuery.data, reset, timezone]);

  const categories = useMemo(
    () =>
      (categoriesQuery.data?.items ?? []).filter(
        (category) => !category.isArchived && category.type === type,
      ),
    [categoriesQuery.data, type],
  );

  const debouncedDescription = useDebouncedValue(description, 650);
  const aiEnabled = !isEdit && debouncedDescription.trim().length >= 3;

  const aiQuery = useQuery({
    queryKey: ['ai-suggestion', type, debouncedDescription],
    queryFn: () =>
      api.post<AiSuggestionDto>('/ai/classify-transaction', {
        description: debouncedDescription.trim(),
        type,
      }),
    enabled: aiEnabled,
    retry: false,
    staleTime: 60_000,
  });

  const suggestion = aiQuery.data;
  const usableSuggestion = suggestion?.categoryId ? suggestion : null;

  /**
   * Ranked candidates for a low-confidence answer, already resolved by the API
   * to categories the user can select. When the response carries none, the form
   * falls back to plain manual selection instead of guessing.
   */
  const lowConfidenceCandidates = useMemo<AiAlternativeDto[]>(
    () => (suggestion?.status === 'low_confidence' ? (suggestion.alternatives ?? []) : []),
    [suggestion],
  );

  const feedbackMutation = useMutation({
    mutationFn: (payload: {
      predictionId: string;
      action: 'ACCEPT' | 'CORRECT';
      categoryId?: string;
    }) =>
      api.post(`/ai/predictions/${payload.predictionId}/feedback`, {
        action: payload.action,
        ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
      }),
  });

  function sendFeedback(action: 'ACCEPT' | 'CORRECT', chosenCategoryId?: string) {
    if (!usableSuggestion?.predictionId) return;
    feedbackMutation.mutate({
      predictionId: usableSuggestion.predictionId,
      action,
      categoryId: action === 'CORRECT' ? chosenCategoryId : undefined,
    });
  }

  function applySuggestion() {
    if (!usableSuggestion?.categoryId) return;
    setValue('categoryId', usableSuggestion.categoryId, { shouldValidate: true });
    setAiApplied(true);
    sendFeedback('ACCEPT');
  }

  function handleCategoryChange(value: string) {
    setValue('categoryId', value, { shouldValidate: true });
    if (usableSuggestion && value !== usableSuggestion.categoryId) {
      sendFeedback('CORRECT', value);
    }
  }

  /**
   * Picking a ranked candidate is still the user's explicit choice; the
   * confidence was too low to fill the field automatically. The feedback record
   * records whether they confirmed the top label or chose another one.
   */
  function chooseAlternative(alternative: AiAlternativeDto) {
    setValue('categoryId', alternative.categoryId, { shouldValidate: true });
    if (!usableSuggestion?.predictionId) return;
    if (alternative.slug === usableSuggestion.slug) {
      sendFeedback('ACCEPT');
    } else {
      sendFeedback('CORRECT', alternative.categoryId);
    }
  }

  async function onSubmit(values: TransactionFormValues) {
    setSubmitError(null);
    const selectedAccount = accountsQuery.data?.items.find(
      (account) => account.id === values.accountId,
    );
    const payload = {
      accountId: values.accountId,
      categoryId: values.categoryId,
      type: values.type,
      amount: values.amount,
      occurredAt: inputToIso(values.occurredAt, timezone),
      description: values.description.trim(),
      note: values.note?.trim() || undefined,
      currency: selectedAccount?.currency ?? user?.defaultCurrency ?? 'VND',
      ...(!isEdit && aiApplied && usableSuggestion?.predictionId
        ? { aiPredictionId: usableSuggestion.predictionId }
        : {}),
    };
    try {
      if (isEdit) {
        await api.patch<{ transaction: TransactionDto }>(`/transactions/${id}`, {
          accountId: payload.accountId,
          categoryId: payload.categoryId,
          amount: payload.amount,
          occurredAt: payload.occurredAt,
          description: payload.description,
          note: payload.note,
        });
      } else {
        await api.post<{ transaction: TransactionDto }>('/transactions', payload);
      }
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['analytics'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['budgets'] });
      navigate('/transactions');
    } catch (error) {
      setSubmitError(errorMessage(error));
    }
  }

  if (isEdit && transactionQuery.isLoading) return <Spinner label="Đang tải giao dịch..." />;
  if (isEdit && transactionQuery.error) {
    return <ErrorAlert message={errorMessage(transactionQuery.error)} />;
  }
  if (isEdit && transactionQuery.data?.transaction.type === 'TRANSFER') {
    return (
      <ErrorAlert message="Không thể sửa trực tiếp giao dịch chuyển tiền. Hãy xoá và tạo lại." />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={isEdit ? 'Sửa giao dịch' : 'Thêm giao dịch'}
        description="Ghi lại khoản thu hoặc chi tiêu của bạn."
        actions={
          <Link to="/transactions" className="btn-secondary">
            <ArrowLeftRight className="h-4 w-4" aria-hidden /> Danh sách
          </Link>
        }
      />

      {submitError ? (
        <div className="mb-4">
          <ErrorAlert message={submitError} />
        </div>
      ) : null}

      <form className="card space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        {!isEdit ? (
          <div>
            <span className="label">Loại giao dịch</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setValue('type', 'EXPENSE');
                  setValue('categoryId', '');
                  setAiApplied(false);
                }}
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                  type === 'EXPENSE'
                    ? 'border-danger-border bg-danger-soft text-danger-strong'
                    : 'border-line-strong bg-surface text-ink-secondary'
                }`}
              >
                Chi tiêu
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue('type', 'INCOME');
                  setValue('categoryId', '');
                  setAiApplied(false);
                }}
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                  type === 'INCOME'
                    ? 'border-brand/30 bg-brand-soft text-brand-hover'
                    : 'border-line-strong bg-surface text-ink-secondary'
                }`}
              >
                Thu nhập
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="accountId">
              Tài khoản
            </label>
            <select id="accountId" className="input" {...register('accountId')}>
              <option value="">Chọn tài khoản</option>
              {accountsQuery.data?.items
                .filter((account) => !account.isArchived)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {formatMoney(account.balance, account.currency)}
                  </option>
                ))}
            </select>
            <FieldError message={errors.accountId?.message} />
          </div>
          <div>
            <label className="label" htmlFor="amount">
              Số tiền (
              {accountsQuery.data?.items.find((a) => a.id === accountId)?.currency ?? 'VND'})
            </label>
            <input
              id="amount"
              inputMode="decimal"
              className="input"
              placeholder="65000"
              {...register('amount')}
            />
            <FieldError message={errors.amount?.message} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="description">
            Mô tả
          </label>
          <input
            id="description"
            className="input"
            placeholder="Ví dụ: Ăn trưa văn phòng"
            {...register('description')}
          />
          <FieldError message={errors.description?.message} />
        </div>

        {aiQuery.isFetching ? (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI đang gợi ý danh mục...
          </p>
        ) : null}
        {usableSuggestion && suggestion?.status === 'ok' ? (
          <div className="rounded-xl border border-brand/30 bg-brand-soft p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-brand-hover">
              <Sparkles className="h-4 w-4" aria-hidden />
              AI gợi ý: {usableSuggestion.categoryName}
              {usableSuggestion.confidence !== null
                ? ` (${Math.round(usableSuggestion.confidence * 100)}%)`
                : ''}
            </p>
            <p className="mt-1 text-xs text-brand-hover">
              Đây chỉ là đề xuất — bạn có thể chọn danh mục khác.
            </p>
            <button
              type="button"
              onClick={applySuggestion}
              className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
            >
              Dùng gợi ý
            </button>
          </div>
        ) : null}
        {suggestion?.status === 'low_confidence' ? (
          <div
            className="rounded-xl border border-warning-border bg-warning-soft p-3 text-xs text-warning-strong"
            data-testid="ai-low-confidence"
          >
            <p>AI chưa chắc chắn về danh mục cho mô tả này. Vui lòng tự chọn danh mục.</p>
            {lowConfidenceCandidates.length > 0 ? (
              <>
                <p className="mt-2 text-warning-strong">
                  Gợi ý tham khảo — chưa đủ tin cậy để tự điền, bạn vẫn có thể chọn danh mục khác:
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {lowConfidenceCandidates.map((candidate) => (
                    <button
                      key={candidate.slug}
                      type="button"
                      onClick={() => chooseAlternative(candidate)}
                      className="rounded-lg border border-warning-border bg-surface px-2.5 py-1 font-medium text-warning-strong hover:bg-warning-soft"
                    >
                      {candidate.categoryName}
                      {candidate.confidence > 0
                        ? ` · ${Math.round(candidate.confidence * 100)}%`
                        : ''}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        {suggestion?.status === 'model_not_ready' ? (
          <p className="rounded-xl bg-surface-muted p-3 text-xs text-ink-secondary">
            AI tạm thời không khả dụng. Bạn vẫn có thể lưu giao dịch bình thường.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="categoryId">
              Danh mục
            </label>
            <select
              id="categoryId"
              className="input"
              value={categoryId}
              onChange={(event) => handleCategoryChange(event.target.value)}
            >
              <option value="">Chọn danh mục</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {category.isSystem ? '' : ' (riêng)'}
                </option>
              ))}
            </select>
            <FieldError message={errors.categoryId?.message} />
          </div>
          <div>
            <label className="label" htmlFor="occurredAt">
              Thời điểm
            </label>
            <input
              id="occurredAt"
              type="datetime-local"
              className="input"
              {...register('occurredAt')}
            />
            <FieldError message={errors.occurredAt?.message} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="note">
            Ghi chú (tuỳ chọn)
          </label>
          <textarea id="note" rows={2} className="input" {...register('note')} />
          <FieldError message={errors.note?.message} />
        </div>

        <div className="flex justify-end gap-2">
          <Link to="/transactions" className="btn-secondary">
            Huỷ
          </Link>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Đang lưu...' : isEdit ? 'Lưu thay đổi' : 'Thêm giao dịch'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TransferFormPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ items: AccountDto[] }>('/accounts'),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: '',
      toAccountId: '',
      amount: '',
      occurredAt: nowInput(timezone),
      description: '',
    },
  });

  async function onSubmit(values: TransferFormValues) {
    setSubmitError(null);
    try {
      await api.post('/transactions/transfers', {
        fromAccountId: values.fromAccountId,
        toAccountId: values.toAccountId,
        amount: values.amount,
        occurredAt: inputToIso(values.occurredAt, timezone),
        description: values.description?.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['analytics'] });
      navigate('/transactions');
    } catch (error) {
      setSubmitError(errorMessage(error));
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Chuyển tiền nội bộ"
        description="Chuyển giữa hai tài khoản của bạn. Giao dịch được ghi nhận nguyên tử."
        actions={
          <>
            <ExplainButton explanation={transactionsTransfer} label="Cách hoạt động" />
            <Link to="/transactions" className="btn-secondary">
              Danh sách
            </Link>
          </>
        }
      />
      {submitError ? (
        <div className="mb-4">
          <ErrorAlert message={submitError} />
        </div>
      ) : null}
      <form className="card space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="fromAccountId">
              Từ tài khoản
            </label>
            <select id="fromAccountId" className="input" {...register('fromAccountId')}>
              <option value="">Chọn tài khoản</option>
              {accountsQuery.data?.items
                .filter((account) => !account.isArchived)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
            <FieldError message={errors.fromAccountId?.message} />
          </div>
          <div>
            <label className="label" htmlFor="toAccountId">
              Đến tài khoản
            </label>
            <select id="toAccountId" className="input" {...register('toAccountId')}>
              <option value="">Chọn tài khoản</option>
              {accountsQuery.data?.items
                .filter((account) => !account.isArchived)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
            <FieldError message={errors.toAccountId?.message} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="transferAmount">
              Số tiền
            </label>
            <input
              id="transferAmount"
              inputMode="decimal"
              className="input"
              placeholder="1000000"
              {...register('amount')}
            />
            <FieldError message={errors.amount?.message} />
          </div>
          <div>
            <label className="label" htmlFor="transferTime">
              Thời điểm
            </label>
            <input
              id="transferTime"
              type="datetime-local"
              className="input"
              {...register('occurredAt')}
            />
            <FieldError message={errors.occurredAt?.message} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="transferDescription">
            Mô tả (tuỳ chọn)
          </label>
          <input
            id="transferDescription"
            className="input"
            placeholder="Chuyển tiền nội bộ"
            {...register('description')}
          />
          <FieldError message={errors.description?.message} />
        </div>
        <div className="flex justify-end gap-2">
          <Link to="/transactions" className="btn-secondary">
            Huỷ
          </Link>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Đang chuyển...' : 'Chuyển tiền'}
          </button>
        </div>
      </form>
    </div>
  );
}
