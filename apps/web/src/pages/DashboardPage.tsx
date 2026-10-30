import { useQuery } from '@tanstack/react-query';
import type {
  AnalyticsSummaryDto,
  BudgetProgressDto,
  CategorySpendDto,
  PaginatedDto,
  SpendingAlertDto,
  SpendingAlertSeverity,
  TransactionDto,
  TrendPointDto,
} from '@smart-finance/shared-types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  MessageSquare,
  Plus,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ExplainButton } from '../components/Explain';
import { Badge, ErrorAlert, PageHeader, ProgressBar, Skeleton, StatCard } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { AiChatContext } from '../lib/ai-chat-context';
import { openAiChat } from '../lib/ai-chat-events';
import { ALERT_SEVERITY_LABELS, ALERT_TYPE_LABELS } from '../lib/alerts';
import { api, errorMessage } from '../lib/api';
import { chartTheme } from '../lib/chartTheme';
import { currentMonthRange, lastMonthsRange } from '../lib/date';
import {
  dashboardExpense,
  dashboardHighlights,
  dashboardIncome,
  dashboardNetCashFlow,
  dashboardTrendChart,
} from '../lib/explanations';
import { formatDate, formatMoney, formatPercent, formatPercentMagnitude } from '../lib/format';

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

/**
 * The legacy `/analytics/comparison` endpoint returns the two summaries plus
 * the changes it computed. The dashboard only prints them; it never recomputes
 * a percentage or an insight of its own.
 */
interface ComparisonResponse {
  current: AnalyticsSummaryDto;
  previous: AnalyticsSummaryDto;
  incomeChangePercent: number | null;
  expenseChangePercent: number | null;
}

type InsightTone = 'rose' | 'amber' | 'emerald' | 'sky';

interface DashboardInsight {
  id: string;
  /** Stable topic key; the database id never reaches the chat context. */
  feature: 'alert' | 'budget' | 'comparison';
  tone: InsightTone;
  kind: string;
  title: string;
  description: string;
  to: string;
  aiQuestion: string;
}

const SEVERITY_ORDER: Record<SpendingAlertSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

const SEVERITY_TONE: Record<SpendingAlertSeverity, InsightTone> = {
  HIGH: 'rose',
  MEDIUM: 'amber',
  LOW: 'sky',
};

const MAX_INSIGHTS = 3;

/**
 * Builds the "what needs attention" list strictly from values the API
 * computed: open spending alerts (with their own severity and explanation),
 * budget statuses and the period-over-period percentages. Ordering and wording
 * are presentation; no figure is recalculated here.
 */
