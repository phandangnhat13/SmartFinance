import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountDto,
  CategoryDto,
  PaginatedDto,
  TransactionDto,
  TransactionType,
} from '@smart-finance/shared-types';
import { ArrowLeftRight, Download, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  HelpTip,
  PageHeader,
  Pagination,
  Spinner,
  cn,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, downloadFile, errorMessage } from '../lib/api';
import { transactionsCategory, transactionsTypes } from '../lib/explanations';
import { formatDateOnly, formatDateTime, formatMoney } from '../lib/format';
import { useMediaQuery } from '../lib/useMediaQuery';

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: 'Thu nhập',
  EXPENSE: 'Chi tiêu',
  TRANSFER: 'Chuyển tiền',
};

function amountTone(type: TransactionType): string {
  if (type === 'INCOME') return 'text-income';
  if (type === 'EXPENSE') return 'text-expense';
  return 'text-ink-secondary';
}

function amountPrefix(type: TransactionType): string {
  if (type === 'INCOME') return '+';
  if (type === 'EXPENSE') return '−';
  return '';
}

/** Edit/delete controls shared by the desktop table and the mobile cards. */
function RowActions({
  transaction,
  onDelete,
  disabled,
}: {
  transaction: TransactionDto;
  onDelete: (transaction: TransactionDto) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex justify-end gap-1">
      {transaction.type !== 'TRANSFER' ? (
        <Link
          to={`/transactions/${transaction.id}/edit`}
          className="icon-btn"
          aria-label={`Sửa ${transaction.description}`}
          title="Sửa"
        >
          <Pencil className="h-4 w-4" />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={() => onDelete(transaction)}
        disabled={disabled}
        className="icon-btn hover:bg-danger-soft hover:text-danger disabled:opacity-50"
        aria-label={`Xoá ${transaction.description}`}
        title="Xoá"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function CategoryCell({ transaction }: { transaction: TransactionDto }) {
  if (transaction.type === 'TRANSFER') {
    return (
      <Badge tone="sky">{transaction.transferDirection === 'OUT' ? 'Chuyển đi' : 'Nhận vào'}</Badge>
    );
  }
  return <span className="text-ink-secondary">{transaction.categoryName ?? '—'}</span>;
}

export function TransactionsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const queryClient = useQueryClient();
  // Only one of the two layouts is rendered, so the description never appears
  // twice in the DOM (keep screen readers and E2E locators unambiguous).
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [type, setType] = useState<TransactionType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TransactionDto | null>(null);
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

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
    } catch {
      // deleteMutation.onError already put the message in the banner.
    } finally {
      setPendingDelete(null);
    }
  }

  const result = transactionsQuery.data;
  const categoryOptions = categoriesQuery.data?.items ?? [];

  const accountLabel = accountsQuery.data?.items.find((account) => account.id === accountId)?.name;
  const categoryLabel = categoryOptions.find((category) => category.id === categoryId)?.name;
  const activeFilters = [
    search.trim() ? `Tìm: “${search.trim()}”` : null,
    type ? `Loại: ${TYPE_LABELS[type]}` : null,
    from ? `Từ ${formatDateOnly(from)}` : null,
    to ? `Đến ${formatDateOnly(to)}` : null,
    accountId ? `Tài khoản: ${accountLabel ?? 'đã chọn'}` : null,
    categoryId ? `Danh mục: ${categoryLabel ?? 'đã chọn'}` : null,
  ].filter((value): value is string => value !== null);

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

      <section className="filter-bar" aria-label="Bộ lọc giao dịch">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="section-title">Bộ lọc</h2>
            {activeFilters.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">Đang hiển thị tất cả giao dịch.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Bộ lọc đang áp dụng">
                {activeFilters.map((filter) => (
                  <li
                    key={filter}
                    className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-hover"
                  >
                    {filter}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.length > 0 ? (
              <button type="button" className="btn-ghost btn-sm" onClick={resetFilters}>
                Xoá bộ lọc
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-expanded={filtersOpen}
              aria-controls="transaction-filters"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              {filtersOpen ? 'Thu gọn bộ lọc' : 'Chỉnh sửa bộ lọc'}
            </button>
          </div>
        </div>

        {filtersOpen ? (
          <div
            id="transaction-filters"
            className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-3"
          >
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
            <div>
              <span className="flex items-center gap-1.5">
                <label className="label" htmlFor="filterType">
                  Loại
                </label>
                <HelpTip label="Loại giao dịch" explanation={transactionsTypes} />
              </span>
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
            <div className="grid grid-cols-2 gap-3">
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
              <span className="flex items-center gap-1.5">
                <label className="label" htmlFor="filterCategory">
                  Danh mục
                </label>
                <HelpTip label="Danh mục giao dịch" explanation={transactionsCategory} />
              </span>
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
          </div>
        ) : null}
      </section>

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
          {isDesktop ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">Danh sách giao dịch</caption>
                <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Thời gian
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Mô tả
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Danh mục
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tài khoản
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Số tiền
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result?.items.map((transaction) => (
                    <tr key={transaction.id} className="table-row">
                      <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                        {formatDateTime(transaction.occurredAt, timezone)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{transaction.description}</p>
                        {transaction.note ? (
                          <p className="text-xs text-ink-muted">{transaction.note}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <CategoryCell transaction={transaction} />
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {transaction.accountName ?? '—'}
                      </td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-4 py-3 text-right font-semibold',
                          amountTone(transaction.type),
                        )}
                      >
                        {amountPrefix(transaction.type)}
                        {formatMoney(transaction.amount, transaction.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <RowActions
                          transaction={transaction}
                          onDelete={setPendingDelete}
                          disabled={deleteMutation.isPending}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {result?.items.map((transaction) => (
                <li key={transaction.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{transaction.description}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {formatDateTime(transaction.occurredAt, timezone)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
                        <CategoryCell transaction={transaction} />
                        <span aria-hidden>·</span>
                        <span className="truncate">{transaction.accountName ?? '—'}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          'whitespace-nowrap text-sm font-semibold',
                          amountTone(transaction.type),
                        )}
                      >
                        {amountPrefix(transaction.type)}
                        {formatMoney(transaction.amount, transaction.currency)}
                      </p>
                      <div className="mt-2">
                        <RowActions
                          transaction={transaction}
                          onDelete={setPendingDelete}
                          disabled={deleteMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-3">
            <Pagination
              page={result?.page ?? page}
              totalPages={result?.totalPages ?? 1}
              total={result?.total ?? 0}
              itemLabel="giao dịch"
              onPageChange={setPage}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Xoá giao dịch?"
        description={
          pendingDelete?.type === 'TRANSFER'
            ? 'Xoá chuyển tiền này sẽ xoá cả hai vế. Hành động này không thể hoàn tác.'
            : `Xoá giao dịch “${pendingDelete?.description ?? ''}”? Hành động này không thể hoàn tác.`
        }
        confirmLabel="Xoá giao dịch"
        pending={deleteMutation.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleteMutation.isPending) setPendingDelete(null);
        }}
      />
    </div>
  );
}
