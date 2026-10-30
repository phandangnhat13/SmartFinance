import { useQuery } from '@tanstack/react-query';
import type {
  AnalyticsBudgetPaceDto,
  AnalyticsBudgetsDto,
  AnalyticsCategoriesDto,
  AnalyticsExpenseDto,
  AnalyticsForecastDto,
  AnalyticsIncomeDto,
  AnalyticsOverviewDto,
  AnalyticsPeriodComparisonDto,
  AnalyticsTrendsDto,
  FinancialHealthDto,
  FinancialHealthHistoryDto,
  ForecastHorizon,
} from '@smart-finance/shared-types';
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Receipt, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnalyticsAiPanel } from '../components/AnalyticsAiPanel';
import { AnalyticsBreakdownPanel } from '../components/AnalyticsBreakdownPanel';
import { AnalyticsBudgetPanel } from '../components/AnalyticsBudgetPanel';
import { AnalyticsCategoryPanel } from '../components/AnalyticsCategoryPanel';
import { AnalyticsComparisonPanel } from '../components/AnalyticsComparisonPanel';
import { AnalyticsForecastPanel } from '../components/AnalyticsForecastPanel';
import { AnalyticsHealthPanel } from '../components/AnalyticsHealthPanel';
import { AnalyticsTrendCharts } from '../components/AnalyticsTrendCharts';
import {
  Badge,
  EmptyState,
  ErrorAlert,
  PageHeader,
  Skeleton,
  StatCard,
  TabBar,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { currentMonthRange, todayInTimeZone } from '../lib/date';
import { formatMoney, formatPercent } from '../lib/format';

type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';
type PeriodStatus = 'in_progress' | 'complete';
type AnalyticsTab = 'overview' | 'categories' | 'trends' | 'ai';

const KIND_OPTIONS: Array<{ value: PeriodKind; label: string }> = [
  { value: 'month', label: 'Theo tháng' },
  { value: 'quarter', label: 'Theo quý' },
  { value: 'year', label: 'Theo năm' },
  { value: 'custom', label: 'Khoảng tùy chọn' },
];

const MONTH_OPTIONS = [3, 6, 12, 24];

const TAB_OPTIONS: Array<{ value: AnalyticsTab; label: string }> = [
  { value: 'overview', label: 'Tổng quan' },
  { value: 'categories', label: 'Danh mục' },
  { value: 'trends', label: 'Xu hướng' },
  { value: 'ai', label: 'Phân tích AI' },
];

function parseTab(value: string | null): AnalyticsTab {
  if (value === 'categories' || value === 'trends' || value === 'ai') return value;
  return 'overview';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function buildPeriodParams(
  kind: PeriodKind,
  values: { month: string; quarter: string; year: string; from: string; to: string },
  currency: string,
): string {
  const params = new URLSearchParams({ period: kind, currency });
  if (kind === 'month') params.set('month', values.month);
  if (kind === 'quarter') params.set('quarter', values.quarter);
  if (kind === 'year') params.set('year', values.year);
  if (kind === 'custom') {
    params.set('from', values.from);
    params.set('to', values.to);
  }
  return params.toString();
}

/**
 * The last month covered by the selected period, capped at the current month so
 * an ongoing year/quarter can still be charted. The API rejects future anchors.
 */
function anchorMonth(
  kind: PeriodKind,
  values: { month: string; quarter: string; year: string; to: string },
  currentMonth: string,
): string {
  let anchor = values.month;
  if (kind === 'quarter') {
    const [year, quarter] = values.quarter.split('-Q');
    anchor = `${year}-${pad(Number(quarter) * 3)}`;
  } else if (kind === 'year') {
    anchor = `${values.year}-12`;
  } else if (kind === 'custom') {
    anchor = values.to.slice(0, 7);
  }
  return anchor > currentMonth ? currentMonth : anchor;
}

function savingsRateLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function PeriodBadge({ status, label }: { status: PeriodStatus; label: string }) {
  return (
    <Badge tone={status === 'in_progress' ? 'amber' : 'slate'}>
      {status === 'in_progress' ? `${label}: đang diễn ra` : `${label}: đã kết thúc`}
    </Badge>
  );
}

export function AnalyticsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const defaultCurrency = (user?.defaultCurrency ?? 'VND').toUpperCase();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseTab(searchParams.get('tab'));

  const initial = currentMonthRange(timezone);
  const [kind, setKind] = useState<PeriodKind>('month');
  const [month, setMonth] = useState(initial.month);
  const [quarter, setQuarter] = useState(() => {
    const [year, monthNumber] = initial.month.split('-').map(Number);
    return `${year}-Q${Math.ceil(monthNumber / 3)}`;
  });
  const [year, setYear] = useState(initial.month.slice(0, 4));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [months, setMonths] = useState(6);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [currencies, setCurrencies] = useState<string[]>([defaultCurrency]);
  const [categoryType, setCategoryType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [categoryId, setCategoryId] = useState('');
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>('current_month');

  const onOverview = activeTab === 'overview';
  const onCategories = activeTab === 'categories';
  const onTrends = activeTab === 'trends';
  const onAi = activeTab === 'ai';

  const currentMonth = todayInTimeZone(timezone).slice(0, 7);
  const customInvalid = kind === 'custom' && (!from || !to || from > to);
  const periodParams = buildPeriodParams(kind, { month, quarter, year, from, to }, currency);
  const anchor = anchorMonth(kind, { month, quarter, year, to }, currentMonth);
  const rangeParams = new URLSearchParams({
    months: String(months),
    month: anchor,
    currency,
  }).toString();

  const categoryParams = new URLSearchParams(periodParams);
  categoryParams.set('type', categoryType);
  categoryParams.set('months', String(months));
  if (categoryId) categoryParams.set('categoryId', categoryId);
  const categoriesQueryKey = categoryParams.toString();

  // Budgets are month-scoped by the model; use the last month of the selected
  // period (never a multi-month total) and say so in the UI.
  const budgetParams = new URLSearchParams({ month: anchor, currency }).toString();

  // Forecasting always looks forward from today: it intentionally ignores the
  // period selector and only follows the currency and the chosen horizon.
  const forecastParams = new URLSearchParams({
    currency,
    horizon: forecastHorizon,
  }).toString();

  // The health score is a "now" snapshot of the whole profile, so it follows
  // the currency but not the period selector; its history is recomputed per
  // complete month and covers the last six months.
  const healthParams = new URLSearchParams({ currency }).toString();
  const healthHistoryParams = new URLSearchParams({ currency, months: '6' }).toString();

  // The overview is also the page shell: it supplies the period label and the
  // list of currencies for the shared filter. Every other query is enabled only
  // by the tab that renders it, so an unopened tab makes no request.
  const overviewQuery = useQuery({
    queryKey: ['analytics', 'overview', periodParams],
    queryFn: () => api.get<AnalyticsOverviewDto>(`/analytics/overview?${periodParams}`),
    enabled: !customInvalid,
  });
  const trendsQuery = useQuery({
    queryKey: ['analytics', 'trends', rangeParams],
    queryFn: () => api.get<AnalyticsTrendsDto>(`/analytics/trends?${rangeParams}`),
    enabled: !customInvalid && onTrends,
  });
  const incomeQuery = useQuery({
    queryKey: ['analytics', 'income', rangeParams],
    queryFn: () => api.get<AnalyticsIncomeDto>(`/analytics/income?${rangeParams}`),
    enabled: !customInvalid && onCategories,
  });
  const expenseQuery = useQuery({
    queryKey: ['analytics', 'expenses', rangeParams],
    queryFn: () => api.get<AnalyticsExpenseDto>(`/analytics/expenses?${rangeParams}`),
    enabled: !customInvalid && onCategories,
  });
  const comparisonQuery = useQuery({
    queryKey: ['analytics', 'period-comparison', periodParams],
    queryFn: () =>
      api.get<AnalyticsPeriodComparisonDto>(`/analytics/period-comparison?${periodParams}`),
    enabled: !customInvalid && onOverview,
  });
  const categoriesQuery = useQuery({
    queryKey: ['analytics', 'categories', categoriesQueryKey],
    queryFn: () => api.get<AnalyticsCategoriesDto>(`/analytics/categories?${categoriesQueryKey}`),
    enabled: !customInvalid && onCategories,
  });
  const budgetsQuery = useQuery({
    queryKey: ['analytics', 'budgets', budgetParams],
    queryFn: () => api.get<AnalyticsBudgetsDto>(`/analytics/budgets?${budgetParams}`),
    enabled: !customInvalid && onCategories,
  });
  const budgetPaceQuery = useQuery({
    queryKey: ['analytics', 'budget-pace', budgetParams],
    queryFn: () => api.get<AnalyticsBudgetPaceDto>(`/analytics/budget-pace?${budgetParams}`),
    enabled: !customInvalid && onCategories,
  });
  const forecastQuery = useQuery({
    queryKey: ['analytics', 'forecast', forecastParams],
    queryFn: () => api.get<AnalyticsForecastDto>(`/analytics/forecast?${forecastParams}`),
    enabled: onTrends,
  });
  const healthQuery = useQuery({
    queryKey: ['analytics', 'financial-health', healthParams],
    queryFn: () => api.get<FinancialHealthDto>(`/analytics/financial-health?${healthParams}`),
    enabled: onOverview,
  });
  const healthHistoryQuery = useQuery({
    queryKey: ['analytics', 'financial-health-history', healthHistoryParams],
    queryFn: () =>
      api.get<FinancialHealthHistoryDto>(
        `/analytics/financial-health/history?${healthHistoryParams}`,
      ),
    enabled: onOverview,
  });

  const overviewQueries = [overviewQuery, comparisonQuery, healthQuery, healthHistoryQuery];
  const categoryQueries = [
    categoriesQuery,
    incomeQuery,
    expenseQuery,
    budgetsQuery,
    budgetPaceQuery,
  ];
  const trendQueries = [trendsQuery, forecastQuery];

  const activeQueries = onOverview
    ? overviewQueries
    : onCategories
      ? categoryQueries
      : onTrends
        ? trendQueries
        : [];

  const loading = activeQueries.some((query) => query.isLoading);
  const failure = activeQueries.find((query) => query.error)?.error;
  const retry = () => {
    for (const query of activeQueries) void query.refetch();
  };

  const overview = overviewQuery.data;
  const trends = trendsQuery.data;
  const income = incomeQuery.data;
  const expense = expenseQuery.data;
  const comparison = comparisonQuery.data;
  const categories = categoriesQuery.data;
  const budgets = budgetsQuery.data;
  const budgetPace = budgetPaceQuery.data;
  const forecast = forecastQuery.data;
  const health = healthQuery.data;
  const healthHistory = healthHistoryQuery.data;
  const period = overview?.period;

  // Keep the selector populated while a new period loads.
  useEffect(() => {
    if (overview?.availableCurrencies.length) {
      setCurrencies(overview.availableCurrencies);
    }
  }, [overview]);

  const noData =
    overview !== undefined && !overview.hasTransactions && !overview.previous.hasTransactions;

  function changeTab(tab: AnalyticsTab) {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next);
  }

  return (
    <div>
      <PageHeader
        title="Xu hướng thu nhập & chi tiêu"
        description="Phân tích dữ liệu giao dịch đã ghi nhận, tách riêng từng loại tiền tệ và theo múi giờ tài khoản."
      />

      <section className="filter-bar" aria-label="Bộ lọc phân tích">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="analyticsPeriod">
              Kỳ phân tích
            </label>
            <select
              id="analyticsPeriod"
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value as PeriodKind)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {kind === 'month' ? (
            <div>
              <label className="label" htmlFor="analyticsMonth">
                Tháng
              </label>
              <input
                id="analyticsMonth"
                type="month"
                className="input"
                value={month}
                max={currentMonth}
                onChange={(event) => {
                  if (event.target.value) setMonth(event.target.value);
                }}
              />
            </div>
          ) : null}

          {kind === 'quarter' ? (
            <div>
              <label className="label" htmlFor="analyticsQuarter">
                Quý
              </label>
              <input
                id="analyticsQuarter"
                type="text"
                className="input"
                placeholder="2026-Q4"
                value={quarter}
                onChange={(event) => setQuarter(event.target.value.toUpperCase())}
              />
            </div>
          ) : null}

          {kind === 'year' ? (
            <div>
              <label className="label" htmlFor="analyticsYear">
                Năm
              </label>
              <input
                id="analyticsYear"
                type="number"
                min={2000}
                max={Number(currentMonth.slice(0, 4))}
                className="input"
                value={year}
                onChange={(event) => setYear(event.target.value)}
              />
            </div>
          ) : null}

          {kind === 'custom' ? (
            <>
              <div>
                <label className="label" htmlFor="analyticsFrom">
                  Từ ngày
                </label>
                <input
                  id="analyticsFrom"
                  type="date"
                  className="input"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="analyticsTo">
                  Đến ngày
                </label>
                <input
                  id="analyticsTo"
                  type="date"
                  className="input"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
            </>
          ) : null}

          <div>
            <label className="label" htmlFor="analyticsCurrency">
              Tiền tệ
            </label>
            <select
              id="analyticsCurrency"
              className="input"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          {onCategories ? (
            <div>
              <label className="label" htmlFor="analyticsCategoryType">
                Danh mục thu / chi
              </label>
              <select
                id="analyticsCategoryType"
                className="input"
                value={categoryType}
                onChange={(event) => {
                  setCategoryType(event.target.value as 'EXPENSE' | 'INCOME');
                  setCategoryId('');
                }}
              >
                <option value="EXPENSE">Chi tiêu</option>
                <option value="INCOME">Thu nhập</option>
              </select>
            </div>
          ) : null}

          {onCategories || onTrends ? (
            <div>
              <label className="label" htmlFor="analyticsRange">
                Khoảng biểu đồ & phân tích tháng
              </label>
              <select
                id="analyticsRange"
                className="input"
                value={months}
                onChange={(event) => setMonths(Number(event.target.value))}
              >
                {MONTH_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count} tháng
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {period ? (
            <>
              <span className="text-ink-secondary">
                Kỳ {period.label} ({period.from} → {period.to})
              </span>
              <PeriodBadge status={period.status} label="Kỳ hiện tại" />
            </>
          ) : null}
          <span>
            · {trends?.rangeMonths ?? months} tháng gần nhất tính đến {anchor} · ngân sách tháng{' '}
            {anchor} · <span className="font-medium text-ink-secondary">{currency}</span>
          </span>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          Chỉ giao dịch thu nhập và chi tiêu được tính; giao dịch chuyển tiền nội bộ bị loại trừ và
          không có quy đổi tỷ giá giữa các loại tiền. Tháng không có giao dịch được hiển thị là
          &ldquo;không có dữ liệu&rdquo;, khác với tháng có giao dịch nhưng bằng 0.
        </p>
      </section>

      <TabBar
        label="Khu vực phân tích"
        tabs={TAB_OPTIONS}
        value={activeTab}
        onChange={changeTab}
        idBase="analytics-tabs"
        panelId="analytics-tabpanel"
      />

      {customInvalid ? (
        <p
          className="mt-4 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning-strong"
          role="status"
        >
          Khoảng ngày chưa hợp lệ: &ldquo;Từ ngày&rdquo; phải trước hoặc bằng &ldquo;Đến
          ngày&rdquo;.
        </p>
      ) : null}

      <div
        id="analytics-tabpanel"
        role="tabpanel"
        aria-labelledby={`analytics-tabs-tab-${activeTab}`}
        tabIndex={0}
        className="mt-4 focus-visible:outline-none"
      >
        {loading ? (
          <div role="status" aria-label="Đang tính toán xu hướng">
            <p className="mb-3 text-sm text-ink-muted">Đang tính toán xu hướng...</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
            <Skeleton className="mt-4 h-80" />
          </div>
        ) : failure ? (
          <ErrorAlert message={errorMessage(failure)} onRetry={retry} />
        ) : onOverview && overview && comparison && health && healthHistory ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard
                label="Thu nhập"
                value={formatMoney(overview.income, currency)}
                icon={<ArrowDownLeft className="h-5 w-5 text-income" />}
                hint={
                  <>
                    Kỳ trước: {formatMoney(overview.previous.income, currency)} (
                    {formatPercent(overview.changes.income.percent)})
                  </>
                }
              />
              <StatCard
                label="Chi tiêu"
                value={formatMoney(overview.expense, currency)}
                icon={<ArrowUpRight className="h-5 w-5 text-expense" />}
                hint={
                  <>
                    Kỳ trước: {formatMoney(overview.previous.expense, currency)} (
                    {formatPercent(overview.changes.expense.percent)})
                  </>
                }
              />
              <StatCard
                label="Dòng tiền ròng"
                value={formatMoney(overview.net, currency)}
                icon={<Wallet className="h-5 w-5 text-info" />}
                valueClass={Number(overview.net) < 0 ? 'text-danger' : 'text-brand-hover'}
                hint={
                  <>
                    Chênh lệch: {Number(overview.changes.net.amount) > 0 ? '+' : ''}
                    {formatMoney(overview.changes.net.amount, currency)}
                  </>
                }
              />
              <StatCard
                label="Tỷ lệ tiết kiệm"
                value={savingsRateLabel(overview.savingsRate)}
                icon={<PiggyBank className="h-5 w-5 text-accent" />}
                hint={
                  overview.savingsRate === null
                    ? 'Kỳ này chưa có thu nhập để tính tỷ lệ.'
                    : `Kỳ trước: ${savingsRateLabel(overview.previous.savingsRate)}${
                        overview.changes.savingsRatePoints === null
                          ? ''
                          : ` · ${overview.changes.savingsRatePoints > 0 ? '+' : ''}${overview.changes.savingsRatePoints.toFixed(1)} điểm %`
                      }`
                }
              />
              <StatCard
                label="Số giao dịch"
                value={overview.transactionCount.toLocaleString('vi-VN')}
                icon={<Receipt className="h-5 w-5 text-ink-muted" />}
                hint={`Kỳ trước: ${overview.previous.transactionCount.toLocaleString('vi-VN')}`}
              />
            </div>

            {noData ? (
              <div className="mt-4">
                <EmptyState
                  title={`Chưa có giao dịch thu hoặc chi trong kỳ ${period?.label ?? ''}`}
                  description="Chọn kỳ khác, đổi loại tiền tệ hoặc thêm giao dịch để xem xu hướng."
                  action={
                    <Link to="/transactions/new" className="btn-primary">
                      Thêm giao dịch
                    </Link>
                  }
                />
              </div>
            ) : null}

            <div className="mt-4">
              <AnalyticsComparisonPanel data={comparison} currency={currency} />
            </div>

            <div className="mt-4">
              <AnalyticsHealthPanel data={health} history={healthHistory} />
            </div>
          </>
        ) : onCategories && categories && income && expense && budgets && budgetPace ? (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <AnalyticsBreakdownPanel kind="income" data={income} currency={currency} />
              <AnalyticsBreakdownPanel kind="expense" data={expense} currency={currency} />
            </div>

            <div className="mt-4">
              <AnalyticsCategoryPanel
                data={categories}
                currency={currency}
                selectedCategoryId={categoryId}
                onSelectCategory={setCategoryId}
              />
            </div>

            <div className="mt-4">
              <AnalyticsBudgetPanel data={budgets} pace={budgetPace} currency={currency} />
            </div>
          </>
        ) : onTrends && trends && forecast ? (
          <>
            <AnalyticsTrendCharts
              data={trends}
              currency={currency}
              timezone={overview?.timezone ?? timezone}
            />
            <div className="mt-4">
              <AnalyticsForecastPanel
                data={forecast}
                currency={currency}
                horizon={forecastHorizon}
                onHorizonChange={setForecastHorizon}
              />
            </div>
          </>
        ) : onAi ? (
          <AnalyticsAiPanel currency={currency} />
        ) : null}
      </div>
    </div>
  );
}
