import type { AnalyticsTrendsDto } from '@smart-finance/shared-types';
import { MessageSquare } from 'lucide-react';
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
import { openAiChat } from '../lib/ai-chat-events';
import type { AiChatContext } from '../lib/ai-chat-context';
import { chartTheme } from '../lib/chartTheme';
import { analyticsTrends } from '../lib/explanations';
import { formatMoney, formatMonthLabel } from '../lib/format';
import { ExplainButton } from './Explain';

interface Props {
  data: AnalyticsTrendsDto;
  currency: string;
  timezone: string;
  context?: AiChatContext;
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
export function AnalyticsTrendCharts({ data, currency, timezone, context }: Props) {
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
      <section className="card min-w-0 xl:col-span-2" aria-label="Biểu đồ thu nhập và chi tiêu">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-ink">Thu nhập và chi tiêu theo tháng</h2>
              <ExplainButton
                explanation={analyticsTrends}
                label="Cách đọc"
                variant="link"
                context={context}
              />
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {data.rangeMonths} tháng gần nhất, đơn vị {currency}, múi giờ {timezone}. Tháng không
              có giao dịch để trống, không nội suy.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() =>
              openAiChat({
                prompt: 'Giải thích biểu đồ thu nhập và chi tiêu theo tháng của tôi.',
                assistantType: 'ANALYTICS',
                context,
              })
            }
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Hỏi AI về biểu đồ
          </button>
        </div>
        {hasAnyData ? null : (
          <p
            className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-secondary"
            role="status"
          >
            Không có giao dịch thu hoặc chi trong khoảng này.
          </p>
        )}
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                stroke={chartTheme.series.income}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="expense"
                name="Chi tiêu"
                stroke={chartTheme.series.expense}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card min-w-0" aria-label="Biểu đồ dòng tiền ròng">
        <h2 className="font-semibold text-ink">Dòng tiền ròng theo tháng</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Thu nhập trừ chi tiêu trong từng tháng. Cột âm nghĩa là chi nhiều hơn thu.
        </p>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                tickFormatter={compactMoney}
              />
              <Tooltip
                formatter={(value: number) => formatMoney(value, currency)}
                labelFormatter={(label) => `Tháng ${label}`}
              />
              <Bar dataKey="net" name="Dòng tiền ròng" radius={[4, 4, 0, 0]}>
                {points.map((point) => (
                  <Cell
                    key={point.month}
                    fill={
                      (point.net ?? 0) < 0
                        ? chartTheme.series.netNegative
                        : chartTheme.series.netPositive
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card min-w-0" aria-label="Số liệu từng tháng">
        <h2 className="font-semibold text-ink">Số liệu từng tháng</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Thu nhập, chi tiêu, dòng tiền ròng và số giao dịch của từng tháng
            </caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
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
            <tbody className="divide-y divide-line">
              {data.points.map((point) => (
                <tr key={point.month}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-ink-secondary">
                    {formatMonthLabel(point.month)}
                    {point.monthStatus === 'in_progress' ? (
                      <span className="ml-1 text-xs font-normal text-ink-muted">
                        (đang diễn ra)
                      </span>
                    ) : null}
                  </th>
                  {point.hasTransactions ? (
                    <>
                      <td className="py-2 pr-3 text-right text-brand-hover">
                        {formatMoney(point.income, currency)}
                      </td>
                      <td className="py-2 pr-3 text-right text-danger">
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
                        {point.transactionCount}
                      </td>
                    </>
                  ) : (
                    <td className="py-2 text-center text-ink-muted" colSpan={4}>
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
