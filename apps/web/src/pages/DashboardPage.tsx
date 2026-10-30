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
import {
  EmptyState,
  ErrorAlert,
  PageHeader,
  ProgressBar,
  Spinner,
  StatCard,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
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

const CHART_COLORS = [
  '#059669',
  '#0ea5e9',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#64748b',
  '#db2777',
];

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

  const loading =
    summaryQuery.isLoading ||
    categoryQuery.isLoading ||
    trendQuery.isLoading ||
    recentQuery.isLoading;
  const failure =
    summaryQuery.error ?? categoryQuery.error ?? trendQuery.error ?? recentQuery.error;

  if (loading) return <Spinner label="Đang tải tổng quan..." />;
  if (failure) {
    return (
      <ErrorAlert
        message={errorMessage(failure)}
        onRetry={() => {
          void summaryQuery.refetch();
          void categoryQuery.refetch();
          void trendQuery.refetch();
          void recentQuery.refetch();
        }}
      />
    );
  }

  const summary = summaryQuery.data;
  const categories = categoryQuery.data?.items ?? [];
  const points = trendQuery.data?.points ?? [];
  const comparison = comparisonQuery.data;
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
      <PageHeader
        title="Tổng quan"
        description={`Tháng ${month.month.split('-').reverse().join('/')} · ${timezone}`}
        actions={
          <Link to="/transactions/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Thu nhập"
          value={formatMoney(summary?.income ?? '0', currency)}
          icon={<ArrowDownLeft className="h-5 w-5 text-emerald-600" />}
          hint={
            comparison ? (
              <span className="text-slate-500">
                so với kỳ trước {formatPercent(comparison.incomeChangePercent)}
              </span>
            ) : null
          }
        />
        <StatCard
          label="Chi tiêu"
          value={formatMoney(summary?.expense ?? '0', currency)}
          icon={<ArrowUpRight className="h-5 w-5 text-rose-500" />}
          hint={
            comparison ? (
              <span className="text-slate-500">
                so với kỳ trước {formatPercent(comparison.expenseChangePercent)}
              </span>
            ) : null
          }
        />
        <StatCard
          label="Chênh lệch"
          value={formatMoney(summary?.net ?? '0', currency)}
          icon={<Wallet className="h-5 w-5 text-sky-600" />}
          valueClass={Number(summary?.net ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}
        />
        <StatCard
          label="Số giao dịch"
          value={String(summary?.transactionCount ?? 0)}
          icon={<Receipt className="h-5 w-5 text-slate-500" />}
        />
      </div>

      {!hasData ? (
        <div className="mt-6">
          <EmptyState
            title="Chưa có giao dịch trong tháng này"
            description="Thêm giao dịch đầu tiên hoặc nhập từ CSV để xem báo cáo."
            action={
              <Link to="/transactions/new" className="btn-primary">
                <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-5">
          <section className="card xl:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Xu hướng 6 tháng</h2>
              <div className="flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" /> Thu
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> Chi
                </span>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(value: number) => `${Math.round(value / 1_000_000)}tr`}
                  />
                  <Tooltip
                    formatter={(value: number) => formatMoney(value, currency)}
                    labelStyle={{ color: '#0f172a' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="income"
                    name="Thu nhập"
                    stroke="#059669"
                    fill="url(#incomeFill)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="expense"
                    name="Chi tiêu"
                    stroke="#f43f5e"
                    fill="url(#expenseFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card xl:col-span-2">
            <h2 className="mb-4 font-semibold text-slate-900">Chi tiêu theo danh mục</h2>
            {categories.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                Chưa có chi tiêu trong tháng.
              </p>
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
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
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
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Giao dịch gần đây</h2>
            <Link
              to="/transactions"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              Xem tất cả
            </Link>
          </div>
          {(recentQuery.data?.items.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Chưa có giao dịch.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentQuery.data?.items.map((transaction) => (
                <li key={transaction.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {transaction.description}
                    </p>
                    <p className="text-xs text-slate-500">
                      {transaction.categoryName ?? 'Chuyển tiền'} ·{' '}
                      {formatDate(transaction.occurredAt, timezone)}
                    </p>
                  </div>
                  <span
                    className={
                      transaction.type === 'INCOME'
                        ? 'shrink-0 text-sm font-semibold text-emerald-700'
                        : transaction.type === 'EXPENSE'
                          ? 'shrink-0 text-sm font-semibold text-rose-600'
                          : 'shrink-0 text-sm font-semibold text-slate-600'
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

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Ngân sách tháng</h2>
            <Link to="/budgets" className="text-sm font-medium text-emerald-700 hover:underline">
              Quản lý
            </Link>
          </div>
          {budgetsQuery.isLoading ? (
            <Spinner label="Đang tải ngân sách..." />
          ) : (budgetsQuery.data?.items.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Chưa có ngân sách tháng này.</p>
          ) : (
            <ul className="space-y-4">
              {budgetsQuery.data?.items.slice(0, 4).map((budget) => (
                <li key={budget.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-slate-700">{budget.name}</span>
                    <span className="shrink-0 text-slate-500">
                      {formatMoney(budget.spent, currency)} /{' '}
                      {formatMoney(budget.limitAmount, currency)}
                    </span>
                  </div>
                  <ProgressBar
                    value={budget.percentage}
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
