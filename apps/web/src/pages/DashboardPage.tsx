import { useQuery } from '@tanstack/react-query';
import type {
  AnalyticsSummaryDto,
  BudgetProgressDto,
  CategorySpendDto,
  PaginatedDto,
  TransactionDto,
  TrendPointDto,
} from '@smart-finance/shared-types';
import { ArrowDownLeft, ArrowUpRight, Plus, Receipt, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErrorAlert, PageHeader, ProgressBar, Skeleton, StatCard } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { chartTheme } from '../lib/chartTheme';
import { currentMonthRange, lastMonthsRange } from '../lib/date';
import { formatDate, formatMoney, formatPercent } from '../lib/format';

interface CategoryResponse {
  from: string;
  to: string;
  total: string;
  items: CategorySpendDto[];
}

interface TrendResponse {
  from: string;
  to: string;
  interval: 'day' | 'month';
  points: TrendPointDto[];
}

interface ComparisonResponse {
  current: AnalyticsSummaryDto;
  previous: AnalyticsSummaryDto;
  incomeChangePercent: number | null;
  expenseChangePercent: number | null;
}

export function DashboardPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const currency = user?.defaultCurrency ?? 'VND';
  const month = currentMonthRange(timezone);
  const trendRange = lastMonthsRange(timezone, 6);

  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary', month.from, month.to],
    queryFn: () =>
      api.get<AnalyticsSummaryDto>(`/analytics/summary?from=${month.from}&to=${month.to}`),
  });
  const categoryQuery = useQuery({
    queryKey: ['analytics', 'by-category', month.from, month.to],
    queryFn: () =>
      api.get<CategoryResponse>(`/analytics/by-category?from=${month.from}&to=${month.to}`),
  });
  const trendQuery = useQuery({
    queryKey: ['analytics', 'trend', trendRange.from, trendRange.to],
    queryFn: () =>
      api.get<TrendResponse>(
        `/analytics/trend?from=${trendRange.from}&to=${trendRange.to}&interval=month`,
      ),
  });
  const comparisonQuery = useQuery({
    queryKey: ['analytics', 'comparison', month.from, month.to],
    queryFn: () =>
      api.get<ComparisonResponse>(`/analytics/comparison?from=${month.from}&to=${month.to}`),
  });
  const recentQuery = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => api.get<PaginatedDto<TransactionDto>>('/transactions?limit=5'),
  });
  const budgetsQuery = useQuery({
    queryKey: ['budgets', month.month],
    queryFn: () => api.get<{ items: BudgetProgressDto[] }>(`/budgets?month=${month.month}`),
  });

  const header = (
    <PageHeader
      title="Tổng quan"
      description={`Tháng ${month.month.split('-').reverse().join('/')} · ${timezone}`}
      actions={
        <Link to="/transactions/new" className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
        </Link>
      }
    />
  );

  const loading =
    summaryQuery.isLoading ||
    categoryQuery.isLoading ||
    trendQuery.isLoading ||
    recentQuery.isLoading;
  const failure =
    summaryQuery.error ?? categoryQuery.error ?? trendQuery.error ?? recentQuery.error;

  if (loading) {
    return (
      <div>
        {header}
        <div role="status" aria-label="Đang tải tổng quan" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="card">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-7 w-36" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
            <Skeleton className="h-80 xl:col-span-3" />
            <Skeleton className="h-80 xl:col-span-2" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      </div>
    );
  }

  if (failure) {
    return (
      <div>
        {header}
        <ErrorAlert
          message={errorMessage(failure)}
          onRetry={() => {
            void summaryQuery.refetch();
            void categoryQuery.refetch();
            void trendQuery.refetch();
            void recentQuery.refetch();
          }}
        />
      </div>
    );
  }

  const summary = summaryQuery.data;
  const categories = categoryQuery.data?.items ?? [];
  const points = trendQuery.data?.points ?? [];
  const comparison = comparisonQuery.data;
  const recent = recentQuery.data?.items ?? [];
  const budgets = budgetsQuery.data?.items ?? [];
  const hasData = (summary?.transactionCount ?? 0) > 0;

  const chartData = points.map((point) => ({
    label: new Intl.DateTimeFormat('vi-VN', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(`${point.period}T00:00:00Z`)),
    income: Number(point.income),
    expense: Number(point.expense),
  }));

  return (
    <div>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Thu nhập"
          value={formatMoney(summary?.income ?? '0', currency)}
          icon={<ArrowDownLeft className="h-5 w-5 text-income" />}
          hint={
            comparison ? (
              <span>so với kỳ trước {formatPercent(comparison.incomeChangePercent)}</span>
            ) : null
          }
        />
        <StatCard
          label="Chi tiêu"
          value={formatMoney(summary?.expense ?? '0', currency)}
          icon={<ArrowUpRight className="h-5 w-5 text-expense" />}
          hint={
            comparison ? (
              <span>so với kỳ trước {formatPercent(comparison.expenseChangePercent)}</span>
            ) : null
          }
        />
        <StatCard
          label="Chênh lệch"
          value={formatMoney(summary?.net ?? '0', currency)}
          icon={<Wallet className="h-5 w-5 text-info" />}
          valueClass={Number(summary?.net ?? 0) < 0 ? 'text-expense' : 'text-income'}
        />
        <StatCard
          label="Số giao dịch"
          value={String(summary?.transactionCount ?? 0)}
          icon={<Receipt className="h-5 w-5 text-ink-muted" />}
        />
      </div>

      {!hasData ? (
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">Chưa có giao dịch trong tháng này</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              Các chỉ số đang bằng 0. Biểu đồ 6 tháng và ngân sách bên dưới vẫn dùng dữ liệu thực tế
              của bạn.
            </p>
          </div>
          <Link to="/transactions/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-5">
        <section className="card xl:col-span-3" aria-label="Xu hướng thu chi 6 tháng">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="card-title">Xu hướng 6 tháng</h2>
              <p className="mt-0.5 text-xs text-ink-muted">Thu nhập và chi tiêu theo tháng.</p>
            </div>
            <div className="flex gap-4 text-xs text-ink-muted">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-income" /> Thu
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-expense" /> Chi
              </span>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartTheme.series.income} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={chartTheme.series.income} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartTheme.series.expense} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={chartTheme.series.expense} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: chartTheme.axis.label }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chartTheme.axis.tick }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={(value: number) => `${Math.round(value / 1_000_000)}tr`}
                />
                <Tooltip
                  formatter={(value: number) => formatMoney(value, currency)}
                  labelStyle={{ color: chartTheme.tooltip.label }}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  name="Thu nhập"
                  stroke={chartTheme.series.income}
                  fill="url(#incomeFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="expense"
                  name="Chi tiêu"
                  stroke={chartTheme.series.expense}
                  fill="url(#expenseFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card xl:col-span-2" aria-label="Chi tiêu theo danh mục tháng này">
          <div className="mb-4">
            <h2 className="card-title">Chi tiêu theo danh mục</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {hasData ? 'Tỷ trọng chi tiêu trong tháng.' : 'Chưa có chi tiêu trong tháng.'}
            </p>
          </div>
          {categories.length === 0 ? (
            <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-line-strong">
              <p className="px-6 text-center text-sm text-ink-muted">
                Chưa có chi tiêu trong tháng. Thêm giao dịch để xem tỷ trọng theo danh mục.
              </p>
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories.map((item) => ({
                      name: item.categoryName,
                      value: Number(item.total),
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {categories.map((item, index) => (
                      <Cell
                        key={item.categoryId ?? item.categoryName}
                        fill={chartTheme.category[index % chartTheme.category.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="card" aria-label="Giao dịch gần đây">
          <div className="card-header mb-3">
            <h2 className="card-title">Giao dịch gần đây</h2>
            <Link
              to="/transactions"
              className="text-sm font-medium text-brand hover:text-brand-hover hover:underline"
            >
              Xem tất cả
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">Chưa có giao dịch.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((transaction) => (
                <li key={transaction.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {transaction.description}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {transaction.categoryName ?? 'Chuyển tiền'} ·{' '}
                      {formatDate(transaction.occurredAt, timezone)}
                    </p>
                  </div>
                  <span
                    className={
                      transaction.type === 'INCOME'
                        ? 'shrink-0 text-sm font-semibold text-income'
                        : transaction.type === 'EXPENSE'
                          ? 'shrink-0 text-sm font-semibold text-expense'
                          : 'shrink-0 text-sm font-semibold text-ink-secondary'
                    }
                  >
                    {transaction.type === 'INCOME'
                      ? '+'
                      : transaction.type === 'EXPENSE'
                        ? '−'
                        : ''}
                    {formatMoney(transaction.amount, transaction.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-label="Ngân sách tháng này">
          <div className="card-header mb-3">
            <h2 className="card-title">Ngân sách tháng</h2>
            <Link
              to="/budgets"
              className="text-sm font-medium text-brand hover:text-brand-hover hover:underline"
            >
              Quản lý
            </Link>
          </div>
          {budgetsQuery.isLoading ? (
            <div role="status" aria-label="Đang tải ngân sách" className="space-y-4">
              {[0, 1, 2].map((key) => (
                <div key={key}>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="mt-2 h-2 w-full" />
                </div>
              ))}
            </div>
          ) : budgets.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">Chưa có ngân sách tháng này.</p>
          ) : (
            <ul className="space-y-4">
              {budgets.slice(0, 4).map((budget) => (
                <li key={budget.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-ink-secondary">{budget.name}</span>
                    <span className="shrink-0 text-ink-muted">
                      {formatMoney(budget.spent, currency)} /{' '}
                      {formatMoney(budget.limitAmount, currency)}
                    </span>
                  </div>
                  <ProgressBar
                    value={budget.percentage}
                    label={`Ngân sách ${budget.name}`}
                    tone={
                      budget.status === 'EXCEEDED'
                        ? 'rose'
                        : budget.status === 'WARNING'
                          ? 'amber'
                          : 'emerald'
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
