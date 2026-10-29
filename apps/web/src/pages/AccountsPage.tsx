import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountDto, AccountType } from '@smart-finance/shared-types';
import { ACCOUNT_TYPE_LABELS } from '@smart-finance/shared-types';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
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
  Spinner,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/format';

const BALANCE_REGEX = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;
const ACCOUNT_TYPES: AccountType[] = ['CASH', 'BANK', 'E_WALLET', 'OTHER'];

const schema = z.object({
  name: z.string().trim().min(1, 'Nhập tên tài khoản').max(80, 'Tối đa 80 ký tự'),
  type: z.enum(['CASH', 'BANK', 'E_WALLET', 'OTHER']),
  initialBalance: z.string().regex(BALANCE_REGEX, 'Số dư ban đầu không hợp lệ'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Tiền tệ phải là 3 ký tự, ví dụ VND'),
});

type FormValues = z.infer<typeof schema>;

export function AccountsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts', includeArchived],
    queryFn: () => api.get<{ items: AccountDto[] }>(`/accounts?includeArchived=${includeArchived}`),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      type: 'BANK',
      initialBalance: '0',
      currency: user?.defaultCurrency ?? 'VND',
    },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    await queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editing) {
        return api.patch(`/accounts/${editing.id}`, values);
      }
      return api.post('/accounts', values);
    },
    onSuccess: async () => {
      await invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (account: AccountDto) =>
      api.patch(`/accounts/${account.id}`, { isArchived: !account.isArchived }),
    onSuccess: invalidate,
    onError: (error) => setActionError(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/accounts/${id}`),
    onSuccess: invalidate,
    onError: (error) => setActionError(errorMessage(error)),
  });

  function openCreate() {
    setEditing(null);
    setFormError(null);
    reset({
      name: '',
      type: 'BANK',
      initialBalance: '0',
      currency: user?.defaultCurrency ?? 'VND',
    });
    setFormOpen(true);
  }

  function openEdit(account: AccountDto) {
    setEditing(account);
    setFormError(null);
    reset({
      name: account.name,
      type: account.type,
      initialBalance: account.initialBalance,
      currency: account.currency,
    });
    setFormOpen(true);
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await saveMutation.mutateAsync({
        ...values,
        name: values.name.trim(),
        currency: values.currency.toUpperCase(),
      });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function handleDelete(account: AccountDto) {
    if (
      !window.confirm(
        `Xoá vĩnh viễn tài khoản "${account.name}"? Chỉ xoá được khi chưa có giao dịch.`,
      )
    )
      return;
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(account.id);
    } catch {
      // error surfaced through onError
    }
  }

  const accounts = accountsQuery.data?.items ?? [];
  const total = accounts
    .filter((account) => !account.isArchived)
    .reduce((sum, account) => sum + Number(account.balance), 0);

  return (
    <div>
      <PageHeader
        title="Tài khoản"
        description="Số dư được tính từ giao dịch: số dư ban đầu + thu − chi − chuyển đi + chuyển vào."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm tài khoản
          </button>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Tổng số dư (tài khoản đang dùng)</p>
          <p className="text-2xl font-bold text-slate-900">
            {formatMoney(String(total), user?.defaultCurrency ?? 'VND')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Hiện tài khoản đã lưu trữ
        </label>
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorAlert message={actionError} />
        </div>
      ) : null}

      {accountsQuery.isLoading ? (
        <Spinner label="Đang tải tài khoản..." />
      ) : accountsQuery.error ? (
        <ErrorAlert
          message={errorMessage(accountsQuery.error)}
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          title="Chưa có tài khoản"
          description="Thêm tài khoản tiền mặt, ngân hàng hoặc ví điện tử để bắt đầu."
          action={
            <button type="button" className="btn-primary" onClick={openCreate}>
              Thêm tài khoản
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <article key={account.id} className={`card ${account.isArchived ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Wallet className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{account.name}</p>
                    <p className="text-xs text-slate-500">{ACCOUNT_TYPE_LABELS[account.type]}</p>
                  </div>
                </div>
                {account.isArchived ? <Badge tone="slate">Đã lưu trữ</Badge> : null}
              </div>
              <p className="mt-4 text-xl font-bold text-slate-900">
                {formatMoney(account.balance, account.currency)}
              </p>
              <p className="text-xs text-slate-500">
                Ban đầu: {formatMoney(account.initialBalance, account.currency)}
              </p>
              <div className="mt-4 flex gap-1 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => openEdit(account)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label={`Sửa ${account.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => archiveMutation.mutate(account)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label={
                    account.isArchived ? `Khôi phục ${account.name}` : `Lưu trữ ${account.name}`
                  }
                >
                  {account.isArchived ? (
                    <ArchiveRestore className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(account)}
                  className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Xoá ${account.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Sửa tài khoản' : 'Thêm tài khoản'}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      >
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError ? <ErrorAlert message={formError} /> : null}
          <div>
            <label className="label" htmlFor="accountName">
              Tên tài khoản
            </label>
            <input
              id="accountName"
              className="input"
              placeholder="Vietcombank"
              {...register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="accountType">
                Loại
              </label>
              <select id="accountType" className="input" {...register('type')}>
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ACCOUNT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <FieldError message={errors.type?.message} />
            </div>
            <div>
              <label className="label" htmlFor="accountCurrency">
                Tiền tệ
              </label>
              <input
                id="accountCurrency"
                className="input"
                maxLength={3}
                {...register('currency')}
              />
              <FieldError message={errors.currency?.message} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="initialBalance">
              Số dư ban đầu
            </label>
            <input
              id="initialBalance"
              inputMode="decimal"
              className="input"
              {...register('initialBalance')}
            />
            <FieldError message={errors.initialBalance?.message} />
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
