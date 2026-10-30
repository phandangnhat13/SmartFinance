import type { FinancialHealthHistoryDto } from '@smart-finance/shared-types';
import { MessageSquare } from 'lucide-react';
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
import { openAiChat } from '../lib/ai-chat-events';
import type { AiChatContext } from '../lib/ai-chat-context';
import { chartTheme } from '../lib/chartTheme';
import { formatMoney, formatMonthLabel } from '../lib/format';

function compactMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * One primary chart for the overview tab.
 *
 * It reuses the history the health query already returns for the last six
 * completed months, so the overview adds no request and no new calculation:
 * each bar is a figure the API reported. A month without transactions is
 * `null` (a gap), never an interpolated zero.
 */
export function AnalyticsOverviewChart({
  history,
  currency,
  context,
}: {
  history: FinancialHealthHistoryDto;
  currency: string;
  context?: AiChatContext;
}) {
  const points = history.months.map((month) => ({
    label: formatMonthLabel(month.month),
    income: month.hasTransactions ? Number(month.income) : null,
    expense: month.hasTransactions ? Number(month.expense) : null,
  }));
  const hasAnyData = history.months.some((month) => month.hasTransactions);

  return (
    <section className="card" aria-label="Biểu đồ diễn biến 6 tháng">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="card-title">Diễn biến 6 tháng gần nhất</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Thu nhập và chi tiêu theo tháng đã kết thúc, đơn vị {currency}. Tháng không có giao dịch
            để trống, không nội suy.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            openAiChat({
              prompt: 'Giải thích biểu đồ thu nhập và chi tiêu của tôi trong 6 tháng gần đây.',
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
          Chưa có tháng nào có giao dịch để vẽ biểu đồ.
        </p>
      )}

      <div className="mt-3 h-56 w-full">
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
    </section>
  );
}
