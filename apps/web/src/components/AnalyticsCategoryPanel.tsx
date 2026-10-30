import type { AnalyticsCategoriesDto, AnalyticsCategoryRowDto } from '@smart-finance/shared-types';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartTheme } from '../lib/chartTheme';
import type { AiChatContext } from '../lib/ai-chat-context';
import { analyticsCategories } from '../lib/explanations';
import { formatMoney, formatMonthLabel, formatPercent } from '../lib/format';
import { AskAIAction, ExplainButton } from './Explain';
import { Badge, ProgressBar } from './ui';

const MAX_TREND_OPTIONS = 60;

function directionTone(direction: AnalyticsCategoryRowDto['direction']) {
  switch (direction) {
    case 'increase':
      return 'amber' as const;
    case 'decrease':
      return 'sky' as const;
    case 'new':
      return 'sky' as const;
    default:
      return 'slate' as const;
  }
}

function directionLabel(direction: AnalyticsCategoryRowDto['direction']): string {
  switch (direction) {
    case 'increase':
      return 'Tăng';
    case 'decrease':
      return 'Giảm';
    case 'new':
      return 'Mới trong kỳ';
    default:
      return 'Không còn phát sinh';
  }
}

/**
 * Category breakdown for the selected period. All totals, shares and changes
 * come from the API; this panel only formats them. Categories are listed by
 * database id, so two categories sharing a display name stay separate rows.
 */
export function AnalyticsCategoryPanel({
  data,
  currency,
  selectedCategoryId,
  onSelectCategory,
  context,
}: {
  data: AnalyticsCategoriesDto;
  currency: string;
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
  context?: AiChatContext;
}) {
  const isIncome = data.type === 'INCOME';
  const noun = isIncome ? 'thu nhập' : 'chi tiêu';
  const trendOptions = data.categories
    .filter((row) => row.categoryId !== null)
    .slice(0, MAX_TREND_OPTIONS);

  const trendData =
    data.trend?.points.map((point) => ({
      month: formatMonthLabel(point.month),
      amount: point.hasTransactions ? Number(point.amount) : null,
    })) ?? [];

  return (
    <section className="card" aria-label="Phân tích theo danh mục">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-ink">Phân tích theo danh mục</h2>
          <ExplainButton
            explanation={analyticsCategories}
            label="Cách đọc"
            variant="link"
            context={context}
          />
          <AskAIAction
            prompt="Giải thích chi tiêu theo danh mục trong kỳ này và danh mục nào thay đổi nhiều nhất."
            assistantType="ANALYTICS"
            context={context}
            label="Hỏi AI về danh mục"
          />
        </div>
        <p className="text-xs text-ink-muted">
          Kỳ {data.period.label} · đơn vị {currency} · {isIncome ? 'thu nhập' : 'chi tiêu'}
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-surface-muted px-3 py-2">
          <p className="text-xs text-ink-muted">Tổng {noun} trong kỳ</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {formatMoney(data.total, currency)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-muted px-3 py-2">
          <p className="text-xs text-ink-muted">Kỳ trước ({data.previousPeriod.label})</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {formatMoney(data.previousTotal, currency)}
          </p>
        </div>
        <div className="rounded-xl bg-surface-muted px-3 py-2">
          <p className="text-xs text-ink-muted">Số danh mục có phát sinh</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {data.categories.filter((row) => Number(row.total) > 0).length}
          </p>
        </div>
        <div className="rounded-xl bg-surface-muted px-3 py-2">
          <p className="text-xs text-ink-muted">Số tháng của kỳ tính đến hôm nay</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{data.monthsInPeriod} tháng</p>
        </div>
      </div>

      {data.categories.length === 0 ? (
        <p
          className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-secondary"
          role="status"
        >
          Không có giao dịch {noun} nào trong kỳ {data.period.label}.
        </p>
      ) : (
        <>
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Xu hướng theo tháng</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {data.trend?.rangeMonths ?? 6} tháng gần nhất của danh mục đã chọn.
                </p>
              </div>
              <div className="min-w-[180px]">
                <label className="label" htmlFor="analyticsCategoryTrend">
                  Danh mục xem xu hướng
                </label>
                <select
                  id="analyticsCategoryTrend"
                  className="input"
                  value={selectedCategoryId}
                  onChange={(event) => onSelectCategory(event.target.value)}
                >
                  <option value="">Chọn danh mục</option>
                  {trendOptions.map((row) => (
                    <option key={row.categoryId} value={row.categoryId ?? ''}>
                      {row.categoryName}
                      {row.isArchived ? ' (đã lưu trữ)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {data.trend ? (
              <>
                <div className="mt-3 h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} width={80} />
                      <Tooltip
                        formatter={(value: number) => formatMoney(value, currency)}
                        labelFormatter={(label) => `Tháng ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        name={data.trend.categoryName}
                        stroke={isIncome ? chartTheme.series.income : chartTheme.series.expense}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Tháng không có giao dịch của danh mục được để trống, không nội suy. Đơn vị{' '}
                  {currency}.
                </p>
              </>
            ) : (
              <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-secondary">
                Chọn một danh mục để xem chuỗi theo tháng.
              </p>
            )}
          </div>

          <div className="mt-5 overflow-x-auto border-t border-line pt-4">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Danh mục {noun}, số tiền, tỷ trọng, trung bình tháng, kỳ trước và mức thay đổi
              </caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Danh mục
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Số tiền
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Kỳ trước
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Thay đổi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.categories.map((row) => (
                  <tr key={row.categoryId ?? 'uncategorised'}>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-ink">{row.categoryName}</span>
                        {row.isArchived ? <Badge tone="slate">Đã lưu trữ</Badge> : null}
                        {row.isNew ? <Badge tone="sky">Mới</Badge> : null}
                        {row.isRemoved ? <Badge tone="slate">Không còn</Badge> : null}
                        {row.notableIncrease ? (
                          <Badge tone="amber">Tăng ≥ {data.notableIncreasePercent}%</Badge>
                        ) : null}
                        <Badge tone={directionTone(row.direction)}>
                          {directionLabel(row.direction)}
                        </Badge>
                      </div>
                      <div className="mt-1 max-w-xs">
                        <ProgressBar value={row.sharePercent} />
                      </div>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {row.sharePercent.toFixed(1)}% tổng {noun} · {row.transactionCount} giao
                        dịch ·{' '}
                        {row.averageMonthly
                          ? `trung bình ${formatMoney(row.averageMonthly, currency)}/tháng`
                          : 'chưa có trung bình'}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-secondary">
                      {formatMoney(row.total, currency)}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-secondary">
                      {formatMoney(row.previousTotal, currency)}
                    </td>
                    <td className="py-2 text-right text-ink-secondary">
                      <span
                        className={
                          Number(row.changeAmount) > 0 ? 'text-danger' : 'text-ink-secondary'
                        }
                      >
                        {Number(row.changeAmount) > 0 ? '+' : ''}
                        {formatMoney(row.changeAmount, currency)}
                      </span>
                      <span className="ml-1 text-xs text-ink-muted">
                        ({formatPercent(row.changePercent)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Danh mục được nhóm theo mã danh mục, không theo tên: hai danh mục trùng tên vẫn được tính
        riêng. Trung bình tháng = tổng của kỳ ÷ số tháng của kỳ tính đến hôm nay. Ngưỡng &ldquo;tăng
        đáng chú ý&rdquo; là {data.notableIncreasePercent}% so với kỳ trước.
      </p>
    </section>
  );
}
