import type { AnalyticsTrendsDto } from '@smart-finance/shared-types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMonthLabel } from '../lib/format';

interface Props {
  data: AnalyticsTrendsDto;
  currency: string;
  timezone: string;
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Income/expense line chart and net-cash-flow bar chart.
 *
 * A month with no transactions is passed to Recharts as `null`, so the line
 * breaks instead of connecting across a gap; the table below states
 * "Không có dữ liệu" for that month. A month with transactions but zero income
 * or expense remains a measured 0 and is plotted as such.
 */
export function AnalyticsTrendCharts({ data, currency, timezone }: Props) {
  const points = data.points.map((point) => ({
    month: point.month,
    label: formatMonthLabel(point.month),
    hasTransactions: point.hasTransactions,
    income: point.hasTransactions ? Number(point.income) : null,
    expense: point.hasTransactions ? Number(point.expense) : null,
    net: point.hasTransactions ? Number(point.net) : null,
  }));
  const hasAnyData = points.some((point) => point.hasTransactions);

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <section className="card" aria-label="Biểu đồ thu nhập và chi tiêu">
        <h2 className="font-semibold text-slate-900">Thu nhập và chi tiêu theo tháng</h2>
        <p className="mt-1 text-xs text-slate-500">
          {data.rangeMonths} tháng gần nhất, đơn vị {currency}, múi giờ {timezone}. Tháng không có
          giao dịch để trống, không nội suy.
        </p>
        {hasAnyData ? null : (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600" role="status">
            Không có giao dịch thu hoặc chi trong khoảng này.
          </p>
        )}
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                tickFormatter={compactMoney}
              />
              <Tooltip
                formatter={(value: number) => formatMoney(value, currency)}
                labelFormatter={(label) => `Tháng ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="income"
                name="Thu nhập"
                stroke="#059669"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="expense"
                name="Chi tiêu"
                stroke="#f43f5e"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card" aria-label="Biểu đồ dòng tiền ròng">
        <h2 className="font-semibold text-slate-900">Dòng tiền ròng theo tháng</h2>
        <p className="mt-1 text-xs text-slate-500">
          Thu nhập trừ chi tiêu trong từng tháng. Cột âm nghĩa là chi nhiều hơn thu.
        </p>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                tickFormatter={compactMoney}
              />
              <Tooltip
                formatter={(value: number) => formatMoney(value, currency)}
                labelFormatter={(label) => `Tháng ${label}`}
              />
              <Bar dataKey="net" name="Dòng tiền ròng" radius={[4, 4, 0, 0]}>
                {points.map((point) => (
                  <Cell key={point.month} fill={(point.net ?? 0) < 0 ? '#f43f5e' : '#059669'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card xl:col-span-2" aria-label="Số liệu từng tháng">
        <h2 className="font-semibold text-slate-900">Số liệu từng tháng</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Thu nhập, chi tiêu, dòng tiền ròng và số giao dịch của từng tháng
            </caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Tháng
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Thu nhập
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Chi tiêu
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Dòng tiền ròng
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Giao dịch
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.points.map((point) => (
                <tr key={point.month}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                    {formatMonthLabel(point.month)}
                    {point.monthStatus === 'in_progress' ? (
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        (đang diễn ra)
                      </span>
                    ) : null}
                  </th>
                  {point.hasTransactions ? (
                    <>
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
                      <td className="py-2 text-right text-slate-600">{point.transactionCount}</td>
                    </>
                  ) : (
                    <td className="py-2 text-center text-slate-400" colSpan={4}>
                      Không có dữ liệu
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
