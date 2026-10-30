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
  Spinner,
  StatCard,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
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

      <section className="card mb-4" aria-label="Bộ lọc phân tích">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
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
          <div>
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
          <div className="flex items-end">
            {overview ? (
              <Badge tone={monthIsRunning ? 'amber' : 'slate'}>
                {monthIsRunning ? 'Tháng đang diễn ra' : 'Tháng đã kết thúc'}
              </Badge>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Tất cả chỉ số là dữ liệu thực tế từ giao dịch; chưa có số liệu ước tính hay dự báo. Giao
          dịch chuyển tiền nội bộ không được tính là thu nhập hoặc chi tiêu, và mỗi lần chỉ hiển thị
          một loại tiền tệ.
        </p>
      </section>

      {loading ? (
        <Spinner label="Đang tính toán phân tích..." />
      ) : failure ? (
        <ErrorAlert message={errorMessage(failure)} onRetry={retry} />
      ) : overview && monthly && categories ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Thu nhập"
              value={formatMoney(overview.income, currency)}
              icon={<ArrowDownLeft className="h-5 w-5 text-emerald-600" />}
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
              icon={<ArrowUpRight className="h-5 w-5 text-rose-500" />}
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
              icon={<Wallet className="h-5 w-5 text-sky-600" />}
              valueClass={Number(overview.net) < 0 ? 'text-rose-600' : 'text-emerald-700'}
              hint={`Thu nhập trừ chi tiêu · ${overview.transactionCount} giao dịch`}
            />
            <StatCard
              label="Tỷ lệ tiết kiệm"
              value={savingsRateLabel(overview.savingsRate)}
              icon={<PiggyBank className="h-5 w-5 text-violet-500" />}
              hint={
                overview.savingsRate === null
                  ? 'Tháng này chưa có thu nhập để tính tỷ lệ.'
                  : 'Tính trên thu nhập: (thu nhập − chi tiêu) / thu nhập.'
              }
            />
          </div>

          {overview.transactionCount === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={`Chưa có giao dịch trong tháng ${monthLabel(month)}`}
                description="Chọn tháng khác hoặc thêm giao dịch để xem phân tích của tháng này."
                action={
                  <Link to="/transactions/new" className="btn-primary">
                    <Plus className="h-4 w-4" aria-hidden /> Thêm giao dịch
                  </Link>
                }
              />
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <section className="card">
              <h2 className="font-semibold text-slate-900">Thu nhập và chi tiêu theo tháng</h2>
              <p className="mt-1 text-xs text-slate-500">
                {TREND_MONTHS} tháng gần nhất, tính theo múi giờ {timezone}.
              </p>
              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                      tickFormatter={(value: number) =>
                        new Intl.NumberFormat('vi-VN', {
                          notation: 'compact',
                          maximumFractionDigits: 1,
                        }).format(value)
                      }
                    />
                    <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Thu nhập" fill="#059669" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Chi tiêu" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="card">
              <h2 className="font-semibold text-slate-900">Số liệu từng tháng</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Thu nhập, chi tiêu, dòng tiền ròng và tỷ lệ tiết kiệm của từng tháng
                  </caption>
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
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
                  <tbody className="divide-y divide-slate-100">
                    {monthly.months.map((point) => (
                      <tr key={point.month}>
                        <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                          {monthLabel(point.month)}
                          {point.monthStatus === 'in_progress' ? (
                            <span className="ml-1 text-xs font-normal text-slate-500">
                              (đang diễn ra)
                            </span>
                          ) : null}
                          {!point.hasTransactions ? (
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              không có giao dịch
                            </span>
                          ) : null}
                        </th>
                        <td className="py-2 pr-3 text-right text-emerald-700">
                          {formatMoney(point.income, currency)}
                        </td>
                        <td className="py-2 pr-3 text-right text-rose-600">
                          {formatMoney(point.expense, currency)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right ${
                            Number(point.net) < 0 ? 'text-rose-600' : 'text-slate-700'
                          }`}
                        >
                          {formatMoney(point.net, currency)}
                        </td>
                        <td className="py-2 text-right text-slate-700">
                          {savingsRateLabel(point.savingsRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Chi tiêu theo danh mục</h2>
              <p className="text-xs text-slate-500">
                So với tháng {monthLabel(categories.previousMonth)} · danh mục tăng từ{' '}
                {categories.thresholds.notableIncreasePercent}% được đánh dấu
              </p>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Tổng chi tháng này: <strong>{formatMoney(categories.total, currency)}</strong> · tháng
              trước: {formatMoney(categories.previousTotal, currency)} (
              {formatPercent(categories.changePercent)})
            </p>

            {categories.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Chưa có chi tiêu theo danh mục trong tháng này.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {categories.items.map((item) => (
                  <li key={item.categoryId ?? 'uncategorised'}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-800">{item.categoryName}</span>
                        {item.notableIncrease ? <Badge tone="amber">Tăng đáng chú ý</Badge> : null}
                        {item.isNewSpending ? <Badge tone="sky">Chi tiêu mới</Badge> : null}
                      </div>
                      <span className="font-semibold text-slate-900">
                        {formatMoney(item.total, currency)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar
                        value={item.sharePercent}
                        tone={item.notableIncrease ? 'amber' : 'emerald'}
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
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
