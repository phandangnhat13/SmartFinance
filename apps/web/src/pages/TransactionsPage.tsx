import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountDto,
  CategoryDto,
  PaginatedDto,
  TransactionDto,
  TransactionType,
} from '@smart-finance/shared-types';
import { ArrowLeftRight, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, ErrorAlert, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, downloadFile, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';

const PAGE_SIZE = 20;

export function TransactionsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const queryClient = useQueryClient();

  const [type, setType] = useState<TransactionType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ items: AccountDto[] }>('/accounts'),
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ items: CategoryDto[] }>('/categories'),
  });

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (type) params.set('type', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (search.trim()) params.set('q', search.trim());
  if (accountId) params.set('accountId', accountId);
  if (categoryId) params.set('categoryId', categoryId);

  const transactionsQuery = useQuery({
    queryKey: ['transactions', params.toString()],
    queryFn: () => api.get<PaginatedDto<TransactionDto>>(`/transactions?${params.toString()}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/transactions/${id}`),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['analytics'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  function resetFilters() {
    setType('');
    setFrom('');
    setTo('');
    setSearch('');
    setAccountId('');
    setCategoryId('');
    setPage(1);
  }

  async function handleDelete(transaction: TransactionDto) {
    const message =
      transaction.type === 'TRANSFER'
        ? 'Xoá chuyển tiền này sẽ xoá cả hai vế. Tiếp tục?'
        : `Xoá giao dịch "${transaction.description}"?`;
    if (!window.confirm(message)) return;
    await deleteMutation.mutateAsync(transaction.id).catch(() => undefined);
  }

  const result = transactionsQuery.data;
  const categoryOptions = categoriesQuery.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Giao dịch"
        description="Theo dõi, lọc và quản lý các khoản thu chi."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void downloadFile('/exports/transactions.csv', 'transactions.csv')}
            >
              <Download className="h-4 w-4" aria-hidden /> Xuất CSV
            </button>
            <Link to="/transactions/transfer" className="btn-secondary">
              <ArrowLeftRight className="h-4 w-4" aria-hidden /> Chuyển tiền
            </Link>
            <Link to="/transactions/new" className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
            </Link>
          </>
        }
      />

      <div className="card mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="filterType">
              Loại
            </label>
            <select
              id="filterType"
              className="input"
              value={type}
              onChange={(event) => {
                setType(event.target.value as TransactionType | '');
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              <option value="INCOME">Thu nhập</option>
              <option value="EXPENSE">Chi tiêu</option>
              <option value="TRANSFER">Chuyển tiền</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filterFrom">
              Từ ngày
            </label>
            <input
              id="filterFrom"
              type="date"
              className="input"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="filterTo">
              Đến ngày
            </label>
            <input
              id="filterTo"
              type="date"
              className="input"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="filterAccount">
              Tài khoản
            </label>
            <select
              id="filterAccount"
              className="input"
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              {accountsQuery.data?.items.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filterCategory">
              Danh mục
            </label>
            <select
              id="filterCategory"
              className="input"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filterSearch">
              Tìm kiếm
            </label>
            <input
              id="filterSearch"
              className="input"
              placeholder="Mô tả..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
            onClick={resetFilters}
          >
            Xoá bộ lọc
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorAlert message={actionError} />
        </div>
      ) : null}

      {transactionsQuery.isLoading ? (
        <Spinner label="Đang tải giao dịch..." />
      ) : transactionsQuery.error ? (
        <ErrorAlert
          message={errorMessage(transactionsQuery.error)}
          onRetry={() => void transactionsQuery.refetch()}
        />
      ) : (result?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Không có giao dịch phù hợp"
          description="Thử đổi bộ lọc hoặc thêm giao dịch mới."
          action={
            <Link to="/transactions/new" className="btn-primary">
              Thêm giao dịch
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Thời gian</th>
                  <th className="px-4 py-3 font-medium">Mô tả</th>
                  <th className="px-4 py-3 font-medium">Danh mục</th>
                  <th className="px-4 py-3 font-medium">Tài khoản</th>
                  <th className="px-4 py-3 text-right font-medium">Số tiền</th>
                  <th className="px-4 py-3 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {result?.items.map((transaction) => (
                  <tr key={transaction.id} className="table-row">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(transaction.occurredAt, timezone)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{transaction.description}</p>
                      {transaction.note ? (
                        <p className="text-xs text-slate-500">{transaction.note}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {transaction.type === 'TRANSFER' ? (
                        <Badge tone="sky">
                          {transaction.transferDirection === 'OUT' ? 'Chuyển đi' : 'Nhận vào'}
                        </Badge>
                      ) : (
                        <span className="text-slate-600">{transaction.categoryName ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{transaction.accountName ?? '—'}</td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${
                        transaction.type === 'INCOME'
                          ? 'text-emerald-700'
                          : transaction.type === 'EXPENSE'
                            ? 'text-rose-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {transaction.type === 'INCOME'
                        ? '+'
                        : transaction.type === 'EXPENSE'
                          ? '−'
                          : ''}
                      {formatMoney(transaction.amount, transaction.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {transaction.type !== 'TRANSFER' ? (
                          <Link
                            to={`/transactions/${transaction.id}/edit`}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            aria-label={`Sửa ${transaction.description}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleDelete(transaction)}
                          disabled={deleteMutation.isPending}
                          className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          aria-label={`Xoá ${transaction.description}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Trang {result?.page} / {Math.max(result?.totalPages ?? 1, 1)} · {result?.total ?? 0}{' '}
              giao dịch
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary py-1.5"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Trước
              </button>
              <button
                type="button"
                className="btn-secondary py-1.5"
                disabled={page >= (result?.totalPages ?? 1)}
                onClick={() => setPage((value) => value + 1)}
              >
                Sau
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
