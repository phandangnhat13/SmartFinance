import { useQuery } from '@tanstack/react-query';
import type {
  InsightsCategoriesDto,
  InsightsMonthlyDto,
  InsightsOverviewDto,
} from '@smart-finance/shared-types';
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Plus, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Badge,
  EmptyState,
  ErrorAlert,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatCard,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { chartTheme } from '../lib/chartTheme';
import { currentMonthRange } from '../lib/date';
import { formatMoney, formatPercent } from '../lib/format';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const TREND_MONTHS = 6;

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${monthNumber}/${year}`;
}

function savingsRateLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export function InsightsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Ho_Chi_Minh';
  const defaultCurrency = (user?.defaultCurrency ?? 'VND').toUpperCase();
  const [month, setMonth] = useState(() => currentMonthRange(timezone).month);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [currencies, setCurrencies] = useState<string[]>([defaultCurrency]);

  const overviewQuery = useQuery({
    queryKey: ['insights', 'overview', month, currency],
    queryFn: () =>
      api.get<InsightsOverviewDto>(`/insights/overview?month=${month}&currency=${currency}`),
  });
  const monthlyQuery = useQuery({
    queryKey: ['insights', 'monthly', month, currency],
    queryFn: () =>
      api.get<InsightsMonthlyDto>(
        `/insights/monthly?month=${month}&months=${TREND_MONTHS}&currency=${currency}`,
      ),
  });
  const categoriesQuery = useQuery({
    queryKey: ['insights', 'categories', month, currency],
    queryFn: () =>
      api.get<InsightsCategoriesDto>(`/insights/categories?month=${month}&currency=${currency}`),
  });

  const loading = overviewQuery.isLoading || monthlyQuery.isLoading || categoriesQuery.isLoading;
  const failure = overviewQuery.error ?? monthlyQuery.error ?? categoriesQuery.error;
  const retry = () => {
    void overviewQuery.refetch();
    void monthlyQuery.refetch();
    void categoriesQuery.refetch();
  };

  const overview = overviewQuery.data;
  const monthly = monthlyQuery.data;
  const categories = categoriesQuery.data;
  const monthIsRunning = overview?.monthStatus === 'in_progress';

  // Keep the currency options stable while another month is loading, so the
  // selector does not collapse back to a single option on every month change.
  useEffect(() => {
    if (overview?.availableCurrencies.length) {
      setCurrencies(overview.availableCurrencies);
    }
  }, [overview]);

  const chartData = (monthly?.months ?? []).map((point) => ({
    label: monthLabel(point.month),
    income: Number(point.income),
    expense: Number(point.expense),
    net: Number(point.net),
  }));

  return (
    <div>
      <PageHeader
        title="Phân tích tài chính"
        description="Số liệu được tính từ các giao dịch đã ghi nhận của bạn, theo múi giờ tài khoản."
      />

      <section className="filter-bar" aria-label="Bộ lọc phân tích">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="insightsMonth">
              Tháng
            </label>
            <input
              id="insightsMonth"
              type="month"
              className="input"
              value={month}
              onChange={(event) => {
                if (MONTH_PATTERN.test(event.target.value)) setMonth(event.target.value);
              }}
            />
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="insightsCurrency">
              Tiền tệ
            </label>
            <select
              id="insightsCurrency"
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
          <div className="flex items-center pb-1.5">
            {overview ? (
              <Badge tone={monthIsRunning ? 'amber' : 'slate'}>
                {monthIsRunning ? 'Tháng đang diễn ra' : 'Tháng đã kết thúc'}
              </Badge>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Tất cả chỉ số là dữ liệu thực tế từ giao dịch; chưa có số liệu ước tính hay dự báo. Giao
          dịch chuyển tiền nội bộ không được tính là thu nhập hoặc chi tiêu, và mỗi lần chỉ hiển thị
          một loại tiền tệ.
        </p>
      </section>

      {loading ? (
        <div role="status" aria-label="Đang tính toán phân tích">
          <p className="mb-3 text-sm text-ink-muted">Đang tính toán phân tích...</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        </div>
      ) : failure ? (
        <ErrorAlert message={errorMessage(failure)} onRetry={retry} />
      ) : overview && monthly && categories ? (
        <>
          <section aria-label="Chỉ số tổng quan">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Thu nhập"
                value={formatMoney(overview.income, currency)}
                icon={<ArrowDownLeft className="h-5 w-5 text-income" />}
                hint={
                  <>
                    Tháng trước: {formatMoney(overview.previous.income, currency)} (
                    {formatPercent(overview.previous.incomeChangePercent)})
                  </>
                }
              />
              <StatCard
                label="Chi tiêu"
                value={formatMoney(overview.expense, currency)}
                icon={<ArrowUpRight className="h-5 w-5 text-expense" />}
                hint={
                  <>
                    Tháng trước: {formatMoney(overview.previous.expense, currency)} (
                    {formatPercent(overview.previous.expenseChangePercent)})
                  </>
                }
              />
              <StatCard
                label="Dòng tiền ròng"
                value={formatMoney(overview.net, currency)}
                icon={<Wallet className="h-5 w-5 text-info" />}
                valueClass={Number(overview.net) < 0 ? 'text-danger' : 'text-brand-hover'}
                hint={`Thu nhập trừ chi tiêu · ${overview.transactionCount} giao dịch`}
              />
              <StatCard
                label="Tỷ lệ tiết kiệm"
                value={savingsRateLabel(overview.savingsRate)}
                icon={<PiggyBank className="h-5 w-5 text-accent" />}
                hint={
                  overview.savingsRate === null
                    ? 'Tháng này chưa có thu nhập để tính tỷ lệ.'
                    : 'Tính trên thu nhập: (thu nhập − chi tiêu) / thu nhập.'
                }
              />
            </div>
          </section>

          {overview.transactionCount === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={`Chưa có giao dịch trong tháng ${monthLabel(month)}`}
                description="Chọn tháng khác hoặc thêm giao dịch để xem phân tích của tháng này. Các mục bên dưới vẫn hiển thị để bạn đối chiếu."
                action={
                  <Link to="/transactions/new" className="btn-primary">
                    <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
                  </Link>
                }
              />
            </div>
          ) : null}

          <section className="mt-6" aria-label="Diễn biến theo thời gian">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="card-title">Diễn biến {TREND_MONTHS} tháng gần nhất</h2>
              <p className="text-xs text-ink-muted">
                {TREND_MONTHS} tháng gần nhất, tính theo múi giờ {timezone}
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="card min-w-0">
                <h3 className="card-title">Thu nhập và chi tiêu theo tháng</h3>
                <div className="mt-4 h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={chartTheme.grid}
                        vertical={false}
                      />
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
                        tickFormatter={(value: number) =>
                          new Intl.NumberFormat('vi-VN', {
                            notation: 'compact',
                            maximumFractionDigits: 1,
                          }).format(value)
                        }
                      />
                      <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="income"
                        name="Thu nhập"
                        fill={chartTheme.series.income}
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="expense"
                        name="Chi tiêu"
                        fill={chartTheme.series.expense}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card min-w-0">
                <h3 className="card-title">Số liệu từng tháng</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Thu nhập, chi tiêu, dòng tiền ròng và tỷ lệ tiết kiệm của từng tháng
                    </caption>
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                        <th scope="col" className="py-2 pr-3 font-medium">
                          Tháng
                        </th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">
                          Thu
                        </th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">
                          Chi
                        </th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">
                          Ròng
                        </th>
                        <th scope="col" className="py-2 text-right font-medium">
                          Tiết kiệm
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {monthly.months.map((point) => (
                        <tr key={point.month}>
                          <th
                            scope="row"
                            className="py-2 pr-3 text-left font-medium text-ink-secondary"
                          >
                            {monthLabel(point.month)}
                            {point.monthStatus === 'in_progress' ? (
                              <span className="ml-1 text-xs font-normal text-ink-muted">
                                (đang diễn ra)
                              </span>
                            ) : null}
                            {!point.hasTransactions ? (
                              <span className="ml-1 text-xs font-normal text-ink-muted">
                                không có giao dịch
                              </span>
                            ) : null}
                          </th>
                          <td className="py-2 pr-3 text-right text-income">
                            {formatMoney(point.income, currency)}
                          </td>
                          <td className="py-2 pr-3 text-right text-expense">
                            {formatMoney(point.expense, currency)}
                          </td>
                          <td
                            className={`py-2 pr-3 text-right ${
                              Number(point.net) < 0 ? 'text-danger' : 'text-ink-secondary'
                            }`}
                          >
                            {formatMoney(point.net, currency)}
                          </td>
                          <td className="py-2 text-right text-ink-secondary">
                            {savingsRateLabel(point.savingsRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4 card" aria-label="Chi tiêu theo danh mục">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="card-title">Chi tiêu theo danh mục</h2>
              <p className="text-xs text-ink-muted">
                So với tháng {monthLabel(categories.previousMonth)} · danh mục tăng từ{' '}
                {categories.thresholds.notableIncreasePercent}% được đánh dấu
              </p>
            </div>
            <p className="mt-1 text-sm text-ink-secondary">
              Tổng chi tháng này: <strong>{formatMoney(categories.total, currency)}</strong> · tháng
              trước: {formatMoney(categories.previousTotal, currency)} (
              {formatPercent(categories.changePercent)})
            </p>

            {categories.items.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Chưa có chi tiêu theo danh mục trong tháng này."
                  description="Khi bạn ghi chi tiêu trong tháng, tỷ trọng từng danh mục sẽ xuất hiện ở đây."
                />
              </div>
            ) : (
              <ul className="mt-4 space-y-4">
                {categories.items.map((item) => (
                  <li key={item.categoryId ?? 'uncategorised'}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{item.categoryName}</span>
                        {item.notableIncrease ? <Badge tone="amber">Tăng đáng chú ý</Badge> : null}
                        {item.isNewSpending ? <Badge tone="sky">Chi tiêu mới</Badge> : null}
                      </div>
                      <span className="font-semibold text-ink">
                        {formatMoney(item.total, currency)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar
                        value={item.sharePercent}
                        tone={item.notableIncrease ? 'amber' : 'emerald'}
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
                      <span>
                        {item.sharePercent.toFixed(1)}% tổng chi · {item.transactionCount} giao dịch
                      </span>
                      <span>
                        Tháng trước: {formatMoney(item.previousTotal, currency)} (
                        {formatPercent(item.changePercent)})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