function buildInsights({
  alerts,
  budgets,
  comparison,
  currency,
}: {
  alerts: SpendingAlertDto[];
  budgets: BudgetProgressDto[];
  comparison: ComparisonResponse | undefined;
  currency: string;
}): DashboardInsight[] {
  const insights: DashboardInsight[] = [];

  const openAlerts = [...alerts].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );
  for (const alert of openAlerts.slice(0, 2)) {
    insights.push({
      id: `alert-${alert.id}`,
      feature: 'alert',
      tone: SEVERITY_TONE[alert.severity],
      kind: `Cảnh báo · ${ALERT_SEVERITY_LABELS[alert.severity]}`,
      title: ALERT_TYPE_LABELS[alert.type],
      description: alert.explanation,
      to: '/alerts',
      aiQuestion: `Giải thích cảnh báo "${ALERT_TYPE_LABELS[alert.type]}" này và tôi nên xem gì tiếp theo?`,
    });
  }

  const budgetNeedingAttention = budgets.find(
    (budget) => budget.status === 'EXCEEDED' || budget.status === 'WARNING',
  );
  if (budgetNeedingAttention && insights.length < MAX_INSIGHTS) {
    const exceeded = budgetNeedingAttention.status === 'EXCEEDED';
    insights.push({
      id: `budget-${budgetNeedingAttention.id}`,
      feature: 'budget',
      tone: exceeded ? 'rose' : 'amber',
      kind: 'Ngân sách tháng',
      title: `${exceeded ? 'Đã vượt hạn mức' : 'Sắp chạm ngưỡng'}: ${budgetNeedingAttention.name}`,
      description: `Đã chi ${formatMoney(budgetNeedingAttention.spent, currency)} trên ${formatMoney(
        budgetNeedingAttention.limitAmount,
        currency,
      )} (${Math.round(budgetNeedingAttention.percentage)}%).`,
      to: '/budgets',
      aiQuestion: `Ngân sách "${budgetNeedingAttention.name}" đang ở mức nào và tôi nên điều chỉnh ra sao?`,
    });
  }

  if (comparison && insights.length < MAX_INSIGHTS) {
    const expenseChange = comparison.expenseChangePercent;
    if (expenseChange !== null && expenseChange !== 0) {
      const increased = expenseChange > 0;
      insights.push({
        id: 'comparison-expense',
        feature: 'comparison',
        tone: increased ? 'amber' : 'emerald',
        kind: 'So với kỳ trước',
        title: `Chi tiêu ${increased ? 'tăng' : 'giảm'} ${formatPercentMagnitude(expenseChange)}`,
        description: increased
          ? `Tổng chi tiêu tháng này cao hơn kỳ trước, dù số liệu đến thời điểm hiện tại.`
          : 'Tổng chi tiêu tháng này thấp hơn kỳ trước.',
        to: '/analytics',
        aiQuestion: 'Chi tiêu của tôi thay đổi thế nào so với kỳ trước?',
      });
    }
  }

  return insights.slice(0, MAX_INSIGHTS);
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
  // Alerts are supplementary: a failure here must not take the overview down,
  // and the section simply says no alert was found.
  const alertsQuery = useQuery({
    queryKey: ['alerts', 'dashboard-open'],
    queryFn: () => api.get<PaginatedDto<SpendingAlertDto>>('/alerts?status=OPEN&limit=10'),
    retry: false,
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="card">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-7 w-36" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
            ))}
          </div>
          <Skeleton className="h-36" />
          <Skeleton className="h-72" />
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
  const alerts = alertsQuery.data?.items ?? [];
  const hasData = (summary?.transactionCount ?? 0) > 0;

  const insights = buildInsights({ alerts, budgets, comparison, currency });
  const baseContext: AiChatContext = {
    page: 'dashboard',
    currency,
    dateRange: { from: month.from, to: month.to },
  };

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

      {/* A. Financial overview — the three figures that answer "how am I doing?". */}
      <section aria-label="Tổng quan tài chính">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Dòng tiền ròng"
            value={formatMoney(summary?.net ?? '0', currency)}
            icon={<Wallet className="h-5 w-5 text-info" />}
            valueClass={Number(summary?.net ?? 0) < 0 ? 'text-expense' : 'text-income'}
            hint={`Thu nhập trừ chi tiêu · ${summary?.transactionCount ?? 0} giao dịch`}
            explain={dashboardNetCashFlow}
            explainContext={{
              ...baseContext,
              feature: 'net-cash-flow',
              selectedMetric: 'Dòng tiền ròng',
              label: 'Dòng tiền ròng tháng này',
              displayedValue: formatMoney(summary?.net ?? '0', currency),
            }}
          />
          <StatCard
            label="Thu nhập"
            value={formatMoney(summary?.income ?? '0', currency)}
            icon={<ArrowDownLeft className="h-5 w-5 text-income" />}
            hint={
              comparison ? (
                <span>so với kỳ trước {formatPercent(comparison.incomeChangePercent)}</span>
              ) : null
            }
            explain={dashboardIncome}
            explainContext={{
              ...baseContext,
              feature: 'income',
              selectedMetric: 'Thu nhập',
              label: 'Thu nhập tháng này',
              displayedValue: formatMoney(summary?.income ?? '0', currency),
              ...(comparison
                ? { comparisonValue: formatPercent(comparison.incomeChangePercent) }
                : {}),
            }}
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
            explain={dashboardExpense}
            explainContext={{
              ...baseContext,
              feature: 'expense',
              selectedMetric: 'Chi tiêu',
              label: 'Chi tiêu tháng này',
              displayedValue: formatMoney(summary?.expense ?? '0', currency),
              ...(comparison
                ? { comparisonValue: formatPercent(comparison.expenseChangePercent) }
                : {}),
            }}
          />
        </div>
      </section>

      {!hasData ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-4">
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

      {/* B. Key financial insight — at most three findings the API already computed. */}
      <section className="card mt-4" aria-label="Điểm cần chú ý">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="card-title">Điểm cần chú ý</h2>
              <ExplainButton
                explanation={dashboardHighlights}
                label="Cách tổng hợp"
                variant="link"
                context={{ ...baseContext, feature: 'highlights', label: 'Điểm cần chú ý' }}
              />
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Tối đa {MAX_INSIGHTS} phát hiện quan trọng nhất trong tháng.
            </p>
          </div>
          {insights.length > 0 ? (
            <Link
              to="/alerts"
              className="text-sm font-medium text-brand hover:text-brand-hover hover:underline"
            >
              Tất cả cảnh báo
            </Link>
          ) : null}
        </div>

        {insights.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">
            Chưa có dấu hiệu bất thường từ dữ liệu đã ghi. Cảnh báo chi tiêu xuất hiện sau khi bạn
            chạy quét trong mục{' '}
            <Link to="/alerts" className="font-medium text-brand hover:underline">
              Cảnh báo
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {insights.map((insight) => (
              <li
                key={insight.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <Badge tone={insight.tone}>{insight.kind}</Badge>
                  <p className="mt-1.5 text-sm font-semibold text-ink">{insight.title}</p>
                  <p className="mt-0.5 text-sm text-ink-secondary">{insight.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link to={insight.to} className="btn-secondary btn-sm">
                    Xem chi tiết
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      openAiChat({
                        prompt: insight.aiQuestion,
                        assistantType: 'ANALYTICS',
                        context: {
                          ...baseContext,
                          feature: `insight-${insight.feature}`,
                          label: insight.title,
                          selectedInsight: insight.kind,
                        },
                      })
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> Hỏi AI
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C. One high-value chart: the six-month income/expense trend. */}
      <section className="card mt-4" aria-label="Xu hướng thu chi 6 tháng">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="card-title">Thu nhập và chi tiêu 6 tháng</h2>
              <ExplainButton
                explanation={dashboardTrendChart}
                label="Cách đọc"
                variant="link"
                context={{
                  ...baseContext,
                  feature: 'trend-chart',
                  label: 'Biểu đồ thu chi 6 tháng',
                  dateRange: { from: trendRange.from, to: trendRange.to },
                }}
              />
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Theo tháng, đơn vị {currency}. Tháng chưa có giao dịch hiển thị bằng 0.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-3 text-xs text-ink-muted">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-income" aria-hidden /> Thu
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-expense" aria-hidden /> Chi
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                openAiChat({
                  prompt: 'Giải thích xu hướng thu nhập và chi tiêu 6 tháng gần nhất của tôi.',
                  assistantType: 'ANALYTICS',
                  context: {
                    ...baseContext,
                    feature: 'trend-chart',
                    label: 'Biểu đồ thu chi 6 tháng',
                    dateRange: { from: trendRange.from, to: trendRange.to },
                  },
                })
              }
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Hỏi AI về biểu đồ
            </button>
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

      {/* D. Supporting detail, kept compact and secondary to the chart. */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="card" aria-label="Chi tiêu theo danh mục tháng này">
          <div className="card-header mb-3">
            <div>
              <h2 className="card-title">Chi tiêu theo danh mục</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                {hasData ? 'Tỷ trọng trong tổng chi tháng này.' : 'Chưa có chi tiêu trong tháng.'}
              </p>
            </div>
            <Link
              to="/analytics?tab=categories"
              className="text-sm font-medium text-brand hover:text-brand-hover hover:underline"
            >
              Xem phân tích
            </Link>
          </div>
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">
              Chưa có chi tiêu trong tháng để chia theo danh mục.
            </p>
          ) : (
            <ul className="space-y-3">
              {categories.slice(0, 4).map((item) => (
                <li key={item.categoryId ?? item.categoryName}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-ink-secondary">
                      {item.categoryName}
                    </span>
                    <span className="shrink-0 text-ink-secondary">
                      {formatMoney(item.total, currency)}
                      <span className="ml-1 text-xs text-ink-muted">
                        {item.percentage.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={item.percentage}
                    label={`Tỷ trọng ${item.categoryName}`}
                    tone="emerald"
                  />
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
            <ul className="space-y-3">
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

      <details className="card-flat group mt-4 px-5 py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span>Giao dịch gần đây</span>
          <span className="flex items-center gap-2 text-xs font-normal text-ink-muted">
            {recent.length} giao dịch mới nhất
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        {recent.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-muted">Chưa có giao dịch.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-line">
              {recent.map((transaction) => (
                <li key={transaction.id} className="flex items-center justify-between gap-3 py-2.5">
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
            <Link
              to="/transactions"
              className="mt-3 inline-block text-sm font-medium text-brand hover:text-brand-hover hover:underline"
            >
              Xem tất cả giao dịch
            </Link>
          </>
        )}
      </details>
    </div>
  );
}
